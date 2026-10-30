// UI integration checks in a minimal DOM harness. This does not replace a real
// browser's layout, canvas or accessibility checks (see tests/browser.cjs).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

function harness(saved,language){
  const downloads=[],blobs=new Map(),storage=new Map(saved?[['rixs-cut-planner.v1',saved]]:[]);
  if(language)storage.set('rixs-language',language);
  class Element{
    constructor(tag){this.tagName=tag;this.attrs={};this.children=[];this.listeners={};this.style={};this.dataset={};this._text='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.classList={add(){},remove(){}};}
    set value(v){this._value=String(v);}
    get value(){return this._value;}
    setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=v;if(k==='type')this.type=v;if(k==='value')this.value=String(v);if(k==='checked')this.checked=true;if(k==='hidden')this.hidden=true;if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}
    getAttribute(k){return this.attrs[k];}
    append(...nodes){for(const n of nodes){this.children.push(n);n.parent=this;}}
    insertBefore(n,b){const i=this.children.indexOf(b);if(i<0)this.append(n);else{this.children.splice(i,0,n);n.parent=this;}}
    get firstChild(){return this.children[0];}
    replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
    set textContent(v){this._text=String(v);this.children=[];}
    get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    async emit(type,event={}){for(const fn of this.listeners[type]??[])await fn({target:this,preventDefault(){},...event});}
    click(){if(this.tagName==='a')downloads.push({name:this.download,blob:blobs.get(this.href)});return this.emit('click');}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
    querySelectorAll(selector){const match=e=>selector.startsWith('#')?e.id===selector.slice(1):selector.startsWith('[')?Object.hasOwn(e.attrs,selector.slice(1,-1)):e.tagName===selector;const results=[];for(const child of this.children){if(match(child))results.push(child);results.push(...child.querySelectorAll(selector));}return results;}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    cloneNode(){const n=new Element(this.tagName);n.attrs={...this.attrs};n._text=this._text;for(const c of this.children)n.append(c.cloneNode());return n;}
    getContext(){return new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})},{get:(t,p)=>t[p]??(()=>{})});}
    getBoundingClientRect(){return {left:0,top:0,width:this.id==='momentumMap'?900:640,height:this.id==='momentumMap'?460:300};}
  }
  const document=new Element('document'),stack=[document];
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const voidTags=new Set(['meta','link','input','br','hr']);
  for(const match of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)>/gi)){
    const [,close,tag,attrs]=match;if(close){while(stack.length>1){if(stack.pop().tagName===tag)break;}continue;}
    const el=new Element(tag);for(const m of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g))el.setAttribute(m[1],(m[2]??'').replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));stack.at(-1).append(el);if(!voidTags.has(tag))stack.push(el);
  }
  document.getElementById=id=>document.querySelector('#'+id);document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=document.querySelector('body');document.documentElement=document.querySelector('html');
  const ctx={document,console,Blob,Uint8ClampedArray,setTimeout:()=>0,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    URL:{createObjectURL:blob=>{const id='blob:'+blobs.size;blobs.set(id,blob);return id;},revokeObjectURL(){}},
    XMLSerializer:class{serializeToString(){return '<svg xmlns="http://www.w3.org/2000/svg"/>';}}
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const file of ['i18n.js','reference.js','lattice.js','model.js','map.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),ctx,{filename:file});
  const $=id=>document.getElementById(id);
  return {$,document,storage,downloads,input:async(id,value)=>{$(id).value=String(value);await $(id).emit('input');},ctx};
}

test('UI starts with a complete valid calculation and restores saved conditions',async()=>{
  const h=harness();assert.equal(h.$('error').hidden,true);assert.ok(+h.$('qMagnitude').textContent>.9);assert.equal(h.$('momentumMap').querySelectorAll('circle').length,+h.$('pointCount').textContent+2);
  await h.input('incidence',75);await h.input('loss',0);assert.equal(h.$('qParallel').textContent,'0.0000');
  const restored=harness(h.storage.get('rixs-cut-planner.v1'));assert.equal(restored.$('incidence').value,'75');assert.equal(restored.$('qParallel').textContent,'0.0000');
});
test('UI rejects unreachable incidence transactionally and preserves the last geometry',async()=>{
  const h=harness(),saved=h.storage.get('rixs-cut-planner.v1');await h.input('incidence',180);
  assert.equal(h.$('angleError').hidden,false);assert.equal(h.$('error').hidden,true);assert.equal(h.$('incidence').value,'25');assert.ok(+h.$('qMagnitude').textContent>0);assert.equal(h.storage.get('rixs-cut-planner.v1'),saved);
  await h.input('incidence',25);assert.equal(h.$('error').hidden,true);assert.equal(h.$('scanDownload').disabled,false);
});
test('UI scan slider, crystal restrictions, edge application and reference search',async()=>{
  const h=harness();h.$('startRange').value='12';await h.$('startRange').emit('input');assert.equal(h.$('start').value,'12');
  await h.input('lattice','hexagonal');assert.equal(h.$('b').disabled,true);
  await h.input('lattice','orthorhombic');assert.equal(h.$('b').disabled,false);
  await h.$('elements').children.find(b=>b.dataset.element==='O').click();await h.$('edgeTable').children[0].querySelector('button').click();assert.equal(h.$('energy').value,'531');assert.equal(h.$('resonance').value,'932.7');await h.$('elements').children[0].click();
  await h.input('edgeSearch','Cu');assert.equal(h.$('edgeTable').children.length,7);
  await h.input('edgeSearch','no-match');assert.equal(h.$('edgeTable').children.length,1);assert.match(h.$('edgeTable').textContent,/No matching reference/);
});
test('UI downloads contain matching CSV data and reproducible settings',async()=>{
  const h=harness();for(const id of ['scanDownload','spectrumDownload','heatmapDownload','saveSettings'])await h.$(id).click();
  assert.equal(h.downloads.length,4);const find=part=>h.downloads.find(v=>v.name.includes(part)).blob.text();
  const rows=(await find('scan')).split('\n').filter(x=>!x.startsWith('#'));assert.equal(rows.length,+h.$('pointCount').textContent+1);assert.equal(rows[0].split(',').length,18);assert.equal(rows[1].split(',').length,18);assert.equal(+rows[1].split(',')[1],10);assert.equal(+rows.at(-1).split(',')[1],140);
  const spec=(await find('spectrum')).split('\n').filter(x=>!x.startsWith('#')).slice(1).map(x=>x.split(',').map(Number));
  assert.ok(spec.length>=801);for(const row of spec)assert.ok(Math.abs(row[1]-row.slice(2).reduce((a,b)=>a+b,0))<1e-10);
  const heat=(await find('intensity')).split('\n').filter(x=>!x.startsWith('#'));assert.equal(heat.length,101*240+1);
  const data=JSON.parse(await find('settings'));assert.equal(data.version,1);assert.equal(data.settings.energy,932.7);
  await h.input('energy',1000);h.$('loadSettings').files=[{size:1000,text:async()=>JSON.stringify(data)}];await h.$('loadSettings').emit('change');assert.equal(h.$('energy').value,'932.7');
});
test('UI rejects malformed JSON and corrupted saved settings safely',async()=>{
  const h=harness('{broken');assert.equal(h.$('energy').value,'932.7');assert.equal(h.$('message').hidden,false);
  await h.input('energy',950);h.$('loadSettings').files=[{size:100,text:async()=>JSON.stringify({version:1,settings:{energy:'not-number'}})}];await h.$('loadSettings').emit('change');assert.equal(h.$('energy').value,'950');assert.match(h.$('message').textContent,/Could not load settings/);
  await h.$('reset').click();assert.equal(h.$('energy').value,'932.7');assert.equal(h.$('error').hidden,true);
});

test('configuration order and unit-aware map readout follow the revised layout',async()=>{
  const h=harness(),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal(h.$('edge'),null);assert.ok(html.indexOf('id="energy"')<html.indexOf('id="lattice"'));assert.ok(html.indexOf('id="scattering"')<html.indexOf('id="lattice"'));assert.ok(html.indexOf('model-fields')<html.indexOf('id="resonance"'));
  const physical=h.$('hkl').textContent;await h.input('units','rlu');assert.equal(h.$('momentumUnit').textContent,'r.l.u.');assert.equal(h.$('scalarReadouts').hidden,true);assert.equal(h.$('vectorLabel').textContent,'(H, K, L)');assert.notEqual(h.$('hkl').textContent,physical);
  await h.input('units','angstrom');assert.equal(h.$('scalarReadouts').hidden,false);assert.equal(h.$('hkl').textContent,physical);
});
test('3D rotation, pan, zoom and view reset leave scientific settings unchanged',async()=>{
  const h=harness();await h.input('dimension',3);
  const map=h.$('momentumMap'),q=h.$('hkl').textContent,initial=map.getAttribute('data-camera');
  await map.emit('pointerdown',{button:0,pointerId:1,clientX:400,clientY:200});await map.emit('pointermove',{pointerId:1,clientX:460,clientY:220});await map.emit('pointerup',{pointerId:1});
  assert.notEqual(map.getAttribute('data-camera'),initial);assert.equal(h.$('hkl').textContent,q);
  await h.$('mapPan').click();const camera=map.getAttribute('data-camera');await map.emit('pointerdown',{button:0,pointerId:2,clientX:400,clientY:200});const before=map.querySelector('circle').getAttribute('cx');await map.emit('pointermove',{pointerId:2,clientX:440,clientY:200});await map.emit('pointerup',{pointerId:2});
  assert.equal(map.getAttribute('data-camera'),camera);assert.notEqual(map.querySelector('circle').getAttribute('cx'),before);
  const beforeZoom=map.querySelector('circle').getAttribute('cx');await h.$('zoomIn').click();assert.notEqual(map.querySelector('circle').getAttribute('cx'),beforeZoom);await h.$('mapReset').click();assert.equal(map.getAttribute('data-camera'),initial);
  await h.$('mapRotate').click();await map.emit('keydown',{key:'ArrowRight'});assert.notEqual(map.getAttribute('data-camera'),initial);assert.equal(h.$('hkl').textContent,q);
});
test('touch pinch changes the camera scale and point clicks change the selected angle',async()=>{
  const h=harness(),map=h.$('momentumMap');
  await map.emit('pointerdown',{button:0,pointerId:1,pointerType:'touch',clientX:300,clientY:200});await map.emit('pointerdown',{button:0,pointerId:2,pointerType:'touch',clientX:500,clientY:200});
  const before=map.querySelector('circle').getAttribute('cx');await map.emit('pointermove',{pointerId:2,pointerType:'touch',clientX:600,clientY:200});assert.notEqual(map.querySelector('circle').getAttribute('cx'),before);
  await map.emit('pointerup',{pointerId:1});await map.emit('pointerup',{pointerId:2});await map.emit('click',{clientX:0,clientY:0});await h.$('mapReset').click();
  const point=map.querySelectorAll('circle').find(p=>p.attrs['data-scan-index']==='0');await map.emit('click',{clientX:+point.attrs.cx,clientY:+point.attrs.cy});assert.equal(h.$('incidence').value,'10');
});
test('nearby-zone checkbox, centering choices and three-dimensional mode persist',async()=>{
  const h=harness();h.$('allZones').checked=true;await h.$('allZones').emit('input');assert.ok(+h.$('momentumMap').getAttribute('data-zone-count')>1);
  await h.input('lattice','cubic');await h.input('centering','F');await h.input('dimension',3);
  const restored=harness(h.storage.get('rixs-cut-planner.v1'));assert.equal(restored.$('centering').value,'F');assert.equal(restored.$('momentumMap').getAttribute('data-view'),'3d');assert.equal(restored.$('allZones').checked,true);
  await h.input('lattice','hexagonal');assert.equal(h.$('centering').value,'P');assert.equal(h.$('gamma').value,'120');
  await h.input('lattice','triclinic');await h.input('alpha','');assert.equal(h.$('error').hidden,false);await h.input('lattice','cubic');assert.equal(h.$('error').hidden,true);
});

test('K-up camera preserves vertical direction and vector lengths across full rotations',()=>{
  const {camera}=harness().ctx.RIXSMap;
  for(const yaw of [-4*Math.PI,-Math.PI,-.2,0,Math.PI/2,Math.PI,4*Math.PI])for(const degrees of [-85,-45,0,45,85]){
    const up=camera([0,1,0],yaw,degrees*Math.PI/180);
    assert.ok(Math.abs(up[0])<1e-12,'K axis must not roll sideways');assert.ok(up[1]>.08,'positive K must remain visibly upward');
    const v=[.7,-.2,1.3],rotated=camera(v,yaw,degrees*Math.PI/180);assert.ok(Math.abs(Math.hypot(...v)-Math.hypot(...rotated))<1e-12);
  }
});
test('mouse, touch and keyboard rotation stop before the K-up poles in both units',async()=>{
  const h=harness(),svg=h.$('momentumMap');await h.input('dimension',3);
  for(const units of ['angstrom','rlu']){
    await h.input('units',units);const q=h.$('hkl').textContent;
    for(const [pointerType,dy]of [['mouse',10000],['touch',-10000]]){
      await svg.emit('pointerdown',{button:0,pointerId:1,pointerType,clientX:400,clientY:200});await svg.emit('pointermove',{pointerId:1,pointerType,clientX:800,clientY:200+dy});await svg.emit('pointerup',{pointerId:1});
      const [yaw,pitch]=svg.getAttribute('data-camera').split(',').map(Number);assert.ok(Math.abs(pitch)<=85*Math.PI/180);assert.ok(h.ctx.RIXSMap.camera([0,1,0],yaw,pitch)[1]>.08);
    }
    for(let i=0;i<40;i++)await svg.emit('keydown',{key:'ArrowDown'});
    const pitch=+svg.getAttribute('data-camera').split(',')[1];assert.ok(Math.abs(pitch-85*Math.PI/180)<1e-12);assert.equal(h.$('hkl').textContent,q);
    await h.$('mapReset').click();const [yaw,resetPitch]=svg.getAttribute('data-camera').split(',').map(Number);assert.ok(h.ctx.RIXSMap.camera([0,1,0],yaw,resetPitch)[1]>.08);
  }
});


test('view presets retain 3D mode and use ordinary buttons; dimension is a lattice control',async()=>{
  const h=harness();assert.equal(h.$('dimension').tagName,'select');await h.input('dimension',3);
  const buttons=h.document.querySelectorAll('button').filter(b=>b.dataset.view),svg=h.$('momentumMap');
  for(const button of buttons){
    assert.equal(button.getAttribute('aria-pressed'),undefined);await button.click();assert.equal(h.$('dimension').value,'3');assert.equal(svg.getAttribute('data-view'),'3d');
    const [yaw,pitch]=svg.getAttribute('data-camera').split(',').map(Number),camera=h.ctx.RIXSMap.camera;
    const right=button.dataset.view==='zy'?[0,0,1]:[1,0,0],up=button.dataset.view==='xz'?[0,0,1]:[0,1,0];
    assert.ok(Math.abs(camera(right,yaw,pitch)[0]-1)<1e-12);assert.ok(Math.abs(camera(up,yaw,pitch)[1]-1)<1e-12);
  }
  await buttons.find(b=>b.dataset.view==='xz').click();await svg.emit('keydown',{key:'ArrowRight'});assert.ok(Math.abs(+svg.getAttribute('data-camera').split(',')[1])<=85*Math.PI/180);
  await h.input('dimension',2);await buttons.find(b=>b.dataset.view==='zy').click();assert.equal(svg.getAttribute('data-view'),'zy');assert.equal(h.$('mapRotate').hidden,true);
});
test('incidence slider preserves 2theta or L and rejects unreachable L without changing the last geometry',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings;
  await h.input('incidenceRange',30);assert.equal(state().incidence,30);assert.equal(state().scattering,150);
  await h.input('tilt',20);await h.input('angleMode','l');const locked=state().lockedL;assert.equal(h.$('scattering').disabled,true);
  await h.input('incidenceRange',26);assert.equal(state().incidence,26);assert.notEqual(state().scattering,150);assert.ok(Math.abs(h.ctx.RIXS.momentum(state()).hkl[2]-locked)<1e-10);
  const previous=state();await h.input('incidenceRange',80);assert.equal(h.$('angleError').hidden,false);assert.deepEqual(state(),previous);assert.equal(+h.$('incidence').value,26);
  await h.input('angleMode','scattering');assert.equal(h.$('scattering').disabled,false);assert.equal(h.$('angleError').hidden,true);
});
test('scan-only errors retain live geometry, spectrum and L-locked controls',async()=>{
  const h=harness();await h.input('angleMode','l');await h.input('incidenceRange',20);
  assert.equal(h.$('scanError').hidden,true);await h.input('end',130);
  assert.equal(h.$('error').hidden,true);assert.equal(h.$('scanError').hidden,false);assert.ok(+h.$('scattering').value<140);assert.ok(+h.$('qMagnitude').textContent>0);assert.equal(h.$('scanDownload').disabled,true);assert.equal(h.$('spectrumDownload').disabled,false);
  await h.$('scanDownload').click();assert.equal(h.downloads.length,0);
  await h.input('end',30);assert.equal(h.$('scanError').hidden,true);assert.equal(h.$('scanDownload').disabled,false);
  await h.input('hStep',.000001);assert.equal(h.$('scanError').hidden,false);assert.match(h.$('scanError').textContent,/2,001/);
  await h.input('hStep',.02);assert.equal(h.$('scanError').hidden,true);
});
test('CSV includes tilt, derived timing and momentum steps in map units',async()=>{
  const h=harness();await h.input('tilt',25);await h.input('units','rlu');await h.input('hStep',.025);await h.$('scanDownload').click();
  const csv=await h.downloads[0].blob.text(),lines=csv.split('\n').filter(l=>!l.startsWith('#')),rows=lines.slice(1).map(l=>l.split(',').map(Number));
  assert.equal(+h.$('pointCount').textContent,rows.length);assert.equal(h.$('scanTime').textContent,(rows.length*30/60).toFixed(1)+' min');
  for(let i=1;i<rows.length-1;i++)assert.ok(Math.abs(Math.abs(rows[i][11]-rows[i-1][11])-.025)<1e-10);
  assert.ok(rows.every(row=>row[16]===25&&row[12]>0));
  const count=rows.length;await h.input('units','angstrom');assert.equal(+h.$('pointCount').textContent,count);const physicalStep=.025*2*Math.PI/3.85;assert.ok(Math.abs(+h.$('hStep').value-physicalStep)<1e-12);await h.$('scanDownload').click();const physical=(await h.downloads.at(-1).blob.text()).split('\n').filter(l=>!l.startsWith('#')).slice(1).map(l=>l.split(',').map(Number));for(let i=1;i<physical.length-1;i++)assert.ok(Math.abs(Math.abs(physical[i][6]-physical[i-1][6])-physicalStep)<1e-10);assert.equal(physical[0][14],.5);
});


test('English source and default UI switch to Japanese without changing conditions or camera',async()=>{
  const h=harness(),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/<html lang="en">/);assert.doesNotMatch(html,/[ぁ-んァ-ヶ一-龠]/);
  assert.equal(h.document.documentElement.getAttribute('lang'),'en');assert.equal(h.$('saveSettings').textContent,'Save settings');
  assert.match(h.$('spectrumSummary').textContent,/Dispersive peak/);assert.match(h.$('momentumMap').getAttribute('aria-label'),/Interactive/);
  await h.input('dimension',3);await h.input('tilt',22);await h.$('mapPan').click();await h.$('zoomIn').click();
  const svg=h.$('momentumMap'),camera=svg.getAttribute('data-camera'),point=svg.querySelector('circle').getAttribute('cx'),q=h.$('hkl').textContent,saved=h.storage.get('rixs-cut-planner.v1');
  h.$('language').value='ja';await h.$('language').emit('change');
  assert.equal(h.document.documentElement.getAttribute('lang'),'ja');assert.equal(h.$('saveSettings').textContent,'設定を保存');assert.match(h.$('spectrumSummary').textContent,/分散ピーク/);assert.match(svg.getAttribute('aria-label'),/操作可能/);
  assert.equal(h.$('energy').value,'932.7');assert.equal(h.$('hkl').textContent,q);assert.equal(h.storage.get('rixs-cut-planner.v1'),saved);assert.equal(svg.getAttribute('data-camera'),camera);assert.equal(svg.querySelector('circle').getAttribute('cx'),point);assert.equal(svg.getAttribute('data-drag-mode'),'pan');
  const restored=harness(saved,h.storage.get('rixs-language'));assert.equal(restored.$('language').value,'ja');assert.equal(restored.$('saveSettings').textContent,'設定を保存');
  h.$('language').value='en';await h.$('language').emit('change');assert.equal(h.$('saveSettings').textContent,'Save settings');assert.equal(h.$('hkl').textContent,q);
});
test('validation, fixed-L rejection and notifications follow language changes',async()=>{
  const h=harness(),lang=async value=>{h.$('language').value=value;await h.$('language').emit('change');};
  await h.input('incidence',180);assert.match(h.$('angleError').textContent,/outside/);await lang('ja');assert.match(h.$('angleError').textContent,/範囲外/);assert.equal(h.$('incidence').value,'25');
  await h.input('incidence',25);await h.input('angleMode','l');await h.input('incidenceRange',80);assert.match(h.$('angleError').textContent,/直前の配置/);await lang('en');assert.match(h.$('angleError').textContent,/previous geometry/);
  await h.input('angleMode','scattering');await h.$('saveSettings').click();assert.match(h.$('message').textContent,/Settings saved/);await lang('ja');assert.match(h.$('message').textContent,/JSON に保存/);
  h.$('loadSettings').files=[{size:100001,text:async()=>''}];await h.$('loadSettings').emit('change');assert.match(h.$('message').textContent,/大きすぎ/);await lang('en');assert.match(h.$('message').textContent,/too large/);assert.doesNotMatch(h.$('message').textContent,/[ぁ-んァ-ヶ一-龠]/);
});
test('current 3D hairlines project to back panes and follow units, angles and camera',async()=>{
  const h=harness(),svg=h.$('momentumMap');assert.equal(svg.querySelector('[data-current-hairlines]'),null);
  await h.input('dimension',3);await h.input('tilt',25);const guides=()=>svg.querySelector('[data-current-hairlines]');assert.equal(guides().querySelectorAll('line').length,9);
  for(const units of ['angstrom','rlu']){
    await h.input('units',units);const state=JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings,q=h.ctx.RIXS.displayVector(h.ctx.RIXS.momentum(state).q,state);
    const lines=guides().querySelectorAll('line'),spikes=lines.filter(l=>l.getAttribute('data-guide-kind')==='spike');assert.equal(spikes.length,3);
    for(const line of spikes){const a=line.getAttribute('data-from').split(',').map(Number),b=line.getAttribute('data-to').split(',').map(Number),axis=+line.getAttribute('data-guide-axis');a.forEach((v,i)=>assert.ok(Math.abs(v-q[i])<1e-12));for(let i=0;i<3;i++)if(i!==axis)assert.equal(a[i],b[i]);}
    const before=spikes[0].getAttribute('x1');await svg.emit('keydown',{key:'ArrowRight'});assert.notEqual(guides().querySelector('line').getAttribute('x1'),before);
  }
  await h.document.querySelectorAll('button').find(b=>b.dataset.view==='xy').click();assert.equal(guides().querySelectorAll('line').length,3);
  const before=guides().querySelector('line').getAttribute('data-from');await h.input('incidence',35);assert.notEqual(guides().querySelector('line').getAttribute('data-from'),before);
  await h.input('dimension',2);assert.equal(guides(),null);
});
test('map controls share the readout row and projected crosses are on their respective panes',()=>{
  const h=harness(),tools=h.$('mapPan').parent,row=tools.parent;assert.equal(row.getAttribute('class'),'map-readout-row');assert.ok(row.querySelector('#hkl'));
  const {projectionGuides,camera}=h.ctx.RIXSMap,point=[.4,.2,-.7],min=[-1,-1,-1],max=[1,1,1];
  for(const yaw of [-2,.3,2]){
    const segments=projectionGuides(point,min,max,yaw,.4);assert.equal(segments.length,9);
    for(const segment of segments){const axis=segment.axis,unit=[0,0,0];unit[axis]=1;const side=camera(unit,yaw,.4)[2]>=0?-1:1;assert.equal(segment.b[axis],side);if(segment.kind==='projection'){assert.equal(segment.a[axis],side);const changed=segment.a.map((v,i)=>v!==segment.b[i]?i:-1).filter(i=>i>=0);assert.equal(changed.length,1);assert.equal(segment.a[changed[0]],-1);assert.equal(segment.b[changed[0]],1);}}
  }
});


test('fixed-L mode resets the full range and exports the changing scattering geometry',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings;
  await h.input('units','rlu');await h.input('tilt',25);await h.input('angleMode','l');const locked=state().lockedL,range=h.ctx.RIXS.scanLimits(state());
  assert.equal(+h.$('start').value,range.min);assert.equal(+h.$('end').value,range.max);assert.equal(+h.$('startRange').min,range.min);assert.equal(+h.$('endRange').max,range.max);assert.match(h.$('scanModeNote').textContent,/L stays fixed/);assert.equal(h.$('scanError').hidden,true);
  h.$('allZones').checked=true;await h.$('allZones').emit('input');assert.equal(h.$('error').hidden,true);
  await h.$('scanDownload').click();const csv=await h.downloads[0].blob.text(),rows=csv.split('\n').filter(l=>!l.startsWith('#')).slice(1).map(l=>l.split(',').map(Number));
  assert.equal(rows.length,+h.$('pointCount').textContent);assert.ok(rows.at(-1)[15]>rows[0][15]);
  for(let i=0;i<rows.length;i++){assert.ok(Math.abs(rows[i][13]-locked)<1e-10);assert.ok(Math.abs(rows[i][1]+rows[i][2]-rows[i][15])<1e-10);if(i>0&&i<rows.length-1)assert.ok(Math.abs(Math.abs(rows[i][11]-rows[i-1][11])-state().hStep)<1e-10);}
  const start=h.$('start').value,end=h.$('end').value;await h.input('incidenceRange',20);assert.equal(h.$('start').value,start);assert.equal(h.$('end').value,end);assert.equal(h.$('scanError').hidden,true);
  h.$('language').value='ja';await h.$('language').emit('change');assert.match(h.$('scanModeNote').textContent,/L を固定/);assert.match(h.$('scanRangeNote').textContent,/走査可能/);
  await h.input('angleMode','scattering');assert.match(h.$('scanModeNote').textContent,/2θ を固定/);await h.$('scanDownload').click();const fixed=(await h.downloads.at(-1).blob.text()).split('\n').filter(l=>!l.startsWith('#')).slice(1).map(l=>l.split(',').map(Number));assert.ok(fixed.every(row=>row[15]===state().scattering));
});
test('box headings have no ordinal numbers in either language',async()=>{
  const h=harness(),html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.doesNotMatch(html,/class="section-number"/);assert.doesNotMatch(html,/<h2><span>0[1-9]<\/span>/);
  for(const language of ['en','ja']){h.$('language').value=language;await h.$('language').emit('change');for(const heading of h.document.querySelectorAll('h2'))assert.doesNotMatch(heading.textContent,/^\s*0[1-9]/);}
});

test('horizontal drag follows ARPES direction; hover draws and clears projection Hair',async()=>{
  const h=harness();await h.input('dimension',3);const svg=h.$('momentumMap'),before=+svg.getAttribute('data-camera').split(',')[0];
  await svg.emit('pointerdown',{button:0,pointerId:1,clientX:400,clientY:200});await svg.emit('pointermove',{pointerId:1,clientX:460,clientY:200});await svg.emit('pointerup',{pointerId:1});assert.ok(+svg.getAttribute('data-camera').split(',')[0]<before);
  const point=svg.querySelectorAll('circle').find(p=>p.getAttribute('data-scan-index')==='20');await svg.emit('pointermove',{pointerId:2,clientX:+point.attrs.cx,clientY:+point.attrs.cy});assert.equal(svg.querySelector('[data-hover-hairlines]').querySelectorAll('line').length,9);assert.equal(h.$('mapTooltip').hidden,false);
  await svg.emit('pointerleave');assert.equal(svg.querySelector('[data-hover-hairlines]').children.length,0);assert.equal(h.$('mapTooltip').hidden,true);
  assert.match(fs.readFileSync(path.join(root,'assets/css/app.css'),'utf8'),/#momentumMap[^\n]+cursor:default/);
});
test('HK controls and scan table apply the same full geometry',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings,M=h.ctx.RIXS;
  await h.input('tilt',20);await h.input('azimuth',25);await h.input('angleMode','hk');assert.equal(h.$('scattering').disabled,true);assert.equal(h.$('momentumComponent').value,'2');
  const locked=[state().lockedH,state().lockedK];await h.input('incidence',30);assert.ok(Math.abs(state().incidence-30)<1e-5);
  const q=M.momentum(state());for(let i=0;i<2;i++)assert.ok(Math.abs(q.hkl[i]-locked[i])<1e-9);
  assert.equal(h.$('scanPoints').children.length,+h.$('pointCount').textContent);const first=h.$('scanPoints').children[0];const alpha=+first.children[1].textContent;await first.querySelector('button').click();assert.ok(Math.abs(state().incidence-alpha)<1e-5);
  await h.input('incidence',1000);assert.equal(h.$('angleError').hidden,false);assert.ok(Math.abs(state().incidence-alpha)<1e-5);
});
test('range units and step labels follow map units; only a changed feasible width resets the range',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings,M=h.ctx.RIXS;
  await h.input('start',20);await h.input('end',30);await h.input('scattering',130);assert.equal(state().start,.1);assert.equal(state().end,129.9);
  await h.input('start',20);await h.input('incidence',35);assert.equal(state().start,20);
  await h.input('scanAxis','azimuth');assert.equal(state().start,-180);assert.equal(state().end,180);assert.equal(state().scanComponent,1);assert.match(h.$('stepLabel').textContent,/qᵧ.*Å⁻¹/);
  await h.input('scanRangeUnit','momentum');const target=M.componentValue(state(),-120);await h.input('start',target);assert.ok(Math.abs(state().start+120)<1e-5);assert.match(h.$('startLabel').textContent,/Å⁻¹/);
  await h.input('units','rlu');assert.match(h.$('startLabel').textContent,/r.l.u./);assert.match(h.$('stepLabel').textContent,/K.*r.l.u./);assert.ok(Math.abs(+h.$('start').value-M.componentValue(state(),state().start))<1e-9);
  await h.input('scanRangeUnit','angle');await h.input('scanAxis','tilt');assert.equal(state().start,-85);assert.equal(state().end,85);
});
test('scan visibility does not discard measurement points or CSV; exposure is in minutes',async()=>{
  const h=harness();const count=+h.$('pointCount').textContent;h.$('showScan').checked=false;await h.$('showScan').emit('input');assert.equal(h.$('momentumMap').querySelectorAll('[data-scan-index]').length,0);assert.equal(h.$('scanPoints').children.length,count);
  await h.input('dwell',2);assert.equal(h.$('scanTime').textContent,(count*2<60?(count*2).toFixed(1)+' min':(count*2/60).toFixed(2)+' h'));
  await h.$('scanDownload').click();const csv=await h.downloads[0].blob.text(),rows=csv.split('\n').filter(l=>!l.startsWith('#'));assert.match(rows[0],/dwell_min/);assert.equal(+rows[1].split(',')[14],2);
  h.$('showScan').checked=true;await h.$('showScan').emit('input');assert.equal(h.$('momentumMap').querySelectorAll('[data-scan-index]').length,count);
});
test('periodic table contains H-U; reference and collapsed simulation occupy the requested rows',async()=>{
  const h=harness(),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),elements=h.$('elements').children.filter(b=>b.dataset.element);
  assert.equal(elements.length,92);assert.ok(elements.every(b=>+b.style.gridColumn>=1&&+b.style.gridColumn<=18));
  assert.ok(html.indexOf('id="scanPoints"')<html.indexOf('aria-labelledby="referenceTitle"'));assert.ok(html.indexOf('aria-labelledby="referenceTitle"')<html.indexOf('id="energySimulation"'));
  assert.equal(h.$('energySimulation').getAttribute('open'),undefined);assert.ok(h.$('energySimulation').querySelector('#spectrum'));assert.ok(h.$('energySimulation').querySelector('#heatmap'));assert.ok(h.$('energySimulation').querySelector('#resonance'));
  await elements.find(b=>b.dataset.element==='U').click();await h.$('edgeTable').children[0].querySelector('button').click();assert.equal(+h.$('energy').value,115606);assert.equal(h.$('error').hidden,true);
  await elements.find(b=>b.dataset.element==='H').click();await h.$('edgeTable').children[0].querySelector('button').click();assert.equal(+h.$('energy').value,13.6);assert.equal(h.$('error').hidden,true);
});
test('new controls and explanatory text switch languages and preserve all scan settings',async()=>{
  const h=harness();await h.input('scanAxis','tilt');await h.input('scanRangeUnit','momentum');const saved=h.storage.get('rixs-cut-planner.v1');h.$('language').value='ja';await h.$('language').emit('change');assert.match(h.$('pointsTitle').textContent,/測定点/);assert.match(h.$('scanRangeNote').textContent,/最大範囲/);assert.match(h.$('startLabel').textContent,/開始/);assert.equal(h.storage.get('rixs-cut-planner.v1'),saved);
});

test('momentum typing is deferred until Calculate and follows the main map units',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings,M=h.ctx.RIXS;
  assert.equal(h.$('incidenceUnit'),null);assert.equal(h.$('incidenceComponent'),null);
  assert.ok(h.$('momentumMap').parent.parent.querySelector('#showScan'));assert.equal(h.$('scanTitle').parent.parent.querySelector('#showScan'),null);
  await h.input('start',20);await h.input('end',40);
  const saved=h.storage.get('rixs-cut-planner.v1');h.document.activeElement=h.$('momentumTarget');
  for(const value of ['', '-', '0.', '0.2']){await h.input('momentumTarget',value);assert.equal(h.storage.get('rixs-cut-planner.v1'),saved);assert.equal(h.$('momentumTarget').value,value);}
  await h.$('calculateAngles').click();assert.equal(h.$('angleError').hidden,true);assert.ok(Math.abs(M.momentum(state()).q[0]-.2)<1e-8);
  assert.equal(state().scattering,150);assert.equal(state().start,20);assert.equal(state().end,40);
  await h.input('units','rlu');assert.equal(h.$('momentumTargetUnit').textContent,'r.l.u.');assert.equal(h.$('momentumComponent').children[0].textContent,'H');
  await h.input('momentumTarget',.2);await h.$('calculateAngles').click();assert.ok(Math.abs(M.momentum(state()).hkl[0]-.2)<1e-8);
  assert.equal(+h.$('incidence').value,state().incidence);
  const before=state();await h.input('momentumTarget',1000);await h.$('calculateAngles').click();assert.equal(h.$('angleError').hidden,false);assert.deepEqual(state(),before);
  await h.input('momentumTarget','');await h.$('calculateAngles').click();assert.match(h.$('angleError').textContent,/finite/);assert.deepEqual(state(),before);
});
test('momentum Calculate in both nonfixed modes updates alpha and 2theta while retaining phi and tilt',async()=>{
  for(const angleMode of ['l','hk']){
    const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings,M=h.ctx.RIXS;
    await h.input('azimuth',25);if(angleMode==='l')await h.input('tilt',20);
    await h.input('angleMode',angleMode);await h.input('momentumComponent',angleMode==='hk'?2:0);
    const before=state(),expected=M.geometryAt(before,'incidence',30),target=M.momentum(expected).q[state().momentumComponent];
    await h.input('momentumTarget',target);assert.deepEqual(state(),before);await h.$('calculateAngles').click();
    assert.equal(h.$('angleError').hidden,true);assert.ok(Math.abs(state().incidence-30)<1e-5);assert.notEqual(state().scattering,before.scattering);
    assert.equal(state().azimuth,before.azimuth);assert.equal(state().tilt,before.tilt);
    if(angleMode==='l')assert.ok(Math.abs(M.momentum(state()).hkl[2]-before.lockedL)<1e-8);
    else{const p=M.momentum(state());assert.ok(Math.abs(p.hkl[0]-before.lockedH)<1e-8);assert.ok(Math.abs(p.hkl[1]-before.lockedK)<1e-8);}
  }
});
test('custom scan endpoints survive changes that keep the available angular width',async()=>{
  const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings;
  await h.input('start',20);await h.input('end',40);
  for(const [id,value]of [['incidence',30],['incidenceRange',35],['azimuth',20],['tilt',10],['energy',950],['a',4],['loss',.5],['units','rlu'],['showScan',true]]){
    await h.input(id,value);assert.equal(state().start,20,id);assert.equal(state().end,40,id);
  }
  // Selecting a reference changes energy, but not the fixed-2theta width.
  await h.$('edgeTable').children[0].querySelector('button').click();assert.equal(state().start,20);assert.equal(state().end,40);
  await h.input('scattering',130);assert.equal(state().start,.1);assert.equal(state().end,129.9);
  await h.input('scanAxis','azimuth');await h.input('start',-50);await h.input('end',70);await h.input('azimuth',20);
  // The full azimuth interval moved by zero (it was already centered on 20).
  assert.equal(state().start,-50);assert.equal(state().end,70);
});
test('alpha changes reuse scan calculation, measurement rows, reference rows and expanded heatmap',async()=>{
  const h=harness(),M=h.ctx.RIXS;let scans=0,heatmaps=0;
  const scan=M.scan,heatmap=M.heatmap;M.scan=(...args)=>{scans++;return scan(...args);};M.heatmap=(...args)=>{heatmaps++;return heatmap(...args);};
  const first=h.$('scanPoints').children[0],reference=h.$('edgeTable').children[0];
  h.$('energySimulation').open=true;await h.$('energySimulation').emit('toggle');
  for(let i=0;i<5;i++)await h.input('incidenceRange',26+i);
  assert.equal(scans,0);assert.equal(heatmaps,1);assert.equal(h.$('scanPoints').children[0],first);assert.equal(h.$('edgeTable').children[0],reference);
  await h.input('scattering',140);assert.equal(scans,1);assert.equal(heatmaps,2);assert.notEqual(h.$('scanPoints').children[0],first);
  await h.input('incidence',-1);await h.input('incidence',30);assert.equal(h.$('error').hidden,true);assert.equal(h.$('scanPoints').children.length,+h.$('pointCount').textContent);
});


test('unit dropdown converts the scan step for each component and persists the converted value',async()=>{
  for(const scanRangeUnit of ['angle','momentum'])for(const component of [0,1,2]){
    const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings;
    await h.input('lattice','orthorhombic');await h.input('a',4);await h.input('b',5);await h.input('c',12);
    await h.input('scanComponent',component);await h.input('scanRangeUnit',scanRangeUnit);await h.input('hStep',.02);
    const before=state(),count=+h.$('pointCount').textContent,expected=.02*[4,5,12][component]/(2*Math.PI);
    await h.input('units','rlu');
    assert.ok(Math.abs(+h.$('hStep').value-expected)<1e-12);
    assert.equal(state().hStep,+h.$('hStep').value);assert.equal(state().start,before.start);assert.equal(state().end,before.end);
    assert.equal(+h.$('pointCount').textContent,count);
    await h.input('energy',950);assert.equal(state().hStep,+h.$('hStep').value);
    const restored=harness(h.storage.get('rixs-cut-planner.v1'));assert.equal(+restored.$('hStep').value,expected);
    await h.input('units','angstrom');assert.ok(Math.abs(+h.$('hStep').value-.02)<1e-12);
    await h.input('hStep',.03);await h.input('units','rlu');
    assert.ok(Math.abs(state().hStep-.03*[4,5,12][component]/(2*Math.PI))<1e-12);
  }
});

test('step conversion uses the map coordinate transform for skew cells and is reversible',async()=>{
  for(const component of [0,1,2]){
    const h=harness(),state=()=>JSON.parse(h.storage.get('rixs-cut-planner.v1')).settings;
    await h.input('lattice','triclinic');await h.input('alpha',75);await h.input('beta',80);await h.input('gamma',100);
    await h.input('scanComponent',component);await h.input('hStep',.02);
    const direction=[0,0,0];direction[component]=.02;
    const expected=h.ctx.RIXS.fractional(direction,state())[component];
    await h.input('units','rlu');assert.ok(Math.abs(state().hStep-expected)<1e-12);
    await h.input('units','angstrom');assert.ok(Math.abs(state().hStep-.02)<1e-12);
  }
});
