const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../assets/js/model.js');
const refs=require('../assets/js/reference.js');
const s=(overrides={})=>({...M.defaults,...overrides});
const close=(a,b,eps=1e-10)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('elastic q obeys scattering-angle law for all incidence angles',()=>{
  for(const scattering of [30,90,130,150,180])for(const ratio of [.1,.3,.5,.9]){
    const state=s({scattering,incidence:scattering*ratio,loss:0});
    close(M.momentum(state).magnitude,2*state.energy/M.HBARC*Math.sin(scattering*Math.PI/360));
  }
});
test('finite energy loss obeys independent cosine law',()=>{
  const state=s({energy:530,loss:5,scattering:130}),q=M.momentum(state);
  close(q.magnitude**2,q.ki**2+q.kf**2-2*q.ki*q.kf*Math.cos(130*Math.PI/180));
});
test('specular symmetry has zero parallel and inward normal transfer',()=>{
  const state=s({incidence:75,loss:0}),q=M.momentum(state);
  close(q.parallel,0);assert.ok(q.normal<0);close(q.normal,-2*state.energy/M.HBARC*Math.sin(75*Math.PI/180));
});
test('entrance/exit swap reverses parallel q and retains qz',()=>{
  const state=s({loss:0}),a=M.momentum(state,20),b=M.momentum(state,130);close(a.parallel,-b.parallel);close(a.normal,b.normal);
});
test('azimuth rotates in-plane components, preserving magnitude',()=>{
  const a=M.momentum(s({azimuth:0})),b=M.momentum(s({azimuth:90}));close(a.q[0],b.q[1]);close(b.q[0],0);close(a.magnitude,b.magnitude);
});
test('reciprocal coefficients have duality for all supported cells',()=>{
  for(const lattice of ['cubic','tetragonal','orthorhombic','hexagonal']){
    const state=s({lattice,a:3,b:5,c:7});M.reciprocal(state).forEach((v,i)=>M.fractional(v,state).forEach((n,j)=>close(n,i===j?1:0)));
  }
});
test('basal BZ area equals reciprocal-cell area',()=>{
  for(const lattice of ['cubic','orthorhombic','hexagonal']){
    const state=s({lattice,a:3,b:5}),poly=M.basalZone(state),[b1,b2]=M.reciprocal(state);
    const area=Math.abs(poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;
    close(area,Math.abs(b1[0]*b2[1]-b1[1]*b2[0]));
  }
});
test('hexagonal BZ vertices satisfy reciprocal-neighbor bisectors',()=>{
  const state=s({lattice:'hexagonal',a:3}),poly=M.basalZone(state),[b1,b2]=M.reciprocal(state);
  assert.equal(poly.length,6);close(Math.max(...poly.map(p=>Math.hypot(...p))),4*Math.PI/9);
  for(const p of poly)for(let h=-2;h<=2;h++)for(let k=-2;k<=2;k++){
    const gx=h*b1[0]+k*b2[0],gy=h*b1[1]+k*b2[1];assert.ok(p[0]*gx+p[1]*gy<=(gx*gx+gy*gy)/2+1e-9);
  }
});
test('orthogonal BZ half-widths are 0.5 in r.l.u.',()=>{
  for(const projection of ['xy','xz','zy'])for(const p of M.zoneProjection(s({units:'rlu',projection})))for(const v of p)close(Math.abs(v),.5);
});
test('scan includes endpoints; single point uses start',()=>{
  const state=s({hStep:.05,units:'rlu'}),points=M.scan(state);close(points[0].incidence,state.start);close(points.at(-1).incidence,state.end);for(let i=1;i<points.length-1;i++)close(Math.abs(points[i].hkl[0]-points[i-1].hkl[0]),.05);assert.ok(Math.abs(points.at(-1).hkl[0]-points.at(-2).hkl[0])<=.05);assert.equal(M.scan(s({end:10})).length,1);
});
test('Gaussian FWHM and integrated area',()=>{
  close(M.gaussian(.02,0,.04)/M.gaussian(0,0,.04),.5,1e-9);
  let area=0;for(let i=0;i<=20000;i++)area+=M.gaussian(-1+i*.0001,.07,.04)*.0001;close(area,1,1e-9);
});
test('resonance reaches half maximum at half FWHM detuning',()=>{
  close(M.resonanceFactor(s()),1);close(M.resonanceFactor(s({energy:M.defaults.resonance+.2})),.5);
});
test('resolution broadens peaks without changing area weight',()=>{
  const a=M.peaks(s({resolution:20})),b=M.peaks(s({resolution:100}));close(b[2].width,Math.hypot(.1,.08));assert.ok(b[2].width>a[2].width);close(a[2].weight,b[2].weight);
});
test('spectrum values are finite, nonnegative, and sum to total',()=>{
  for(const p of M.spectrum(s())){assert.ok(Number.isFinite(p.intensity));assert.ok(p.intensity>=0);close(p.intensity,p.components.reduce((a,b)=>a+b,0));}
});
test('heatmap agrees with a spectrum at its column angle',()=>{
  const state=s(),hm=M.heatmap(state,5,101);assert.deepEqual(hm.data[2],M.spectrum(state,hm.angles[2],101));assert.ok(hm.max>0);
});
test('zero weights have zero intensity with finite display normalization',()=>{
  const state=s({elasticWeight:0,phononWeight:0,magnonWeight:0,ddWeight:0});assert.ok(M.spectrum(state).every(p=>p.intensity===0));assert.ok(M.heatmap(state,3,10).max>0);
});
test('invalid physical conditions and oversized scans are rejected',()=>{
  for(const v of [{energy:NaN},{energy:0},{scattering:181},{incidence:150},{start:0},{start:145,end:140},{hStep:0},{hStep:11},{loss:933},{a:0},{lossMax:1000},{resolution:0},{ddWeight:-1}])assert.throws(()=>M.validate(s(v)),JSON.stringify(v));
});
test('settings sanitizer ignores unknown keys and rejects invalid values',()=>{
  assert.equal(M.sanitize({a:4,unknown:'ignored'}).a,4);assert.equal(M.sanitize({unknown:'ignored'}).unknown,undefined);assert.throws(()=>M.sanitize({energy:-1}));
  for(const v of [null,[],{energy:'932.7'},{resolution:1e-300},{resonanceWidth:1e-300},{azimuth:1e100}])assert.throws(()=>M.sanitize(v));
});
test('reference IDs are unique and energies positive',()=>{
  assert.equal(new Set(refs.map(r=>r.id)).size,refs.length);for(const r of refs)assert.ok(r.energy>0);close(refs.find(r=>r.id==='Cu-L3').energy,932.7);
});

test('centered cubic BZ topology is computed from the primitive reciprocal lattice',()=>{
  const expected={P:[8,12,6],I:[14,24,12],F:[24,36,14]};
  for(const centering of ['P','I','F']){
    const state=s({lattice:'cubic',centering,a:4}),zone=M.zoneMesh(state);
    assert.deepEqual([zone.vertices.length,zone.edges.length,zone.faces.length],expected[centering]);
    const axial=zone.faces.filter(f=>f.every(p=>Math.abs(p[2]-f[0][2])<1e-8)).map(f=>f[0][2]);
    if(centering==='P')close(Math.max(...axial),Math.PI/4);
    if(centering==='F')close(Math.max(...axial),Math.PI/2);
    if(centering==='I')close(Math.max(...zone.vertices.map(v=>v[2])),Math.PI/2);
  }
});
test('skew and centered BZ volume equals the primitive reciprocal volume',()=>{
  const G=require('../assets/js/lattice.js');
  for(const options of [{lattice:'monoclinic',centering:'C',beta:110},{lattice:'triclinic',alpha:75,beta:80,gamma:100},{lattice:'hexagonal',centering:'R'},{lattice:'rhombohedral',centering:'R',alpha:75}]){
    const state=s({...options,a:4,b:5,c:6}),zone=M.zoneMesh(state),reciprocal=M.reciprocal(state);
    let volume=0;for(const face of zone.faces)for(let i=1;i<face.length-1;i++)volume+=Math.abs(G.dot(face[0],G.cross(face[i],face[i+1])))/6;
    close(volume,G.volume(reciprocal),1e-7);
    for(const [i,b]of reciprocal.entries())for(const [j,a]of M.crystal(state).primitive.entries())close(G.dot(a,b),i===j?2*Math.PI:0);
  }
});
test('nearby cells cover sampled scan points and intermediate points in sparse scans',()=>{
  const G=require('../assets/js/lattice.js'),state=s({allZones:true,hStep:10,lattice:'hexagonal'}),result=M.occupiedZones(state),nearest=G.nearestSolver(M.reciprocal(state));
  assert.ok(result.centers.length>1);assert.deepEqual(result.centers[0],[0,0,0]);assert.equal(result.truncated,false);
  for(let i=0;i<301;i++){
    const q=M.momentum(state,state.start+(state.end-state.start)*i/300).q,center=nearest(q).shift;
    assert.ok(result.centers.some(v=>Math.hypot(...v.map((n,j)=>n-center[j]))<1e-8));
  }
});
test('occupied centers are actual reciprocal vectors for centered cells',()=>{
  const G=require('../assets/js/lattice.js'),state=s({lattice:'cubic',centering:'F',a:8,allZones:true}),c=M.crystal(state);
  for(const v of M.occupiedZones(state).centers)for(const p of c.primitive){const n=G.dot(v,p)/(2*Math.PI);close(n,Math.round(n));}
  assert.equal(M.occupiedZones({...state,allZones:false}).centers.length,1);
});
test('readouts use reciprocal coefficients without a false Euclidean r.l.u. magnitude',()=>{
  const state=s({lattice:'hexagonal',azimuth:30,units:'rlu'}),r=M.displayReadout(state);
  assert.equal(r.scalars,null);assert.deepEqual(r.vector,M.momentum(state).hkl);assert.deepEqual(r.labels,['H','K','L']);
  const physical=M.displayReadout({...state,units:'angstrom'});assert.ok(physical.scalars.magnitude>0);assert.deepEqual(physical.vector,M.momentum(state).q);
});
test('old settings migrate to primitive geometry while invalid cells are rejected',()=>{
  const old={...M.defaults};for(const key of ['centering','alpha','beta','gamma','allZones'])delete old[key];
  const migrated=M.sanitize(old);assert.equal(migrated.centering,'P');assert.equal(migrated.allZones,false);
  for(const bad of [{lattice:'cubic',centering:'C'},{lattice:'triclinic',alpha:10,beta:10,gamma:170},{lattice:'monoclinic',beta:180}])assert.throws(()=>M.validate(s(bad)));
});


test('tilt transfers momentum toward K and preserves the scattering-angle law',()=>{
  for(const tilt of [-60,-20,20,60])for(const azimuth of [0,35,120]){
    const state=s({tilt,azimuth}),q=M.momentum(state),baseline=M.momentum(s({azimuth}));
    close(q.magnitude,baseline.magnitude);close(q.q[2],baseline.q[2]*Math.cos(tilt*M.RAD));
    if(azimuth===0){close(q.hkl[0],baseline.hkl[0]);assert.equal(Math.sign(q.hkl[1]),Math.sign(tilt));}
  }
});
test('fixed L solver preserves L on the selected outgoing branch for tilted and skew cells',()=>{
  for(const options of [{},{tilt:30,azimuth:20},{lattice:'triclinic',alpha:75,beta:80,gamma:100,tilt:20,azimuth:30}]){
    const state=s(options);Object.assign(state,M.captureL(state));
    close(M.solveScattering(state,state.incidence),state.scattering);
    for(const incidence of [20,22,26,30]){
      const scattering=M.solveScattering(state,incidence),next={...state,incidence,scattering};
      M.validate(next,{scanRange:false});close(M.momentum(next).hkl[2],state.lockedL);assert.equal(M.captureL(next).lockBranch,state.lockBranch);
    }
  }
  const state=s();Object.assign(state,M.captureL(state));assert.throws(()=>M.solveScattering(state,80));
});
test('H stepping covers a turning point without duplicate angles and respects each segment spacing',()=>{
  const state=s({azimuth:75,tilt:35,hStep:.007,units:'rlu'}),rows=M.scan(state),[c,d]=[M.momentum(state,0).hkl[0],M.momentum(state,90).hkl[0]];
  const turn=Math.atan2(d,c)/M.RAD+180;assert.ok(turn>state.start&&turn<state.end);
  const turning=rows.findIndex(p=>Math.abs(p.incidence-turn)<2e-6);assert.ok(turning>0&&turning<rows.length-1);
  for(let i=1;i<rows.length;i++){
    assert.ok(rows[i].incidence>rows[i-1].incidence);
    const dh=Math.abs(rows[i].hkl[0]-rows[i-1].hkl[0]);
    if(i===turning||i===rows.length-1)assert.ok(dh<=state.hStep+1e-10);else close(dh,state.hStep);
  }
});
test('constant H and excessive density produce useful scan errors',()=>{
  assert.throws(()=>M.scan(s({azimuth:90})),/component is constant/);
  assert.throws(()=>M.scan(s({hStep:.000001})),/2,001/);
  assert.equal(M.scan(s({azimuth:90,start:20,end:20})).length,1);
});
test('legacy dimension, plane and point-count settings migrate to H steps',()=>{
  const migrated=M.sanitize({projection:'3d',points:81});assert.equal(migrated.dimension,3);assert.equal(migrated.projection,'xz');assert.equal(M.scan(migrated).length,81);
  const single=M.sanitize({projection:'yz',points:1});assert.equal(single.projection,'zy');assert.equal(single.end,single.start);assert.equal(M.scan(single).length,1);
});


test('fixed-L scans preserve L and H spacing over both outgoing branches and skew lattices',()=>{
  for(const options of [{},{tilt:35,azimuth:40},{lattice:'triclinic',alpha:75,beta:80,gamma:100,tilt:-25,azimuth:30},{lattice:'rhombohedral',centering:'R',alpha:78,azimuth:40}])for(const incidence of [25,100]){
    const state=s({...options,incidence,angleMode:'l',units:'rlu'});Object.assign(state,M.captureL(state));const range=M.scanLimits(state);state.start=range.min;state.end=range.max;
    assert.ok(range.min<=incidence&&range.max>=incidence);M.validate(state);const points=M.scan(state);assert.ok(points.length>1);
    for(let i=0;i<points.length;i++){
      const p=points[i];close(p.hkl[2],state.lockedL,1e-9);close(p.scattering,p.incidence+p.beta);assert.ok(p.scattering<=180&&p.beta>0);
      if(i>0&&i<points.length-1)close(Math.abs(p.hkl[0]-points[i-1].hkl[0]),state.hStep,1e-9);
    }
    close(points[0].incidence,state.start);close(points.at(-1).incidence,state.end);assert.ok(Math.abs(points[0].scattering-points.at(-1).scattering)>1);
    for(let i=0;i<=100;i++){const p=M.scanPoint(state,range.min+(range.max-range.min)*i/100);close(p.hkl[2],state.lockedL,1e-9);}
    assert.throws(()=>M.scan({...state,end:Math.min(179.99,range.max+.01)}),/available range/);
  }
});
test('fixed-L special cases reject constant H and excessive points, and permit a single point',()=>{
  const state=s({angleMode:'l',azimuth:90});Object.assign(state,M.captureL(state));const range=M.scanLimits(state);state.start=range.min;state.end=range.max;
  assert.throws(()=>M.scan(state),/component is constant/);assert.equal(M.scan({...state,start:25,end:25}).length,1);
  state.azimuth=0;Object.assign(state,M.captureL(state));assert.throws(()=>M.scan({...state,hStep:.000001}),/2,001/);
});
test('fixed-L heatmap uses each incidence scattering angle for the elastic dispersion approximation',()=>{
  const state=s({angleMode:'l',tilt:30,loss:5});Object.assign(state,M.captureL(state));const range=M.scanLimits(state);state.start=range.min;state.end=range.max;
  const hm=M.heatmap(state,7,31);
  for(let x=0;x<hm.columns;x++){const incidence=hm.angles[x],scattering=hm.scatterings[x],fixed={...state,angleMode:'scattering',incidence,scattering};close(M.momentum(fixed).hkl[2],state.lockedL);assert.deepEqual(hm.data[x],M.spectrum(fixed,incidence,31));}
});
test('nearby BZ lookup follows the fixed-L line even with sparse measurement points',()=>{
  const G=require('../assets/js/lattice.js'),state=s({angleMode:'l',tilt:20,a:15,b:15,c:20,allZones:true,hStep:10});Object.assign(state,M.captureL(state));const range=M.scanLimits(state);state.start=range.min;state.end=range.max;
  const zones=M.occupiedZones(state),nearest=G.nearestSolver(M.reciprocal(state));assert.ok(zones.centers.length>1);
  for(let i=0;i<=200;i++){const p=M.scanPoint(state,state.start+(state.end-state.start)*i/200).q,center=nearest(p).shift;assert.ok(zones.centers.some(v=>G.norm(G.sub(v,center))<1e-8));}
});
