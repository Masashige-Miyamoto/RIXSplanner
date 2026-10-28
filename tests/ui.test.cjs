// UI integration checks in a minimal DOM harness. This does not replace a real
// browser's layout, canvas or accessibility checks (see tests/browser.cjs).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

function harness(saved){
  const downloads=[],blobs=new Map(),storage=new Map(saved?[['rixs-cut-planner.v1',saved]]:[]);
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
    const el=new Element(tag);for(const m of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g))el.setAttribute(m[1],m[2]??'');stack.at(-1).append(el);if(!voidTags.has(tag))stack.push(el);
  }
  document.getElementById=id=>document.querySelector('#'+id);document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=document.querySelector('body');
  const ctx={document,console,Blob,Uint8ClampedArray,setTimeout:()=>0,requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    URL:{createObjectURL:blob=>{const id='blob:'+blobs.size;blobs.set(id,blob);return id;},revokeObjectURL(){}},
    XMLSerializer:class{serializeToString(){return '<svg xmlns="http://www.w3.org/2000/svg"/>';}}
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const file of ['reference.js','lattice.js','model.js','map.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),ctx,{filename:file});
  const $=id=>document.getElementById(id);
  return {$,document,storage,downloads,input:async(id,value)=>{$(id).value=String(value);await $(id).emit('input');},ctx};
}

test('UI starts with a complete valid calculation and restores saved conditions',async()=>{
  const h=harness();assert.equal(h.$('error').hidden,true);assert.ok(+h.$('qMagnitude').textContent>.9);assert.equal(h.$('momentumMap').querySelectorAll('circle').length,+h.$('pointCount').textContent+2);
  await h.input('incidence',75);await h.input('loss',0);assert.equal(h.$('qParallel').textContent,'0.0000');
  const restored=harness(h.storage.get('rixs-cut-planner.v1'));assert.equal(restored.$('incidence').value,'75');assert.equal(restored.$('qParallel').textContent,'0.0000');
});
test('UI invalid input clears results and preserves last valid saved settings',async()=>{
  const h=harness(),saved=h.storage.get('rixs-cut-planner.v1');await h.input('incidence',180);
  assert.equal(h.$('error').hidden,false);assert.equal(h.$('qMagnitude').textContent,'—');assert.equal(h.$('scanDownload').disabled,true);assert.equal(h.$('momentumMap').querySelectorAll('circle').length,0);assert.equal(h.storage.get('rixs-cut-planner.v1'),saved);
  await h.input('incidence',25);assert.equal(h.$('error').hidden,true);assert.equal(h.$('scanDownload').disabled,false);
});
test('UI scan slider, crystal restrictions, edge application and reference search',async()=>{
  const h=harness();h.$('startRange').value='12';await h.$('startRange').emit('input');assert.equal(h.$('start').value,'12');
  await h.input('lattice','hexagonal');assert.equal(h.$('b').disabled,true);
  await h.input('lattice','orthorhombic');assert.equal(h.$('b').disabled,false);
  await h.$('elements').children.find(b=>b.dataset.element==='O').click();await h.$('edgeTable').children[0].querySelector('button').click();assert.equal(h.$('energy').value,'531');assert.equal(h.$('resonance').value,'932.7');await h.$('elements').children[0].click();
  await h.input('edgeSearch','Cu');assert.equal(h.$('edgeTable').children.length,3);
  await h.input('edgeSearch','no-match');assert.equal(h.$('edgeTable').children.length,1);assert.match(h.$('edgeTable').textContent,/一致する参照値がありません/);
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
  await h.input('energy',950);h.$('loadSettings').files=[{size:100,text:async()=>JSON.stringify({version:1,settings:{energy:'not-number'}})}];await h.$('loadSettings').emit('change');assert.equal(h.$('energy').value,'950');assert.match(h.$('message').textContent,/読込できません/);
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
  assert.equal(h.$('error').hidden,true);assert.equal(h.$('scanError').hidden,false);assert.ok(+h.$('scattering').value<140);assert.ok(+h.$('qMagnitude').textContent>0);assert.equal(h.$('scanDownload').disabled,true);assert.equal(h.$('spectrumDownload').disabled,false);
  await h.$('scanDownload').click();assert.equal(h.downloads.length,0);
  await h.input('end',130);assert.equal(h.$('scanError').hidden,true);assert.equal(h.$('scanDownload').disabled,false);
  await h.input('hStep',.000001);assert.equal(h.$('scanError').hidden,false);assert.match(h.$('scanError').textContent,/2,001/);
  await h.input('hStep',.02);assert.equal(h.$('scanError').hidden,true);
});
test('H-spaced CSV includes tilt, derived timing and consistent unit-independent stepping',async()=>{
  const h=harness();await h.input('tilt',25);await h.input('hStep',.025);await h.input('units','rlu');await h.$('scanDownload').click();
  const csv=await h.downloads[0].blob.text(),lines=csv.split('\n').filter(l=>!l.startsWith('#')),rows=lines.slice(1).map(l=>l.split(',').map(Number));
  assert.equal(+h.$('pointCount').textContent,rows.length);assert.equal(h.$('scanTime').textContent,(rows.length*30/60).toFixed(1)+' min');
  for(let i=1;i<rows.length-1;i++)assert.ok(Math.abs(Math.abs(rows[i][11]-rows[i-1][11])-.025)<1e-10);
  assert.ok(rows.every(row=>row[16]===25&&row[12]>0));
  const count=rows.length;await h.input('units','angstrom');assert.equal(+h.$('pointCount').textContent,count);
});
