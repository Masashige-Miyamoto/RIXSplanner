/* Browser UI; the physics module is independently testable in model.js. */
(() => {
  'use strict';
  const M=window.RIXS, refs=window.RIXSReference, $=id=>document.getElementById(id);
  const KEY='rixs-cut-planner.v1';
  let state={...M.defaults}, valid=true, currentScan=[], currentSpectrum=[], currentHeatmap=null, elementFilter='', frame=0;
  const fmt=(n,d=3)=>Math.abs(n)<0.5*10**(-d)?(0).toFixed(d):n.toFixed(d);
  const svgNS='http://www.w3.org/2000/svg';
  function node(tag,attrs={},text){const el=document.createElementNS(svgNS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;return el;}
  function add(svg,tag,attrs,text){const el=node(tag,attrs,text);svg.append(el);return el;}
  function line(svg,x1,y1,x2,y2,stroke='#254047',width=1,extra={}){return add(svg,'line',{x1,y1,x2,y2,stroke,'stroke-width':width,...extra});}
  function label(svg,x,y,text,fill='#8eaaa7',size=11,anchor='middle',extra={}){return add(svg,'text',{x,y,fill,'font-size':size,'font-family':'system-ui,sans-serif','text-anchor':anchor,...extra},text);}
  function path(svg,points,color,width=2,extra={}){return add(svg,'path',{d:points.map((p,i)=>(i?'L':'M')+p.map(x=>x.toFixed(3)).join(',')).join(' '),fill:'none',stroke:color,'stroke-width':width,...extra});}
  function message(text){$('message').textContent=text;$('message').hidden=false;}
  function color(t){const a=t<.5?[103,184,244]:[119,228,200],b=t<.5?[119,228,200]:[242,212,113],u=t<.5?t*2:(t-.5)*2;return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*u)).join(',')})`;}
  function syncControls(){
    for(const el of document.querySelectorAll('[data-state]')){if(el.type==='checkbox')el.checked=state[el.id];else el.value=state[el.id];}
    syncLattice();syncSliders();syncView();syncAngleMode();$('angleError').hidden=true;
  }
  function syncLattice(){
    const c=M.cell(state),allowed=M.CENTERINGS[state.lattice]||['P'];
    if(!allowed.includes(state.centering))state.centering=allowed[0];
    $('centering').replaceChildren();for(const value of allowed){const option=document.createElement('option');option.value=value;option.textContent=value;$('centering').append(option);}$('centering').value=state.centering;
    const editable={b:['orthorhombic','monoclinic','triclinic'],c:['tetragonal','orthorhombic','hexagonal','monoclinic','triclinic'],alpha:['rhombohedral','triclinic'],beta:['monoclinic','triclinic'],gamma:['triclinic']};
    for(const [key,systems]of Object.entries(editable)){$(key).disabled=!systems.includes(state.lattice);if($(key).disabled){state[key]=['alpha','beta','gamma'].includes(key)?Math.round(c[key]/M.RAD*1e8)/1e8:c[key];$(key).value=state[key];}}
    $('latticeNote').textContent='表面法線 ∥ a × b、φ = 0 は a 軸方向。H/K/L: '+(state.lattice==='rhombohedral'?'primitive 菱面体軸。':'conventional 格子軸。')+' BZ は primitive 逆格子から計算。';
  }
  function syncSliders(){for(const key of ['start','end','incidence']){const el=$(key+'Range');el.max=key==='incidence'&&state.angleMode==='l'?179.9:Math.max(0.2,state.scattering-.1);el.value=state[key];}}
  function syncAngleMode(){
    const locked=state.angleMode==='l';$('scattering').disabled=locked;
    $('angleLockLabel').textContent=locked?'固定 L / r.l.u.':'固定 2θ / °';
    $('angleLockValue').textContent=fmt(locked?state.lockedL:state.scattering,locked?5:2);
  }
  function syncView(){
    const is3d=state.dimension===3;$('mapRotate').hidden=!is3d;
    map.setMode(is3d?'rotate':'pan');$('mapRotate').setAttribute('aria-pressed',String(is3d));$('mapPan').setAttribute('aria-pressed',String(!is3d));
    $('mapHelp').textContent=is3d?'K 軸（Å⁻¹ 表示では qᵧ）を上向きに固定して回転 · パン／右ドラッグで移動 · ホイール／ピンチで拡大 · 矢印キーで回転、Shift＋矢印で測定点を選択 · Home で表示をリセット':'点をクリックして入射角を選択 · ドラッグでパン · ホイール／ピンチで拡大 · 左右キーで測定点を選択 · BZ は表示面への投影';
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({version:1,settings:state}));}catch{message('自動保存を利用できません。「設定を保存」から JSON を保存できます。');}}
  function readInputs(){
    const next={...state};
    for(const el of document.querySelectorAll('[data-state]')){if(el.disabled)continue;next[el.id]=el.type==='checkbox'?el.checked:typeof M.defaults[el.id]==='number'?(el.value.trim()===''?NaN:Number(el.value)):el.value;}
    return next;
  }
  function updateFromInputs(e){
    const previousDimension=state.dimension,previousLattice=state.lattice;state=readInputs();syncLattice();
    if(previousLattice!==state.lattice)document.querySelector('[data-cell-details]')?.setAttribute('open','');
    if(state.angleMode==='l'&&['angleMode','energy','scattering','azimuth','tilt','loss','lattice','centering','a','b','c','alpha','beta','gamma'].includes(e?.target?.id))try{Object.assign(state,M.captureL(state));}catch{/* Validation reports incomplete lattice inputs. */}
    $('angleError').hidden=true;syncSliders();syncAngleMode();if(previousDimension!==state.dimension)syncView();schedule();
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(render);}
  function disableExports(disabled){for(const id of ['scanDownload','spectrumDownload','heatmapDownload','mapDownload','saveSettings'])$(id).disabled=disabled;}
  function clearHeatmap(){currentHeatmap=null;const cv=$('heatmap');cv.getContext('2d').clearRect(0,0,cv.width,cv.height);}
  function prepareMap(){
    try{M.validate(state);currentScan=M.scan(state);$('scanError').hidden=true;}
    catch(e){currentScan=[];$('scanError').textContent=e.message;$('scanError').hidden=false;}
    map.update(state,currentScan);
  }
  function render(){
    try{M.validate(state,{scanRange:false});prepareMap();valid=true;$('error').hidden=true;document.body.classList.remove('invalid');$('liveBadge').textContent='● LIVE';disableExports(false);if(!currentScan.length){$('scanDownload').disabled=true;$('heatmapDownload').disabled=true;}}
    catch(e){valid=false;currentScan=[];currentSpectrum=[];map.clear();$('error').textContent=e.message;$('error').hidden=false;document.body.classList.add('invalid');$('liveBadge').textContent='要確認';disableExports(true);
      for(const id of ['spectrum','geometry']){const svg=$(id);svg.replaceChildren();label(svg,id==='geometry'?200:320,100,'入力条件を確認してください','#ff9aaa',13);}
      clearHeatmap();
      for(const id of ['qMagnitude','qParallel','qNormal','hkl','exitAngle','scanTime','selectedAngle','pointCount','scanSummary','spectrumSummary','lossBadge','scanBadge','zoneSummary'])$(id).textContent='—';$('mapTooltip').hidden=true;$('scanError').hidden=true;return;
    }
    syncAngleMode();
    const q=M.momentum(state),readout=M.displayReadout(state);$('momentumUnit').textContent=readout.unit;$('scalarReadouts').hidden=!readout.scalars;
    $('qMagnitude').textContent=fmt(q.magnitude,4);$('qParallel').textContent=fmt(q.parallel,4);$('qNormal').textContent=fmt(q.normal,4);$('vectorLabel').textContent='('+readout.labels.join(', ')+')';$('hkl').textContent=readout.vector.map(v=>fmt(v,4)).join(', ');
    $('allZones').disabled=!state.showBZ;
    $('zoneSummary').textContent=state.showBZ?'表示 BZ: '+map.zones.centers.length+' · Γ₀ は原点の第1 BZ'+(map.zones.truncated?' · 表示上限に達しました。エネルギー・格子定数・スキャン範囲を狭めてください。':''):'';
    $('exitAngle').textContent=fmt(q.beta,1)+'°';$('selectedAngle').textContent=fmt(state.incidence,1)+'°';$('lossBadge').textContent='ΔE = '+fmt(state.loss)+' eV';
    $('angleStart').textContent=fmt(state.start,1)+'°';$('angleEnd').textContent=fmt(state.end,1)+'°';
    const count=currentScan.length,secs=count*state.dwell;$('pointCount').textContent=count||'—';$('scanBadge').textContent=count?count+' POINT'+(count===1?'':'S'):'要確認';
    $('scanTime').textContent=count?(secs<3600?fmt(secs/60,1)+' min':fmt(secs/3600,2)+' h'):'—';
    const hs=currentScan.map(p=>p.hkl[0]);$('scanSummary').textContent=count?'H = '+fmt(Math.min(...hs),4)+' … '+fmt(Math.max(...hs),4)+' r.l.u. · '+(count===1?'1点測定':'ΔH = '+Number(state.hStep.toPrecision(6))+' r.l.u.')+(state.incidence<state.start||state.incidence>state.end?' · 現在の入射角はスキャン範囲外です':''):'スキャン範囲・ΔH を確認してください。';
    drawGeometry();drawSpectrum();if(count)drawHeatmap();else clearHeatmap();renderReferences();persist();
  }
  function selectAngle(value){
    if(state.angleMode==='l'){
      try{const scattering=M.solveScattering(state,value);state={...state,incidence:value,scattering};$('scattering').value=scattering;}
      catch(e){$('incidence').value=state.incidence;$('incidenceRange').value=state.incidence;$('angleError').textContent=e.message+' 直前の配置を保持しています。';$('angleError').hidden=false;return;}
    }else state.incidence=value;
    $('angleError').hidden=true;$('incidence').value=Number.isFinite(value)?String(value):'';syncSliders();render();
  }
  function drawGeometry(){
    const svg=$('geometry');svg.replaceChildren();const cx=200,cy=105,r=80,ai=state.incidence*M.RAD,bo=(state.scattering-state.incidence)*M.RAD;
    const defs=add(svg,'defs');for(const [id,c]of [['incoming','#77e4c8'],['outgoing','#ffb45d'],['transfer','#b399f5']]){const m=node('marker',{id,markerWidth:7,markerHeight:7,refX:6,refY:3.5,orient:'auto'});m.append(node('path',{d:'M0,0 L7,3.5 L0,7 Z',fill:c}));defs.append(m);}
    add(svg,'rect',{x:65,y:cy,width:270,height:30,fill:'#193137'});line(svg,65,cy,335,cy,'#77948d',1.5);label(svg,310,cy+20,'sample','#77948d',10);line(svg,cx,15,cx,140,'#36565b',1,{'stroke-dasharray':'4 4'});label(svg,cx+8,17,'normal (τ = 0)','#8eaaa7',10,'start');
    const incoming=[cx-r*Math.cos(ai),cy-r*Math.sin(ai)],outgoing=[cx+r*Math.cos(bo),cy-r*Math.sin(bo)];
    line(svg,...incoming,cx,cy,'#77e4c8',2,{'marker-end':'url(#incoming)'});line(svg,cx,cy,...outgoing,'#ffb45d',2,{'marker-end':'url(#outgoing)'});
    label(svg,incoming[0]-10,incoming[1]-8,'kᵢₙ','#77e4c8',12);label(svg,outgoing[0]+12,outgoing[1]-8,'kₒᵤₜ','#ffb45d',12);
    const arc=(start,end,radius,c)=>path(svg,Array.from({length:31},(_,i)=>{const t=start+(end-start)*i/30;return[cx+radius*Math.cos(t),cy-radius*Math.sin(t)];}),c,1);
    arc(Math.PI-ai,Math.PI,30,'#77e4c8');arc(0,bo,42,'#ffb45d');arc(-ai,bo,18,'#7d9d9a');
    label(svg,65,25,'α = '+fmt(state.incidence,1)+'°','#77e4c8',11);label(svg,335,25,'β = '+fmt(state.scattering-state.incidence,1)+'°','#ffb45d',11);
    label(svg,200,159,'2θ '+fmt(state.scattering,1)+'° · τ '+fmt(state.tilt,1)+'° · φ '+fmt(state.azimuth,1)+'°','#b4c9c4',10);
    const q=M.momentum(state),qs=30/q.magnitude;line(svg,cx,cy,cx+q.parallel*qs,cy-q.planeNormal*qs,'#b399f5',1.6,{'marker-end':'url(#transfer)'});label(svg,cx+q.parallel*qs+12,cy-q.planeNormal*qs+4,'q','#b399f5',11);add(svg,'circle',{cx,cy,r:2.5,fill:'#f0f6ed'});
  }
  function drawSpectrum(){
    const count=Math.min(12001,Math.max(801,Math.ceil((state.lossMax-state.lossMin)/(state.resolution/1000)*6)+1));
    currentSpectrum=M.spectrum(state,state.incidence,count);const svg=$('spectrum');svg.replaceChildren();
    const maximum=Math.max(1e-20,...currentSpectrum.map(p=>p.intensity))*1.1,X=x=>62+(x-state.lossMin)/(state.lossMax-state.lossMin)*555,Y=y=>245-y/maximum*205;
    for(let i=0;i<=5;i++){const x=state.lossMin+(state.lossMax-state.lossMin)*i/5;line(svg,X(x),32,X(x),245,'#1d373e',1,{'stroke-dasharray':'2 4'});label(svg,X(x),265,fmt(x,2),'#8eaaa7',10);const y=maximum*i/5;line(svg,62,Y(y),617,Y(y),'#1d373e');label(svg,54,Y(y)+3,y<.01&&y>0?y.toExponential(1):fmt(y,1),'#8eaaa7',9,'end');}
    label(svg,345,291,'Energy loss / eV','#a9c1ba',11);label(svg,16,140,'Intensity / a.u.','#a9c1ba',10,'middle',{transform:'rotate(-90 16 140)'});
    const ps=M.peaks(state);
    if(state.showComponents)ps.forEach((p,j)=>path(svg,currentSpectrum.map(v=>[X(v.loss),Y(v.components[j])]),p.color,1.3,{opacity:.65,'stroke-dasharray':'4 3'}));
    path(svg,currentSpectrum.map(v=>[X(v.loss),Y(v.intensity)]),'#ddf5ec',2);
    if(state.loss>=state.lossMin&&state.loss<=state.lossMax){line(svg,X(state.loss),32,X(state.loss),245,'#ffb45d',1,{'stroke-dasharray':'4 4'});label(svg,X(state.loss)+4,25,'ΔE','#ffb45d',10,'start');}
    label(svg,608,21,`α = ${fmt(state.incidence,1)}°`,'#77e4c8',11,'end');
    const coarse=(state.lossMax-state.lossMin)/(count-1)>state.resolution/1000/3;
    $('spectrumSummary').textContent=`分散ピーク ${fmt(ps[2].center)} eV · 共鳴因子 ${M.resonanceFactor(state).toPrecision(3)} · 絶対計数ではありません${coarse?' · 表示範囲に対し分解能が細かいため範囲を狭めてください':''}`;
  }
  function heatColor(t){const stops=[[17,27,55],[40,82,125],[76,158,154],[183,216,155],[250,230,163]],v=Math.min(3.99999,Math.max(0,t)*4),i=Math.floor(v),u=v-i;return stops[i].map((x,j)=>Math.round(x+(stops[i+1][j]-x)*u));}
  function drawHeatmap(){
    currentHeatmap=M.heatmap(state,101,240);const hm=currentHeatmap,canvas=$('heatmap'),ctx=canvas.getContext('2d');
    canvas.width=1280;canvas.height=600;ctx.scale(2,2);ctx.clearRect(0,0,640,300);
    const off=document.createElement('canvas');off.width=hm.columns;off.height=hm.rows;const oc=off.getContext('2d'),im=oc.createImageData(hm.columns,hm.rows);
    for(let x=0;x<hm.columns;x++)for(let y=0;y<hm.rows;y++){const rgb=heatColor(hm.data[x][hm.rows-1-y].intensity/hm.max),idx=(y*hm.columns+x)*4;im.data[idx]=rgb[0];im.data[idx+1]=rgb[1];im.data[idx+2]=rgb[2];im.data[idx+3]=255;}
    oc.putImageData(im,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,62,20,555,225);
    ctx.fillStyle='#8eaaa7';ctx.font='10px system-ui';ctx.textAlign='center';
    for(let i=0;i<=5;i++){ctx.fillText(fmt(state.start+(state.end-state.start)*i/5,1),62+555*i/5,263);ctx.textAlign='right';ctx.fillText(fmt(state.lossMin+(state.lossMax-state.lossMin)*i/5,2),53,249-225*i/5);ctx.textAlign='center';}
    ctx.fillStyle='#a9c1ba';ctx.font='11px system-ui';ctx.fillText('入射角 α / °',340,288);ctx.save();ctx.translate(17,135);ctx.rotate(-Math.PI/2);ctx.fillText('Energy loss / eV',0,0);ctx.restore();
    if(state.incidence>=state.start&&state.incidence<=state.end&&state.start!==state.end){const x=62+(state.incidence-state.start)/(state.end-state.start)*555;ctx.strokeStyle='#ffb45d';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,245);ctx.stroke();ctx.setLineDash([]);}
  }
  function renderReferences(){
    const query=$('edgeSearch').value.trim().toLowerCase();const rows=refs.filter(r=>(!elementFilter||r.element===elementFilter)&&(!query||`${r.element} ${r.edge} ${r.energy}`.toLowerCase().includes(query)));
    $('edgeTable').replaceChildren();for(const r of rows){const selected=r.id===state.edge&&Math.abs(r.energy-state.energy)<1e-8;const tr=document.createElement('tr');if(selected)tr.className='selected';for(const text of [r.element,r.edge==='K'?'K':r.edge==='L3'?'L₃':'L₂',r.edge==='K'?'1s':r.edge==='L3'?'2p₃/₂':'2p₁/₂',fmt(r.energy,1),fmt(2*r.energy/M.HBARC*Math.sin(state.scattering*M.RAD/2),4)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}const td=document.createElement('td'),button=document.createElement('button');button.textContent=selected?'適用済み':'条件に適用';button.setAttribute('aria-label',`${r.element} ${r.edge} を条件に適用`);button.addEventListener('click',()=>applyEdge(r.id));td.append(button);tr.append(td);$('edgeTable').append(tr);}
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='一致する参照値がありません。検索語または元素フィルターを変更してください。';tr.append(td);$('edgeTable').append(tr);}
    for(const el of $('elements').children)el.setAttribute('aria-pressed',String(el.dataset.element===elementFilter));
  }
  function applyEdge(id){const r=refs.find(x=>x.id===id);state.edge=id;if(r)state.energy=r.energy;if(state.angleMode==='l')try{Object.assign(state,M.captureL(state));}catch{/* Invalid geometry is reported by render. */}syncControls();render();}
  function download(name,data,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function metadata(){return '# RIXS Cut Planner v1; q=kin-kout; surface normal || a cross b\n# settings='+JSON.stringify(state)+'\n';}
  function exportScan(){if(!valid||!currentScan.length)return;const header='index,incidence_deg,exit_deg,energy_in_eV,energy_out_eV,loss_eV,qx_A-1,qy_A-1,qz_A-1,qparallel_A-1,qabs_A-1,H_rlu,K_rlu,L_rlu,dwell_s,scattering_deg,tilt_deg,azimuth_deg\n';const rows=currentScan.map((q,i)=>[i+1,q.incidence,q.beta,state.energy,state.energy-state.loss,state.loss,...q.q,q.parallel,q.magnitude,...q.hkl,state.dwell,state.scattering,state.tilt,state.azimuth].join(','));download('rixs-scan.csv',metadata()+header+rows.join('\n'),'text/csv;charset=utf-8');message('スキャン条件と運動量を CSV に出力しました。');}
  function exportSpectrum(){if(!valid)return;download('rixs-spectrum.csv',metadata()+'# Phenomenological relative intensity; not absolute counts\nloss_eV,total_au,elastic_au,phonon_au,dispersive_au,dd_au\n'+currentSpectrum.map(p=>[p.loss,p.intensity,...p.components].join(',')).join('\n'),'text/csv;charset=utf-8');message('スペクトルと各ピーク成分を CSV に出力しました。');}
  function exportHeatmap(){if(!valid||!currentHeatmap)return;const hm=currentHeatmap,rows=[];for(let x=0;x<hm.columns;x++)for(const p of hm.data[x])rows.push([hm.angles[x],p.loss,p.intensity].join(','));download('rixs-intensity-map.csv',metadata()+'# Uniform angle grid independent of H scan spacing; unnormalized relative intensity\nincidence_deg,loss_eV,intensity_au\n'+rows.join('\n'),'text/csv;charset=utf-8');message('強度マップを CSV に出力しました。');}
  // Initialization and interaction wiring.
  const clear=document.createElement('button');clear.textContent='すべて';clear.dataset.element='';clear.setAttribute('aria-pressed','true');clear.addEventListener('click',()=>{elementFilter='';renderReferences();});$('elements').append(clear);
  for(const r of refs.filter((r,i,arr)=>arr.findIndex(v=>v.element===r.element)===i)){const b=document.createElement('button');b.className='element';b.dataset.element=r.element;const n=document.createElement('small');n.textContent=r.z;const s=document.createElement('strong');s.textContent=r.element;b.append(n,s);b.setAttribute('aria-label',r.element+' で参照表を絞り込む');b.addEventListener('click',()=>{elementFilter=elementFilter===r.element?'':r.element;renderReferences();});$('elements').append(b);}
  try{const saved=localStorage.getItem(KEY);if(saved){const data=JSON.parse(saved);if(data.version!==1)throw Error();state=M.sanitize(data.settings);}}catch{message('保存設定を読み込めなかったため、初期値で開始しました。');}
  const map=new window.RIXSMap.MomentumMap($('momentumMap'),$('mapTooltip'),selectAngle);
  syncControls();
  for(const el of document.querySelectorAll('[data-state]'))el.addEventListener('input',el.id==='incidence'?()=>selectAngle(el.value.trim()===''?NaN:Number(el.value)):updateFromInputs);
  for(const key of ['start','end'])$(key+'Range').addEventListener('input',()=>{$(key).value=$(key+'Range').value;updateFromInputs();});
  $('incidenceRange').addEventListener('input',()=>selectAngle(Number($('incidenceRange').value)));
  for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>{if(state.dimension===3)map.setView(el.dataset.view);else{state.projection=el.dataset.view;render();}});
  $('edgeSearch').addEventListener('input',renderReferences);
  $('zoomIn').addEventListener('click',()=>{if(valid)map.zoomBy(1.3);});$('zoomOut').addEventListener('click',()=>{if(valid)map.zoomBy(1/1.3);});$('mapReset').addEventListener('click',()=>map.reset());
  for(const [id,mode]of [['mapRotate','rotate'],['mapPan','pan']])$(id).addEventListener('click',()=>{map.setMode(mode);$('mapRotate').setAttribute('aria-pressed',String(mode==='rotate'));$('mapPan').setAttribute('aria-pressed',String(mode==='pan'));});
  $('heatmap').addEventListener('click',e=>{if(!valid||!currentHeatmap)return;const r=$('heatmap').getBoundingClientRect(),x=(e.clientX-r.left)/r.width*640,y=(e.clientY-r.top)/r.height*300;if(x>=62&&x<=617&&y>=20&&y<=245)selectAngle(state.start+(state.end-state.start)*(x-62)/555);});
  $('scanDownload').addEventListener('click',exportScan);$('spectrumDownload').addEventListener('click',exportSpectrum);$('heatmapDownload').addEventListener('click',exportHeatmap);
  $('mapDownload').addEventListener('click',()=>{
    if(!valid)return;const copy=$('momentumMap').cloneNode(true);copy.setAttribute('xmlns',svgNS);copy.setAttribute('viewBox','0 -90 900 550');copy.setAttribute('width','1200');copy.setAttribute('height','733');
    copy.insertBefore(node('rect',{x:0,y:-90,width:900,height:550,fill:'#0d1d22'}),copy.firstChild);
    label(copy,24,-65,'CURRENT MOMENTUM / '+$('momentumUnit').textContent,'#8eaaa7',11,'start');
    label(copy,24,-43,$('vectorLabel').textContent+' = '+$('hkl').textContent,'#77e4c8',14,'start');
    if(state.units==='angstrom')label(copy,24,-20,'|q| '+$('qMagnitude').textContent+'   q∥ '+$('qParallel').textContent+'   qz '+$('qNormal').textContent,'#77e4c8',12,'start');
    copy.append(node('desc',{},metadata()));download('rixs-momentum-map.svg',new XMLSerializer().serializeToString(copy),'image/svg+xml');message('運動量マップを SVG に出力しました。');
  });
  $('saveSettings').addEventListener('click',()=>{if(valid){download('rixs-settings.json',JSON.stringify({version:1,settings:state},null,2),'application/json');message('設定を JSON に保存しました。');}});
  $('loadSettings').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error('設定ファイルが大きすぎます。');const data=JSON.parse(await file.text());if(data.version!==1||!data.settings||Array.isArray(data.settings))throw Error('対応する v1 設定ファイルではありません。');const next=M.sanitize(data.settings);state=next;map.reset(false);syncControls();render();message('設定を読み込みました。');}catch(err){message('読込できません。現在の条件を維持します。 '+err.message);}e.target.value='';});
  $('reset').addEventListener('click',()=>{state={...M.defaults};map.reset(false);elementFilter='';$('edgeSearch').value='';$('message').hidden=true;syncControls();render();message('初期条件に戻しました。');});
  render();
})();
