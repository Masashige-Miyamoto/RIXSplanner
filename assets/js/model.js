(function (root) {
  'use strict';
  const G=typeof module!=='undefined'?require('./lattice.js'):root.RIXSLattice;
  const HBARC = 1973.269804; // eV Å; photon wave number E/(ħc)
  const RAD = Math.PI / 180;
  const defaults = Object.freeze({
    energy:932.7, resonance:932.7, resonanceWidth:0.4, edge:'Cu-L3',
    scattering:150, incidence:25, azimuth:0, tilt:0, loss:0.3, angleMode:'scattering', lockedL:0, lockBranch:-1,
    lattice:'tetragonal', centering:'P', a:3.85, b:3.85, c:13.2, alpha:90, beta:90, gamma:90,
    start:10, end:140, hStep:0.01, dwell:30,
    resolution:40, lossMin:-0.15, lossMax:3,
    phonon:0.07, magnon:0.3, dd:1.7, intrinsic:0.08,
    elasticWeight:0.3, phononWeight:0.25, magnonWeight:1, ddWeight:0.6,
    dimension:2, projection:'xz', units:'angstrom', showBZ:true, allZones:false, showComponents:true
  });
  function validate(s, {scanRange=true}={}) {
    const positive=['energy','resonance','resonanceWidth','a','b','c','resolution','phonon','magnon','dd','intrinsic','dwell'];
    for(const key of Object.keys(defaults)) if(typeof defaults[key]==='number' && !Number.isFinite(s[key])) throw Error(key+' は有限の数値で入力してください。');
    for(const key of positive) if(s[key]<=0) throw Error(key+' は 0 より大きい値にしてください。');
    if(s.resolution<1||s.resolution>2000) throw Error('分解能は 1–2,000 meV です。');
    for(const key of ['resonanceWidth','phonon','magnon','dd','intrinsic']) if(s[key]<0.001||s[key]>100) throw Error(key+' は 0.001–100 eV です。');
    if(Math.abs(s.azimuth)>360) throw Error('方位角は −360°〜360° で入力してください。');
    if(Math.abs(s.tilt)>85) throw Error('tilt は −85°〜85° で入力してください。');
    if(!['scattering','l'].includes(s.angleMode)||![-1,1].includes(s.lockBranch)) throw Error('入射角の固定モードが不正です。');
    if(s.dwell<0.1||s.dwell>1e7) throw Error('露光時間は 0.1–10,000,000 秒 / 点です。');
    if(s.energy<20||s.energy>30000||s.resonance>30000) throw Error('光子エネルギーは 20–30,000 eV、共鳴中心は 30,000 eV 以下です。');
    if(s.scattering<=0||s.scattering>180) throw Error('散乱角 2θ は 0° より大きく 180° 以下です。');
    for(const [key,label] of (scanRange?[['incidence','入射角'],['start','スキャン開始角'],['end','スキャン終了角']]:[['incidence','入射角']])) {
      if(s[key]<=0||s[key]>=180||s.scattering-s[key]<=0||s.scattering-s[key]>=180) throw Error(label+' は 0° < α < 2θ、0° < β = 2θ − α < 180° を満たす必要があります。');
    }
    if(scanRange&&s.start>s.end) throw Error('スキャン開始角は終了角以下にしてください。');
    if(scanRange&&(s.hStep<0.000001||s.hStep>10)) throw Error('ΔH は 0.000001–10 r.l.u. で入力してください。');
    if(s.loss<0||s.loss>=s.energy) throw Error('運動量計算の損失は 0 ≤ ΔE < 入射光子エネルギーです。');
    if(s.lossMin>=s.lossMax||s.lossMax>=s.energy||s.lossMax-s.lossMin>100) throw Error('スペクトル範囲は最小 < 最大 < 入射エネルギー、幅 100 eV 以下です。');
    if(s.lossMin < -10) throw Error('損失エネルギーの下限は −10 eV です。');
    if(Math.min(s.a,s.b,s.c)<0.1||Math.max(s.a,s.b,s.c)>1000) throw Error('格子定数は 0.1–1,000 Å です。');
    for(const key of ['elasticWeight','phononWeight','magnonWeight','ddWeight']) if(s[key]<0||s[key]>100) throw Error('ピークの積分重みは 0–100 です。');
    if(!Object.hasOwn(CENTERINGS,s.lattice)) throw Error('結晶系が不正です。');
    if(!CENTERINGS[s.lattice].includes(s.centering)) throw Error('結晶系に対応する格子の中心化を選んでください。');
    if(![2,3].includes(s.dimension)||!['xz','xy','zy'].includes(s.projection)||!['angstrom','rlu'].includes(s.units)) throw Error('表示設定が不正です。');
    crystal(s);
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
    return {q,hkl:fractional(q,s),parallel,normal:q[2],planeNormal:normal,magnitude:Math.hypot(...q),ki,kf,beta:s.scattering-incidence,incidence};
  }
  function lockCoefficients(s){
    const p=s.azimuth*RAD,t=s.tilt*RAD,c=crystal(s).coordinateBasis[2];
    return {a:G.dot([Math.cos(p),Math.sin(p),0],c)/(2*Math.PI),b:G.dot([Math.sin(t)*Math.sin(p),-Math.sin(t)*Math.cos(p),Math.cos(t)],c)/(2*Math.PI)};
  }
  function captureL(s){const {a,b}=lockCoefficients(s),beta=(s.scattering-s.incidence)*RAD;return {lockedL:momentum(s).hkl[2],lockBranch:-a*Math.sin(beta)+b*Math.cos(beta)<0?-1:1};}
  function solveScattering(s,incidence){
    if(!Number.isFinite(incidence)||incidence<=0||incidence>=180)throw Error('入射角は 0° より大きく 180° 未満にしてください。');
    const {a,b}=lockCoefficients(s),r=Math.hypot(a,b),ki=s.energy/HBARC,kf=(s.energy-s.loss)/HBARC,alpha=incidence*RAD;
    if(!(r>1e-12&&kf>0))throw Error('この配置では L 固定の散乱角を計算できません。');
    const value=(ki*(a*Math.cos(alpha)-b*Math.sin(alpha))-s.lockedL)/(kf*r);
    if(Math.abs(value)>1+1e-10)throw Error('指定した入射角では L を維持できません。');
    const phase=Math.atan2(b,a),delta=Math.acos(Math.max(-1,Math.min(1,value))),candidates=[];
    for(const sign of [-1,1])for(let n=-1;n<=1;n++){
      const beta=phase+sign*delta+2*Math.PI*n,scattering=incidence+beta/RAD,derivative=-a*Math.sin(beta)+b*Math.cos(beta);
      if(beta>1e-8&&beta<Math.PI-1e-8&&scattering<=180+1e-8&&(Math.abs(derivative)<1e-9||Math.sign(derivative)===s.lockBranch))candidates.push(Math.min(180,scattering));
    }
    if(!candidates.length)throw Error('同じ出射枝で L を固定できる角度範囲を超えています。');
    return candidates.sort((a,b)=>Math.abs(a-s.scattering)-Math.abs(b-s.scattering))[0];
  }
  function hCoefficients(s){return [momentum(s,0).hkl[0],momentum(s,90).hkl[0]];}
  function scan(s) {
    if(s.start===s.end)return [momentum(s,s.start)];
    if(!Number.isFinite(s.hStep)||s.hStep<=0)throw Error('ΔH は正の有限値にしてください。');
    const [c,d]=hCoefficients(s),radius=Math.hypot(c,d),phase=Math.atan2(d,c),lo=s.start*RAD,hi=s.end*RAD;
    if(radius<1e-10)throw Error('この配置では H が変化しません。方位角・tilt を変更するか、開始角と終了角を同じにしてください。');
    const cuts=[lo,hi];for(let n=-2;n<=2;n++){const angle=phase+n*Math.PI;if(angle>lo+1e-10&&angle<hi-1e-10)cuts.push(angle);}cuts.sort((a,b)=>a-b);
    const H=angle=>c*Math.cos(angle)+d*Math.sin(angle),angles=[lo];
    for(let segment=1;segment<cuts.length;segment++){
      const a=cuts[segment-1],b=cuts[segment],ha=H(a),hb=H(b),span=Math.abs(hb-ha),direction=Math.sign(hb-ha);
      if(angles.length+Math.ceil(span/s.hStep)>2001)throw Error('測定点が 2,001 点を超えます。ΔH を大きくするか範囲を狭めてください。');
      for(let step=1;step*s.hStep<span-1e-10;step++){
        const target=ha+direction*step*s.hStep,delta=Math.acos(Math.max(-1,Math.min(1,target/radius)));let solved=null;
        for(const sign of [-1,1])for(let n=-2;n<=2;n++){const v=phase+sign*delta+n*2*Math.PI;if(v>=a-1e-10&&v<=b+1e-10)solved=Math.max(a,Math.min(b,v));}
        if(solved===null)throw Error('H ステップに対応する角度を求められませんでした。');angles.push(solved);
      }
      angles.push(b);
    }
    return angles.map(angle=>momentum(s,angle/RAD));
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
    const arc=(s.end-s.start)*RAD*(2*s.energy-s.loss)/HBARC;
    const required=s.start===s.end?1:Math.max(points.length,Math.ceil(arc/Math.max(distance*.4,1e-8))+1),count=Math.min(4097,required);
    const samples=[momentum(s).q,...points.map(p=>p.q)];
    if(count>1)for(let i=0;i<count;i++)samples.push(momentum(s,s.start+(s.end-s.start)*i/(count-1)).q);
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
  function peaks(s,incidence=s.incidence) {
    const {hkl}=momentum(s,incidence,0), h=hkl[0],k=hkl[1];
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
  function spectrum(s,incidence=s.incidence,count=801) {
    const ps=peaks(s,incidence), factor=resonanceFactor(s);
    return Array.from({length:count},(_,i)=>{
      const loss=s.lossMin+(s.lossMax-s.lossMin)*i/(count-1);
      const components=ps.map(p=>factor*p.weight*gaussian(loss,p.center,p.width));
      return {loss,components,intensity:components.reduce((a,b)=>a+b,0)};
    });
  }
  function heatmap(s,columns=101,rows=180) {
    const data=[],angles=[];
    for(let x=0;x<columns;x++) {
      const angle=s.start+(s.end-s.start)*x/(columns-1);angles.push(angle);data.push(spectrum(s,angle,rows));
    }
    return {data,angles,columns,rows,max:Math.max(1e-30,...data.map(col=>Math.max(...col.map(v=>v.intensity))))};
  }
  function sanitize(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw Error('設定は JSON オブジェクトで指定してください。');
    const s={...defaults};
    for(const key of Object.keys(s)) if(Object.hasOwn(raw,key)) {
      if(typeof raw[key]!==typeof s[key]) throw Error(key+' のデータ型が不正です。');
      s[key]=raw[key];
    }
    if(raw.projection==='3d'){s.dimension=3;s.projection='xz';}else if(raw.projection==='yz')s.projection='zy';
    if(!Object.hasOwn(raw,'hStep')&&Number.isInteger(raw.points)&&raw.points>0){
      if(raw.points===1)s.end=s.start;
      else s.hStep=Math.max(.000001,Math.min(10,Math.abs(momentum(s,s.end).hkl[0]-momentum(s,s.start).hkl[0])/(raw.points-1)));
    }
    validate(s,{scanRange:false});if(s.angleMode==='l'&&Math.abs(momentum(s).hkl[2]-s.lockedL)>1e-7)throw Error('保存された L 固定条件が現在の配置と一致しません。');return s;
  }
  const api={HBARC,RAD,defaults,CENTERINGS,validate,cell,crystal,reciprocal,fractional,momentum,captureL,solveScattering,hCoefficients,scan,basalZone,project,zoneProjection,zoneMesh,occupiedZones,displayVector,displayReadout,convexHull,gaussian,peaks,resonanceFactor,spectrum,heatmap,sanitize};
  if(typeof module!=='undefined')module.exports=api;
  root.RIXS=api;
})(typeof globalThis!=='undefined'?globalThis:this);
