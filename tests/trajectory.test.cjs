const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../assets/js/model.js');
const refs=require('../assets/js/reference.js');
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function setup(extra={}){const s={...M.defaults,...extra};Object.assign(s,M.captureL(s),M.captureHK(s));const r=M.scanLimits(s);s.start=r.min;s.end=r.max;return s;}

test('every angular scan axis obeys the selected fixed constraints including oblique cells',()=>{
  for(const lattice of [{},{lattice:'triclinic',alpha:75,beta:80,gamma:100}])for(const angleMode of ['scattering','l','hk'])for(const scanAxis of ['incidence','azimuth','tilt']){
    const s=setup({...lattice,angleMode,scanAxis,tilt:20,azimuth:25,scanComponent:angleMode==='hk'?2:scanAxis==='incidence'?0:1});
    for(let i=0;i<=50;i++){
      const p=M.scanPoint(s,s.start+(s.end-s.start)*i/50);
      if(angleMode==='hk'){close(p.hkl[0],s.lockedH);close(p.hkl[1],s.lockedK);}
      if(angleMode==='l')close(p.hkl[2],s.lockedL);
      if(angleMode==='scattering')close(p.scattering,s.scattering);
      assert.ok(p.incidence>0&&p.beta>0&&p.scattering<=180+1e-8&&Math.abs(p.tilt)<=85+1e-8);
      close(p.magnitude**2,p.ki**2+p.kf**2-2*p.ki*p.kf*Math.cos(p.scattering*M.RAD));
    }
  }
});
test('inverse momentum recovers nearby angles in every component and both unit systems',()=>{
  for(const units of ['rlu','angstrom'])for(const angleMode of ['scattering','l','hk'])for(const axis of ['incidence','azimuth','tilt']){
    const s=setup({units,angleMode,scanAxis:axis,tilt:20,azimuth:25});
    const angle=s[axis]+Math.min(.5,(s.end-s[axis])/3),component=angleMode==='hk'?2:axis==='incidence'?0:1;
    const target=M.componentValue(s,angle,axis,component,units),solved=M.inverseAngle(s,target,axis,component,units,s[axis]);
    close(solved,angle,1e-5);close(M.componentValue(s,solved,axis,component,units),target);
  }
  const s=setup();assert.throws(()=>M.inverseAngle(s,1000),/outside/);assert.throws(()=>M.inverseAngle(s,0,'incidence',1),/constant/);
});
test('full azimuth scan includes both turning points and regular momentum steps in either map unit',()=>{
  for(const units of ['rlu','angstrom']){
    const s=setup({scanAxis:'azimuth',scanComponent:1,units,hStep:.025}),points=M.scan(s);
    close(points[0].scanValue,-180);close(points.at(-1).scanValue,180);
    assert.ok(points.some(p=>Math.abs(p.scanValue+90)<1e-8));assert.ok(points.some(p=>Math.abs(p.scanValue-90)<1e-8));
    for(let i=1;i<points.length;i++){
      const delta=Math.abs((units==='rlu'?points[i].hkl:points[i].q)[1]-(units==='rlu'?points[i-1].hkl:points[i-1].q)[1]);
      const endpoint=i===points.length-1||Math.abs(Math.abs(points[i].scanValue)-90)<1e-8;
      if(endpoint)assert.ok(delta<=s.hStep+1e-9);else close(delta,s.hStep);
      assert.ok(points[i].scanValue>points[i-1].scanValue);
    }
  }
});
test('HK alpha scans change L, preserve H/K and retain actual angles in every row',()=>{
  const s=setup({angleMode:'hk',scanComponent:2,tilt:18,azimuth:23,units:'rlu'}),ps=M.scan(s);
  assert.ok(Math.abs(ps[0].hkl[2]-ps.at(-1).hkl[2])>.1);
  for(const p of ps){close(p.hkl[0],s.lockedH);close(p.hkl[1],s.lockedK);const rebuilt=M.momentum({...s,incidence:p.incidence,scattering:p.scattering,azimuth:p.azimuth,tilt:p.tilt});rebuilt.q.forEach((v,j)=>close(v,p.q[j]));}
});
test('heatmaps use the selected phi or tilt geometry for the spectrum',()=>{
  for(const scanAxis of ['azimuth','tilt']){
    const s=setup({scanAxis,scanComponent:1,angleMode:'hk',tilt:20}),hm=M.heatmap(s,5,11);
    for(let i=0;i<5;i++){const g=M.scanGeometry(s,hm.angles[i]);assert.deepEqual(hm.data[i],M.spectrum({...g,angleMode:'scattering'},g[scanAxis],11));}
  }
});
test('reference contains exactly H through U and orbital-derived edge identifiers',()=>{
  const symbols=[...new Set(refs.map(r=>r.element))];assert.equal(symbols.length,92);assert.equal(symbols[0],'H');assert.equal(symbols.at(-1),'U');
  for(let z=1;z<=92;z++)assert.ok(refs.some(r=>r.z===z&&r.orbital));
  assert.equal(refs.find(r=>r.id==='Cu-L3').energy,932.7);assert.equal(refs.find(r=>r.id==='U-K').energy,115606);
});
test('legacy H steps migrate once to physical units and new scan controls round-trip',()=>{
  const old={...M.defaults};delete old.scanAxis;const migrated=M.sanitize(old);close(migrated.hStep,old.hStep*2*Math.PI/old.a);close(M.sanitize(migrated).hStep,migrated.hStep);
  const s=setup({angleMode:'hk',scanAxis:'tilt',scanComponent:2,incidenceUnit:'rlu',incidenceComponent:2,scanRangeUnit:'momentum'});assert.deepEqual(M.sanitize(s),s);assert.throws(()=>M.sanitize({...s,lockedH:s.lockedH+1}),/target/);
});
