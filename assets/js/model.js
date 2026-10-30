(function (root) {
  'use strict';
  const G=typeof module!=='undefined'?require('./lattice.js'):root.RIXSLattice;
  const HBARC = 1973.269804; // eV Å; photon wave number E/(ħc)
  const RAD = Math.PI / 180;
  const defaults = Object.freeze({
    energy:932.7, resonance:932.7, resonanceWidth:0.4, edge:'Cu-L3',
    scattering:150, incidence:25, azimuth:0, tilt:0, loss:0.3, angleMode:'scattering', lockedL:0, lockBranch:-1, lockedH:0, lockedK:0,
    lattice:'tetragonal', centering:'P', a:3.85, b:3.85, c:13.2, alpha:90, beta:90, gamma:90,
    start:10, end:140, hStep:0.01, dwell:30, scanAxis:'incidence', scanComponent:0, scanRangeUnit:'angle', momentumComponent:0, showScan:true,
    resolution:40, lossMin:-0.15, lossMax:3,
    phonon:0.07, magnon:0.3, dd:1.7, intrinsic:0.08,
    elasticWeight:0.3, phononWeight:0.25, magnonWeight:1, ddWeight:0.6,
    dimension:2, projection:'xz', units:'angstrom', showBZ:true, allZones:false, showComponents:true
  });
  function validate(s, {scanRange=true}={}) {
    const positive=['energy','resonance','resonanceWidth','a','b','c','resolution','phonon','magnon','dd','intrinsic','dwell'];
    for(const key of Object.keys(defaults)) if(typeof defaults[key]==='number' && !Number.isFinite(s[key])) throw Error(key+" must be a finite number.");
    for(const key of positive) if(s[key]<=0) throw Error(key+" must be positive.");
    if(s.resolution<1||s.resolution>2000) throw Error("Resolution must be 1–2,000 meV.");
    for(const key of ['resonanceWidth','phonon','magnon','dd','intrinsic']) if(s[key]<0.001||s[key]>100) throw Error(key+" must be 0.001–100 eV.");
    if(Math.abs(s.azimuth)>360) throw Error("Azimuth must be between −360° and 360°.");
    if(Math.abs(s.tilt)>85) throw Error("Tilt must be between −85° and 85°.");
    if(!['scattering','l','hk'].includes(s.angleMode)||![-1,1].includes(s.lockBranch)) throw Error("Invalid incidence control mode.");
    if(s.dwell<0.1||s.dwell>1e7) throw Error("Exposure must be 0.1–10,000,000 seconds per point.");
    if(s.energy<0.1||s.energy>150000||s.resonance>150000) throw Error("Photon energy must be 0.1–150,000 eV and resonance energy at most 150,000 eV.");
    if(s.scattering<=0||s.scattering>180) throw Error("Scattering angle 2θ must be greater than 0° and at most 180°.");
    for(const [key,label] of (scanRange&&s.angleMode==='scattering'&&s.scanAxis==='incidence'?[['incidence',"Incidence angle"],['start',"Scan start angle"],['end',"Scan end angle"]]:[['incidence',"Incidence angle"]])) {
      if(s[key]<=0||s[key]>=180||s.scattering-s[key]<=0||s.scattering-s[key]>=180) throw Error(label+" must satisfy 0° < α < 2θ and 0° < β = 2θ − α < 180°.");
    }
    if(scanRange&&s.start>s.end) throw Error("Scan start must not exceed scan end.");
    if(scanRange&&(s.hStep<0.000001||s.hStep>10)) throw Error("Momentum step must be 0.000001–10 in the displayed units.");
    if(s.loss<0||s.loss>=s.energy) throw Error("Momentum loss must satisfy 0 ≤ ΔE < incident photon energy.");
    if(s.lossMin>=s.lossMax||s.lossMax>=s.energy||s.lossMax-s.lossMin>100) throw Error("Spectrum limits must satisfy min < max < incident energy, with a span at most 100 eV.");
    if(s.lossMin < -10) throw Error("The minimum energy loss is −10 eV.");
    if(Math.min(s.a,s.b,s.c)<0.1||Math.max(s.a,s.b,s.c)>1000) throw Error("Lattice constants must be 0.1–1,000 Å.");
    for(const key of ['elasticWeight','phononWeight','magnonWeight','ddWeight']) if(s[key]<0||s[key]>100) throw Error("Integrated peak weights must be 0–100.");
    if(!Object.hasOwn(CENTERINGS,s.lattice)) throw Error("Invalid crystal system.");
    if(!CENTERINGS[s.lattice].includes(s.centering)) throw Error("Select a centering compatible with the crystal system.");
    if(![2,3].includes(s.dimension)||!['xz','xy','zy'].includes(s.projection)||!['angstrom','rlu'].includes(s.units)) throw Error("Invalid display settings.");
    crystal(s);
    if(!['incidence','azimuth','tilt'].includes(s.scanAxis)||![0,1,2].includes(s.scanComponent)||![0,1,2].includes(s.momentumComponent)||!['angle','momentum'].includes(s.scanRangeUnit))throw Error('Invalid scan controls.');
    if(scanRange){const range=scanLimits(s);if(s.start<range.min-1e-7||s.end>range.max+1e-7)throw Error('Scan angles must stay inside the available range.');}
    return s;
  }
  const CENTERINGS={cubic:['P','I','F'],tetragonal:['P','I'],orthorhombic:['P','C','I','F'],hexagonal:['P','R'],rhombohedral:['R'],monoclinic:['P','C'],triclinic:['P']};
  function cell(s) {
    const a=s.a,b=['orthorhombic','monoclinic','triclinic'].includes(s.lattice)?s.b:a;
    const c=['cubic','rhombohedral'].includes(s.lattice)?a:s.c;
    const alpha=['triclinic','rhombohedral'].includes(s.lattice)?s.alpha:90;
    const beta=s.lattice==='rhombohedral'?alpha:['monoclinic','triclinic'].includes(s.lattice)?s.beta:90;
    const gamma=s.lattice==='hexagonal'?120:s.lattice==='rhombohedral'?alpha:s.lattice==='triclinic'?s.gamma:90;
    return {a,b,c,alpha:alpha*RAD,beta:beta*RAD,gamma:gamma*RAD};
  }
  let crystalKey='',crystalValue,meshKey='',meshValue;
  function crystal(s) {
    const p=cell(s),key=JSON.stringify([s.lattice,s.centering,p]);if(key===crystalKey)return crystalValue;
    const system=['cubic','tetragonal','orthorhombic'].includes(s.lattice)?'orthogonal':s.lattice;
    const c=G.lattice({dimension:3,system,centering:s.centering??'P',a:p.a,b:p.b,c:p.c,alpha:p.alpha/RAD,beta:p.beta/RAD,gamma:p.gamma/RAD});
    // H/K/L refer to the input axes: conventional except for primitive rhombohedral axes.
    c.coordinateBasis=s.lattice==='rhombohedral'?c.primitive:c.conventional;
    crystalKey=key;crystalValue=c;return c;
  }
  function reciprocal(s) {
    return crystal(s).reciprocal;
  }
  function fractional(q,s) {
    return crystal(s).coordinateBasis.map(a=>G.dot(q,a)/(2*Math.PI));
  }
  function momentum(s, incidence=s.incidence, loss=s.loss) {
    const ai=incidence*RAD, bo=(s.scattering-incidence)*RAD, p=s.azimuth*RAD,t=s.tilt*RAD;
    const ki=s.energy/HBARC, kf=(s.energy-loss)/HBARC;
    const parallel=ki*Math.cos(ai)-kf*Math.cos(bo), normal=-ki*Math.sin(ai)-kf*Math.sin(bo);
    // Rz(phi) Rx(tilt): at phi=0, positive tilt sends inward qz toward +qy/K.
    const q=[parallel*Math.cos(p)+normal*Math.sin(t)*Math.sin(p),parallel*Math.sin(p)-normal*Math.sin(t)*Math.cos(p),normal*Math.cos(t)];
    return {q,hkl:fractional(q,s),parallel,normal:q[2],planeNormal:normal,magnitude:Math.hypot(...q),ki,kf,beta:s.scattering-incidence,incidence,scattering:s.scattering,azimuth:s.azimuth,tilt:s.tilt};
  }
  function lockCoefficients(s){
    const p=s.azimuth*RAD,t=s.tilt*RAD,c=crystal(s).coordinateBasis[2];
    return {a:G.dot([Math.cos(p),Math.sin(p),0],c)/(2*Math.PI),b:G.dot([Math.sin(t)*Math.sin(p),-Math.sin(t)*Math.cos(p),Math.cos(t)],c)/(2*Math.PI)};
  }
  function captureL(s){const {a,b}=lockCoefficients(s),beta=(s.scattering-s.incidence)*RAD;return {lockedL:momentum(s).hkl[2],lockBranch:-a*Math.sin(beta)+b*Math.cos(beta)<0?-1:1};}
  function solveScattering(s,incidence){
    if(!Number.isFinite(incidence)||incidence<=0||incidence>=180)throw Error("Incidence must be greater than 0° and less than 180°.");
    const {a,b}=lockCoefficients(s),r=Math.hypot(a,b),ki=s.energy/HBARC,kf=(s.energy-s.loss)/HBARC,alpha=incidence*RAD;
    if(!(r>1e-12&&kf>0))throw Error("Cannot solve a fixed-L scattering angle for this geometry.");
    const value=(ki*(a*Math.cos(alpha)-b*Math.sin(alpha))-s.lockedL)/(kf*r);
    if(Math.abs(value)>1+1e-10)throw Error("L cannot be maintained at the requested incidence.");
    const phase=Math.atan2(b,a),delta=Math.acos(Math.max(-1,Math.min(1,value))),candidates=[];
    for(const sign of [-1,1])for(let n=-1;n<=1;n++){
      const beta=phase+sign*delta+2*Math.PI*n,scattering=incidence+beta/RAD,derivative=-a*Math.sin(beta)+b*Math.cos(beta);
      if(beta>1e-8&&beta<Math.PI-1e-8&&scattering<=180+1e-8&&(Math.abs(derivative)<1e-9||Math.sign(derivative)===s.lockBranch))candidates.push(Math.min(180,scattering));
    }
    if(!candidates.length)throw Error("The requested angle is outside the fixed-L range on the same outgoing branch.");
    return candidates.sort((a,b)=>Math.abs(a-s.scattering)-Math.abs(b-s.scattering))[0];
  }
  // Exact boundaries of the feasible fixed-L branch: outgoing tangency,
  // beta=0/pi, and 2theta=pi. Midpoints classify the intervals between them.
  function incidenceLimits(s){
    if(s.angleMode!=='l')return {min:.1,max:Math.max(.1,s.scattering-.1)};
    const {a,b}=lockCoefficients(s),ki=s.energy/HBARC,kf=(s.energy-s.loss)/HBARC,r=Math.hypot(a,b),cuts=[0,180];
    if(!(r>1e-12&&kf>0))throw Error('Cannot solve a fixed-L scattering angle for this geometry.');
    const phase=Math.atan2(-b,a),roots=value=>{
      const ratio=value/(ki*r);if(Math.abs(ratio)>1+1e-12)return;
      const delta=Math.acos(Math.max(-1,Math.min(1,ratio)));
      for(const sign of [-1,1])for(let n=-1;n<=1;n++){const alpha=(phase+sign*delta+2*Math.PI*n)/RAD;if(alpha>0&&alpha<180)cuts.push(alpha);}
    };
    for(const value of [s.lockedL-kf*r,s.lockedL+kf*r,s.lockedL-kf*a,s.lockedL+kf*a,ki*s.lockedL/(ki+kf)])roots(value);
    cuts.sort((x,y)=>x-y);const unique=cuts.filter((v,i)=>!i||v-cuts[i-1]>1e-8),intervals=[];
    const feasible=angle=>{try{solveScattering(s,angle);return true;}catch{return false;}};
    for(let i=1;i<unique.length;i++){
      const min=unique[i-1],max=unique[i];if(!feasible((min+max)/2))continue;
      const last=intervals.at(-1);if(last&&Math.abs(last.max-min)<1e-8&&feasible(min))last.max=max;else intervals.push({min,max});
    }
    const range=intervals.find(v=>s.incidence>=v.min-1e-8&&s.incidence<=v.max+1e-8);
    if(!range){if(feasible(s.incidence))return {min:s.incidence,max:s.incidence};throw Error('No continuous fixed-L scan range contains the current incidence.');}
    // Move excluded grazing endpoints inside the domain; retain valid 180° scattering endpoints.
    const inset=Math.min(1e-5,(range.max-range.min)/4);
    return {min:feasible(range.min)?range.min:range.min+inset,max:feasible(range.max)?range.max:range.max-inset};
  }
  function captureHK(s){const p=momentum(s);return {lockedH:p.hkl[0],lockedK:p.hkl[1]};}
  function bisect(fn,lo,hi){let f=fn(lo);for(let i=0;i<48;i++){const mid=(lo+hi)/2,v=fn(mid);if(f*v<=0)hi=mid;else{lo=mid;f=v;}}return (lo+hi)/2;}
  function roots(fn,min,max,count=256){
    const found=[];let x=min,y=fn(x);
    if(Math.abs(y)<1e-11)found.push(x);
    for(let i=1;i<=count;i++){const next=min+(max-min)*i/count,v=fn(next);if(y*v<0)found.push(bisect(fn,x,next));if(Math.abs(v)<1e-11)found.push(next);x=next;y=v;}
    return found.filter((v,i)=>!i||Math.abs(v-found[i-1])>1e-7);
  }
  function geometryAt(s,axis,value){
    const next={...s,[axis]:value};
    if(!Number.isFinite(value))throw Error('The requested angle must be finite.');
    if(s.angleMode==='l')next.scattering=solveScattering(next,next.incidence);
    if(s.angleMode==='hk'){
      const [a,b]=crystal(s).coordinateBasis,ki=s.energy/HBARC,kf=(s.energy-s.loss)/HBARC;
      const x=2*Math.PI*s.lockedH/a[0],y=(2*Math.PI*s.lockedK-b[0]*x)/b[1],alpha=next.incidence*RAD;
      let beta,phi=next.azimuth*RAD,tilt=next.tilt*RAD;
      if(axis==='tilt'){
        const residual=beta=>{const p=ki*Math.cos(alpha)-kf*Math.cos(beta),n=-ki*Math.sin(alpha)-kf*Math.sin(beta);return p*p+n*n*Math.sin(tilt)**2-x*x-y*y;};
        const candidates=roots(residual,1e-7,Math.PI-alpha,128);
        if(!candidates.length)throw Error('H and K cannot be maintained at the requested angle.');
        beta=candidates.sort((u,v)=>Math.abs(u-(s.scattering-s.incidence)*RAD)-Math.abs(v-(s.scattering-s.incidence)*RAD))[0];
        const p=ki*Math.cos(alpha)-kf*Math.cos(beta),n=-ki*Math.sin(alpha)-kf*Math.sin(beta);
        phi=Math.atan2(y,x)-Math.atan2(-n*Math.sin(tilt),p);
        phi+=Math.round((s.azimuth*RAD-phi)/(2*Math.PI))*2*Math.PI;
      }else{
        const p=x*Math.cos(phi)+y*Math.sin(phi),side=-x*Math.sin(phi)+y*Math.cos(phi),cos=(ki*Math.cos(alpha)-p)/kf;
        if(Math.abs(cos)>1+1e-12)throw Error('H and K cannot be maintained at the requested angle.');
        beta=Math.acos(Math.max(-1,Math.min(1,cos)));
        const n=-ki*Math.sin(alpha)-kf*Math.sin(beta),sin=-side/n;
        if(Math.abs(sin)>1+1e-12)throw Error('H and K cannot be maintained at the requested angle.');
        tilt=Math.asin(Math.max(-1,Math.min(1,sin)));
      }
      next.scattering=next.incidence+beta/RAD;next.azimuth=phi/RAD;next.tilt=tilt/RAD;
    }
    if(next.incidence<=0||next.scattering-next.incidence<=1e-7||next.scattering>180+1e-8||Math.abs(next.tilt)>85+1e-8||Math.abs(next.azimuth)>360+1e-8)throw Error('The requested angle is outside the available geometry.');
    return next;
  }
  function scanGeometry(s,value){return geometryAt(s,s.scanAxis,value);}
  function scanPoint(s,value){const g=scanGeometry(s,value);return {...momentum(g),scanValue:value};}
  // Use the connected, physically feasible branch containing the current setting.
  // Alpha at fixed L has analytic boundaries; the other coupled rotations use
  // bracketed boundary refinement to retain sub-microdegree endpoint accuracy.
  function scanLimits(s){
    if(s.scanAxis==='incidence'&&s.angleMode!=='hk')return incidenceLimits(s);
    const center=s[s.scanAxis],bounds=s.scanAxis==='incidence'?[.00001,179.99999]:s.scanAxis==='tilt'?[-85,85]:[Math.max(-360,center-180),Math.min(360,center+180)];
    const valid=value=>{try{geometryAt(s,s.scanAxis,value);return true;}catch{return false;}};
    if(!valid(center))throw Error('No continuous scan range contains the current setting.');
    function edge(to){let previous=center;for(let i=1;i<=360;i++){const value=center+(to-center)*i/360;if(!valid(value)){let good=previous,bad=value;for(let k=0;k<45;k++){const mid=(good+bad)/2;if(valid(mid))good=mid;else bad=mid;}return good+(center-good)*1e-10;}previous=value;}return to;}
    return {min:edge(bounds[0]),max:edge(bounds[1])};
  }
  function componentValue(s,value,axis=s.scanAxis,component=s.scanComponent,units=s.units){const p=momentum(geometryAt(s,axis,value));return (units==='rlu'?p.hkl:p.q)[component];}
  // Partition into monotonic components before inverting. Including extrema is
  // essential for azimuth scans: equal endpoint momenta need not mean no motion.
  function componentSegments(s,min,max,axis=s.scanAxis,component=s.scanComponent,units=s.units){
    const f=x=>componentValue(s,x,axis,component,units),cuts=[min],n=240;
    if(s.angleMode==='scattering'){
      const sample=value=>{const p=momentum({...s,[axis]:value});return (units==='rlu'?p.hkl:p.q)[component];};
      const zero=sample(0),opposite=sample(180),offset=(zero+opposite)/2;
      const phase=Math.atan2(sample(90)-offset,(zero-opposite)/2)/RAD;
      for(let k=-4;k<=4;k++){const turn=phase+180*k;if(turn>min+1e-8&&turn<max-1e-8)cuts.push(turn);}
      cuts.push(max);cuts.sort((a,b)=>a-b);return {f,cuts};
    }
    let a=min,fa=f(a),b=min+(max-min)/n,fb=f(b);
    for(let i=2;i<=n;i++){
      const c=min+(max-min)*i/n,fc=f(c);
      if((fb-fa)*(fc-fb)<0){
        const sign=fb>fa?1:-1;let lo=a,hi=c;
        for(let j=0;j<45;j++){const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3;if(sign*f(u)<sign*f(v))lo=u;else hi=v;}
        cuts.push((lo+hi)/2);
      }
      a=b;fa=fb;b=c;fb=fc;
    }
    cuts.push(max);return {f,cuts};
  }
  function componentExtent(s,axis=s.scanAxis,component=s.scanComponent,units=s.units){const limits=scanLimits({...s,scanAxis:axis}),{f,cuts}=componentSegments(s,limits.min,limits.max,axis,component,units),values=cuts.map(f);return {min:Math.min(...values),max:Math.max(...values)};}
  function inverseAngle(s,target,axis=s.scanAxis,component=s.scanComponent,units=s.units,near=s[axis]){
    if(!Number.isFinite(target))throw Error('Momentum must be finite.');
    const limits=scanLimits({...s,scanAxis:axis}),{f,cuts}=componentSegments(s,limits.min,limits.max,axis,component,units),candidates=[];
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i],fa=f(a)-target,fb=f(b)-target;
      if(Math.abs(fa)<1e-9)candidates.push(a);if(Math.abs(fb)<1e-9)candidates.push(b);
      if(fa*fb<0)candidates.push(bisect(x=>f(x)-target,a,b));
      if(Math.abs(fa-fb)<1e-10&&Math.abs(fa)<1e-9)throw Error('This momentum component is constant; choose another component.');
    }
    if(!candidates.length)throw Error('The requested momentum is outside the reachable range.');
    return candidates.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near))[0];
  }
  // Inverse input holds the two sample rotations fixed. L/HK locks add
  // linear constraints on the in-plane and normal momentum (p,n), so the
  // remaining beam angles can be recovered from the scattering triangle.
  function geometryForMomentum(s,target,component=s.momentumComponent,units=s.units){
    if(!Number.isFinite(target))throw Error('Momentum must be finite.');
    if(![0,1,2].includes(component)||!['rlu','angstrom'].includes(units))throw Error('Invalid scan controls.');
    if(s.angleMode==='scattering'){
      const incidence=inverseAngle(s,target,'incidence',component,units,s.incidence);
      return {...s,incidence};
    }
    const phi=s.azimuth*RAD,tau=s.tilt*RAD;
    const u=[Math.cos(phi),Math.sin(phi),0],v=[Math.sin(tau)*Math.sin(phi),-Math.sin(tau)*Math.cos(phi),Math.cos(tau)];
    const hu=fractional(u,s),hv=fractional(v,s),rows=[[...(units==='rlu'?[hu[component],hv[component]]:[u[component],v[component]]),target]];
    for(const i of s.angleMode==='l'?[2]:[0,1])rows.push([hu[i],hv[i],i===2?s.lockedL:i===0?s.lockedH:s.lockedK]);
    const tolerance=1e-8,unreachable=()=>{throw Error('The requested momentum cannot be reached with the current azimuth, tilt and fixed constraints.');};
    // Normalize rows before comparing their rank (Å and r.l.u. may be mixed).
    const equations=[];
    for(const [a,b,c]of rows){const norm=Math.hypot(a,b);if(norm<1e-12){if(Math.abs(c)>tolerance)unreachable();}else equations.push([a/norm,b/norm,c/norm]);}
    let pair=null;
    for(let i=0;i<equations.length;i++)for(let j=i+1;j<equations.length;j++){
      const [a,b]=equations[i],[c,d]=equations[j],det=a*d-b*c;
      if(Math.abs(det)>1e-10&&(!pair||Math.abs(det)>Math.abs(pair.det)))pair={first:equations[i],second:equations[j],det};
    }
    if(!pair){
      // With just one independent constraint, retain 2theta and pick the
      // nearest alpha satisfying it. This also handles a redundant target.
      const current=momentum(s),value=(units==='rlu'?current.hkl:current.q)[component];
      if(Math.abs(value-target)<tolerance)return {...s};
      const incidence=inverseAngle({...s,angleMode:'scattering'},target,'incidence',component,units,s.incidence),next={...s,incidence};
      const p=momentum(next);
      if(rows.some(([a,b,c])=>Math.abs(a*p.parallel+b*p.planeNormal-c)>tolerance))unreachable();
      return next;
    }
    const {first:[a,b,c],second:[d,e,f],det}=pair,p=(c*e-b*f)/det,n=(a*f-c*d)/det;
    if(rows.some(([a,b,c])=>Math.abs(a*p+b*n-c)>tolerance))unreachable();
    const ki=s.energy/HBARC,kf=(s.energy-s.loss)/HBARC,cos=(ki*ki+kf*kf-p*p-n*n)/(2*ki*kf);
    if(Math.abs(cos)>1+1e-10)unreachable();
    const theta=Math.acos(Math.max(-1,Math.min(1,cos)));
    const incidence=(Math.atan2(-n,p)-Math.atan2(kf*Math.sin(theta),ki-kf*Math.cos(theta)))/RAD;
    const next={...s,incidence,scattering:theta/RAD};
    if(incidence<=0||next.scattering-incidence<=1e-7)unreachable();
    validate(next,{scanRange:false});
    if(Math.abs((units==='rlu'?momentum(next).hkl:momentum(next).q)[component]-target)>tolerance)unreachable();
    // Retain the requested fixed-L outgoing branch for subsequent scans.
    if(s.angleMode==='l')next.lockBranch=captureL(next).lockBranch;
    return next;
  }
  function scan(s){
    const limits=scanLimits(s);
    if(s.start>s.end||s.start<limits.min-1e-7||s.end>limits.max+1e-7)throw Error('Scan angles must stay inside the available range.');
    if(s.start===s.end)return [scanPoint(s,s.start)];
    if(!Number.isFinite(s.hStep)||s.hStep<=0)throw Error('Momentum step must be positive and finite.');
    const {f,cuts}=componentSegments(s,s.start,s.end),angles=[s.start];let total=0;
    for(let i=1;i<cuts.length;i++){
      const a=cuts[i-1],b=cuts[i],va=f(a),vb=f(b),span=Math.abs(vb-va),direction=Math.sign(vb-va);total+=span;
      if(angles.length+Math.ceil(span/s.hStep)>2001)throw Error('The scan exceeds 2,001 points. Increase the momentum step or narrow the range.');
      for(let step=1;step*s.hStep<span-1e-10;step++){const target=va+direction*step*s.hStep;angles.push(bisect(x=>f(x)-target,a,b));}
      angles.push(b);
    }
    if(total<1e-10)throw Error('This momentum component is constant; choose another component.');
    return angles.map(value=>scanPoint(s,value));
  }
  // Wigner–Seitz polygon in the basal reciprocal plane; exact for our supported cells.
  function basalZone(s) {
    const [b1,b2]=reciprocal(s), R=4*Math.max(Math.hypot(...b1),Math.hypot(...b2));
    let poly=[[-R,-R],[R,-R],[R,R],[-R,R]];
    for(let h=-3;h<=3;h++)for(let k=-3;k<=3;k++) {
      if(!h&&!k)continue;
      const g=[h*b1[0]+k*b2[0],h*b1[1]+k*b2[1]], d=(g[0]*g[0]+g[1]*g[1])/2;
      const clipped=[];
      for(let i=0;i<poly.length;i++) {
        const p=poly[i],q=poly[(i+1)%poly.length];
        const dp=p[0]*g[0]+p[1]*g[1]-d,dq=q[0]*g[0]+q[1]*g[1]-d;
        if(dp<=1e-10)clipped.push(p);
        if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);clipped.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
      }
      poly=clipped;
    }
    return poly.filter((p,i)=>i===0||Math.hypot(p[0]-poly[i-1][0],p[1]-poly[i-1][1])>1e-8);
  }
  function convexHull(points) {
    const ps=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const lo=[],hi=[];
    for(const p of ps){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=1e-12)lo.pop();lo.push(p);}
    for(const p of ps.slice().reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),p)<=1e-12)hi.pop();hi.push(p);}
    lo.pop();hi.pop();return lo.concat(hi);
  }
  function project(q,s) {
    const v=s.units==='rlu'?fractional(q,s):q;
    return s.projection==='xy'?[v[0],v[1]]:s.projection==='zy'?[v[2],v[1]]:[v[0],v[2]];
  }
  function zoneProjection(s) {
    return convexHull(zoneMesh(s).vertices.map(p=>project(p,s)));
  }
  function zoneMesh(s) {
    const basis=reciprocal(s),key=JSON.stringify(basis);if(key!==meshKey){meshValue=G.brillouinZone(basis);meshKey=key;}return meshValue;
  }
  function occupiedZones(s,points=scan(s)) {
    const centers=[[0,0,0]];if(!s.allZones)return {centers,truncated:false,samples:points.length};
    const mesh=zoneMesh(s),basis=reciprocal(s),nearest=G.nearestSolver(basis);
    const distances=mesh.faces.map(f=>{for(let i=1;i<f.length-1;i++){const v=G.cross(G.sub(f[i],f[0]),G.sub(f[i+1],f[0])),n=G.norm(v);if(n>1e-15)return Math.abs(G.dot(f[0],v)/n);}return Infinity;});
    const distance=Math.min(...distances);
    const ends=s.angleMode==='l'&&s.scanAxis==='incidence'?[scanPoint(s,s.start).q,scanPoint(s,s.end).q]:null;
    const arc=ends?G.norm(G.sub(ends[1],ends[0])):(s.end-s.start)*RAD*(2*s.energy-s.loss)/HBARC;
    const required=s.start===s.end?1:Math.max(points.length,Math.ceil(arc/Math.max(distance*.4,1e-8))+1),count=Math.min(4097,required);
    const samples=[momentum(s).q,...points.map(p=>p.q)];
    if(count>1)for(let i=0;i<count;i++)samples.push(ends?ends[0].map((v,j)=>v+(ends[1][j]-v)*i/(count-1)):scanPoint(s,s.start+(s.end-s.start)*i/(count-1)).q);
    let truncated=required>4097;const seen=new Set(['0,0,0']);
    for(const point of samples){const center=nearest(point).shift,key=center.map(v=>Math.round(v*1e8)).join(',');if(seen.has(key))continue;if(centers.length>=256){truncated=true;continue;}seen.add(key);centers.push(center);}
    return {centers,truncated,samples:count};
  }
  function displayVector(q,s){return s.units==='rlu'?fractional(q,s):q.slice();}
  function displayReadout(s){const q=momentum(s);return {vector:displayVector(q.q,s),labels:s.units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'],unit:s.units==='rlu'?'r.l.u.':'Å⁻¹',scalars:s.units==='rlu'?null:{magnitude:q.magnitude,parallel:q.parallel,normal:q.normal}};}
  function gaussian(x,center,fwhm) {
    const sigma=fwhm/2.354820045;
    return Math.exp(-0.5*((x-center)/sigma)**2)/(sigma*Math.sqrt(2*Math.PI));
  }
  function peaks(s,incidence=s[s.scanAxis]) {
    const {hkl}=momentum(scanGeometry(s,incidence),scanGeometry(s,incidence).incidence,0), h=hkl[0],k=hkl[1];
    // Deliberately a generic periodic dispersion, not a material-specific spin model.
    const dispersion=Math.sqrt((Math.sin(Math.PI*h)**2+Math.sin(Math.PI*k)**2)/2);
    const width=s.resolution/1000;
    return [
      {name:'Elastic',color:'#9bb8ba',center:0,width,weight:s.elasticWeight},
      {name:'Phonon',color:'#f4c86b',center:s.phonon,width:Math.hypot(width,0.015),weight:s.phononWeight},
      {name:'Dispersive',color:'#77e4c8',center:0.02+s.magnon*dispersion,width:Math.hypot(width,s.intrinsic),weight:s.magnonWeight*dispersion},
      {name:'dd / orbital',color:'#b399f5',center:s.dd,width:Math.hypot(width,0.25),weight:s.ddWeight}
    ];
  }
  function resonanceFactor(s) {return 1/(1+(2*(s.energy-s.resonance)/s.resonanceWidth)**2);}
  function spectrum(s,incidence=s[s.scanAxis],count=801) {
    const ps=peaks(s,incidence), factor=resonanceFactor(s);
    return Array.from({length:count},(_,i)=>{
      const loss=s.lossMin+(s.lossMax-s.lossMin)*i/(count-1);
      const components=ps.map(p=>factor*p.weight*gaussian(loss,p.center,p.width));
      return {loss,components,intensity:components.reduce((a,b)=>a+b,0)};
    });
  }
  function heatmap(s,columns=101,rows=180) {
    const data=[],angles=[],scatterings=[];
    for(let x=0;x<columns;x++) {
      const angle=s.start+(s.end-s.start)*x/(columns-1);angles.push(angle);scatterings.push(scanGeometry(s,angle).scattering);data.push(spectrum(s,angle,rows));
    }
    return {data,angles,scatterings,columns,rows,max:Math.max(1e-30,...data.map(col=>Math.max(...col.map(v=>v.intensity))))};
  }
  function sanitize(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw Error("Settings must be a JSON object.");
    const s={...defaults};
    for(const key of Object.keys(s)) if(Object.hasOwn(raw,key)) {
      if(typeof raw[key]!==typeof s[key]) throw Error(key+" has an invalid data type.");
      s[key]=raw[key];
    }
    if(!Object.hasOwn(raw,'momentumComponent')&&[0,1,2].includes(raw.incidenceComponent))s.momentumComponent=raw.incidenceComponent;
    if(raw.projection==='3d'){s.dimension=3;s.projection='xz';}else if(raw.projection==='yz')s.projection='zy';
    if(!Object.hasOwn(raw,'hStep')&&Number.isInteger(raw.points)&&raw.points>0){
      if(raw.points===1)s.end=s.start;
      else s.hStep=Math.max(.000001,Math.min(10,Math.abs(momentum(s,s.end).hkl[0]-momentum(s,s.start).hkl[0])/(raw.points-1)));
    }
    if(!Object.hasOwn(raw,'scanAxis')&&s.units==='angstrom')s.hStep*=2*Math.PI/cell(s).a;
    validate(s,{scanRange:false});if(s.angleMode==='l'&&Math.abs(momentum(s).hkl[2]-s.lockedL)>1e-7)throw Error("The saved fixed-L target does not match the current geometry.");if(s.angleMode==='hk'){const p=momentum(s);if(Math.abs(p.hkl[0]-s.lockedH)>1e-7||Math.abs(p.hkl[1]-s.lockedK)>1e-7)throw Error('The saved H, K target does not match the current geometry.');}return s;
  }
  const api={HBARC,RAD,defaults,CENTERINGS,validate,cell,crystal,reciprocal,fractional,momentum,captureL,captureHK,geometryAt,geometryForMomentum,componentValue,inverseAngle,componentExtent,solveScattering,scanGeometry,scanPoint,scanLimits,scan,basalZone,project,zoneProjection,zoneMesh,occupiedZones,displayVector,displayReadout,convexHull,gaussian,peaks,resonanceFactor,spectrum,heatmap,sanitize};
  if(typeof module!=='undefined')module.exports=api;
  root.RIXS=api;
})(typeof globalThis!=='undefined'?globalThis:this);
