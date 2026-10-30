/* Browser UI; the physics module is independently testable in model.js. */
(() => {
  'use strict';
  const M=window.RIXS, refs=window.RIXSReference, $=id=>document.getElementById(id);
  const I=window.RIXSI18n,t=I.t;
  I.apply();
  const KEY='rixs-cut-planner.v1';
  let state={...M.defaults}, valid=true, currentScan=[], currentSpectrum=[], currentHeatmap=null, elementFilter='Cu', frame=0;
  let availableRange=null,scanCache=null,tableScan=null,tableDwell=null,tableLanguage='',referenceKey='',heatmapKey='';
  const fmt=(n,d=3)=>Math.abs(n)<0.5*10**(-d)?(0).toFixed(d):n.toFixed(d);
  const svgNS='http://www.w3.org/2000/svg';
  function node(tag,attrs={},text){const el=document.createElementNS(svgNS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);if(text!==undefined)el.textContent=text;return el;}
  function add(svg,tag,attrs,text){const el=node(tag,attrs,text);svg.append(el);return el;}
  function line(svg,x1,y1,x2,y2,stroke='#254047',width=1,extra={}){return add(svg,'line',{x1,y1,x2,y2,stroke,'stroke-width':width,...extra});}
  function label(svg,x,y,text,fill='#8eaaa7',size=11,anchor='middle',extra={}){return add(svg,'text',{x,y,fill,'font-size':size,'font-family':'system-ui,sans-serif','text-anchor':anchor,...extra},text);}
  function path(svg,points,color,width=2,extra={}){return add(svg,'path',{d:points.map((p,i)=>(i?'L':'M')+p.map(x=>x.toFixed(3)).join(',')).join(' '),fill:'none',stroke:color,'stroke-width':width,...extra});}
  function message(source,detail=''){$('message').setAttribute('data-message',source);$('message').setAttribute('data-message-detail',detail);$('message').textContent=I.error(source)+I.error(detail);$('message').hidden=false;}
  function color(t){const a=t<.5?[103,184,244]:[119,228,200],b=t<.5?[119,228,200]:[242,212,113],u=t<.5?t*2:(t-.5)*2;return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*u)).join(',')})`;}
  function syncControls(adjustScan=false){
    for(const el of document.querySelectorAll('[data-state]')){if(el.type==='checkbox')el.checked=state[el.id];else el.value=state[el.id];}
    syncLattice();syncSliders(adjustScan);syncMomentumTarget();syncView();syncAngleMode();$('angleError').hidden=true;
  }
  function syncLattice(){
    const c=M.cell(state),allowed=M.CENTERINGS[state.lattice]||['P'];
    if(!allowed.includes(state.centering))state.centering=allowed[0];
    $('centering').replaceChildren();for(const value of allowed){const option=document.createElement('option');option.value=value;option.textContent=value;$('centering').append(option);}$('centering').value=state.centering;
    const editable={b:['orthorhombic','monoclinic','triclinic'],c:['tetragonal','orthorhombic','hexagonal','monoclinic','triclinic'],alpha:['rhombohedral','triclinic'],beta:['monoclinic','triclinic'],gamma:['triclinic']};
    for(const [key,systems]of Object.entries(editable)){$(key).disabled=!systems.includes(state.lattice);if($(key).disabled){state[key]=['alpha','beta','gamma'].includes(key)?Math.round(c[key]/M.RAD*1e8)/1e8:c[key];$(key).value=state[key];}}
    $('latticeNote').textContent=latticeNote();
  }
  function latticeNote(){return t("Surface normal ∥ a × b; φ = 0 along a. H/K/L: ")+(state.lattice==='rhombohedral'?t("primitive rhombohedral axes."):t("conventional lattice axes."))+t(" BZs use the primitive reciprocal lattice.");}
  const axisSymbol=()=>({incidence:'α',azimuth:'φ',tilt:'τ'}[state.scanAxis]);
  const unitName=units=>units==='rlu'?'r.l.u.':'Å⁻¹';
  const componentNames=units=>units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'];
  // Keep an in-progress number (e.g. '-' or '0.') while the field has focus.
  // Reformat only after blur; otherwise inverse-input feedback interrupts typing.
  const displayInput=(id,value)=>{if(document.activeElement!==$(id))$(id).value=value;};
  function syncMomentumInputs(){
    for(const id of ['momentumComponent','scanComponent']){
      const names=componentNames(state.units);
      for(let i=0;i<3;i++)$(id).children[i].textContent=names[i];$(id).value=state[id];
    }
    $('momentumTargetUnit').textContent=unitName(state.units);
    displayInput('incidence',state.incidence);
    displayInput('dwell',Number((state.dwell/60).toPrecision(10)));
    for(const key of ['scattering','azimuth','tilt'])displayInput(key,state[key]);
    $('stepLabel').textContent='Δ'+componentNames(state.units)[state.scanComponent]+' / '+unitName(state.units);
    $('mapScanAxis').textContent=axisSymbol()+' / °';
  }
  function syncMomentumTarget(){
    try{const p=M.momentum(state);$('momentumTarget').value=Number((state.units==='rlu'?p.hkl:p.q)[state.momentumComponent].toPrecision(10));}catch{/* Keep the draft while geometry is invalid. */}
  }
  function syncSliders(adjustScan=false){
    try{
      M.validate(state,{scanRange:false});const range=M.scanLimits(state),incidenceRange=M.scanLimits({...state,scanAxis:'incidence'});
      // Only a changed feasible width resets the user's endpoints. A moved
      // interval of equal width retains their positions relative to its start.
      if(adjustScan&&availableRange){
        const width=range.max-range.min,previousWidth=availableRange.max-availableRange.min;
        if(availableRange.axis!==state.scanAxis||Math.abs(width-previousWidth)>1e-6){state.start=range.min;state.end=range.max;}
        else if(Math.abs(range.min-availableRange.min)>1e-6){const shift=range.min-availableRange.min;state.start+=shift;state.end+=shift;}
      }
      availableRange={...range,axis:state.scanAxis};
      const isMomentum=state.scanRangeUnit==='momentum',extent=isMomentum?M.componentExtent(state):range;
      for(const key of ['start','end']){
        const value=isMomentum?M.componentValue(state,state[key]):state[key];
        for(const el of [$(key),$(key+'Range')]){el.min=extent.min;el.max=extent.max;el.step='any';if(document.activeElement!==el)el.value=value;}
        $(key+'Label').textContent=t(key==='start'?'Start':'End')+' / '+(isMomentum?unitName(state.units):'°');
      }
      $('incidenceRange').min=incidenceRange.min;$('incidenceRange').max=incidenceRange.max;$('incidenceRange').step='any';$('incidenceRange').value=state.incidence;
    }catch{/* Preserve incomplete input; render reports the invalid geometry. */}
    syncMomentumInputs();
  }
  function syncAngleMode(){
    $('scattering').disabled=state.angleMode!=='scattering';
    $('angleLockLabel').textContent=state.angleMode==='l'?t('Fixed L / r.l.u.'):state.angleMode==='hk'?t('Fixed H, K / r.l.u.'):t('Fixed 2θ / °');
    $('angleLockValue').textContent=state.angleMode==='hk'?[state.lockedH,state.lockedK].map(v=>fmt(v,4)).join(', '):fmt(state.angleMode==='l'?state.lockedL:state.scattering,state.angleMode==='l'?5:2);
    $('scanModeNote').textContent=state.angleMode==='hk'?t('H and K stay fixed. α / φ scans adjust 2θ and τ; τ scans adjust 2θ and φ.'):state.angleMode==='l'?t('L stays fixed; 2θ follows the selected scan angle on the same outgoing branch.'):t('2θ stays fixed while the selected angle varies.');
    try{const limits=M.scanLimits(state);$('scanRangeNote').textContent=axisSymbol()+' '+fmt(limits.min,3)+' … '+fmt(limits.max,3)+'° · '+t('The scan range resets only when the available angular width changes.');}catch{$('scanRangeNote').textContent='';}
  }
  function syncView(){
    const is3d=state.dimension===3;$('mapRotate').hidden=!is3d;
    map.setMode(is3d?'rotate':'pan');$('mapRotate').setAttribute('aria-pressed',String(is3d));$('mapPan').setAttribute('aria-pressed',String(!is3d));
    syncMapHelp();
  }
  function syncMapHelp(){
    $('mapHelp').textContent=state.dimension===3?t("Rotate with K (qᵧ in Å⁻¹) up · Pan / right-drag to move · Wheel / pinch to zoom · Arrow keys to rotate; Shift + arrows to select points · Home to fit view"):t("Click a point to select incidence · Drag to pan · Wheel / pinch to zoom · Left / right keys to select points · BZs are projected onto the view plane");
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({version:1,settings:state}));}catch{message("Autosave is unavailable. Use Save settings to download JSON.");}}
  function readInputs(){
    const next={...state};
    for(const el of document.querySelectorAll('[data-state]')){if(el.disabled)continue;next[el.id]=el.type==='checkbox'?el.checked:typeof M.defaults[el.id]==='number'?(el.value.trim()===''?NaN:Number(el.value)):el.value;}
    return next;
  }
  function updateFromInputs(e){
    const previousDimension=state.dimension,previousLattice=state.lattice;state=readInputs();syncLattice();
    if(previousLattice!==state.lattice)document.querySelector('[data-cell-details]')?.setAttribute('open','');
    const geometryChanged=['scanAxis','angleMode','energy','scattering','azimuth','tilt','loss','lattice','centering','a','b','c','alpha','beta','gamma'].includes(e?.target?.id);
    if(e?.target?.id==='angleMode'||geometryChanged&&e?.target?.id!=='scanAxis')try{if(state.angleMode==='l')Object.assign(state,M.captureL(state));if(state.angleMode==='hk')Object.assign(state,M.captureHK(state));}catch{/* Validation reports incomplete lattice inputs. */}
    if(e?.target?.id==='angleMode'){state.scanComponent=state.angleMode==='hk'?2:0;state.momentumComponent=state.scanComponent;}
    if(e?.target?.id==='scanAxis')state.scanComponent=state.angleMode==='hk'?2:state.scanAxis==='incidence'?0:1;
    $('angleError').hidden=true;syncSliders(true);if(['units','momentumComponent','angleMode'].includes(e?.target?.id))syncMomentumTarget();syncAngleMode();if(previousDimension!==state.dimension)syncView();schedule();
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(render);}
  function disableExports(disabled){for(const id of ['scanDownload','spectrumDownload','heatmapDownload','mapDownload','saveSettings'])$(id).disabled=disabled;}
  function clearHeatmap(){currentHeatmap=null;const cv=$('heatmap');cv.getContext('2d').clearRect(0,0,cv.width,cv.height);}
  function trajectoryKey(){
    const keys=['angleMode','energy','loss','scattering','incidence','azimuth','tilt','lattice','centering','a','b','c','alpha','beta','gamma','lockedL','lockBranch','lockedH','lockedK','scanAxis','scanComponent','units','start','end','hStep'];
    // At fixed 2theta, moving alpha along an alpha scan changes only the
    // current marker. Its trajectory and measurement points are unchanged.
    return JSON.stringify(keys.map(key=>key==='incidence'&&state.angleMode==='scattering'&&state.scanAxis==='incidence'?null:state[key]));
  }
  function prepareMap(){
    try{M.validate(state);const key=trajectoryKey();if(!scanCache||scanCache.key!==key)scanCache={key,points:M.scan(state)};currentScan=scanCache.points;$('scanError').hidden=true;}
    catch(e){currentScan=[];$('scanError').textContent=I.error(e.message);$('scanError').hidden=false;}
    map.update(state,currentScan);
  }
  function render(){
    try{M.validate(state,{scanRange:false});prepareMap();valid=true;$('error').hidden=true;document.body.classList.remove('invalid');$('liveBadge').textContent='● LIVE';disableExports(false);if(!currentScan.length){$('scanDownload').disabled=true;$('heatmapDownload').disabled=true;}}
    catch(e){valid=false;currentScan=[];currentSpectrum=[];tableScan=null;$('scanPoints').replaceChildren();map.clear();$('error').textContent=I.error(e.message);$('error').hidden=false;document.body.classList.add('invalid');$('liveBadge').textContent=t("Check inputs");disableExports(true);
      for(const id of ['spectrum','geometry']){const svg=$(id);svg.replaceChildren();label(svg,id==='geometry'?200:320,100,t("Check the input conditions"),'#ff9aaa',13);}
      clearHeatmap();
      for(const id of ['qMagnitude','qParallel','qNormal','hkl','exitAngle','scanTime','selectedAngle','pointCount','scanSummary','spectrumSummary','lossBadge','scanBadge','zoneSummary'])$(id).textContent='—';$('mapTooltip').hidden=true;$('scanError').hidden=true;return;
    }
    syncAngleMode();
    const q=M.momentum(state),readout=M.displayReadout(state);$('momentumUnit').textContent=readout.unit;$('scalarReadouts').hidden=!readout.scalars;
    $('qMagnitude').textContent=fmt(q.magnitude,4);$('qParallel').textContent=fmt(q.parallel,4);$('qNormal').textContent=fmt(q.normal,4);$('vectorLabel').textContent='('+readout.labels.join(', ')+')';$('hkl').textContent=readout.vector.map(v=>fmt(v,4)).join(', ');
    $('allZones').disabled=!state.showBZ;
    $('zoneSummary').textContent=state.showBZ?t("Visible BZs: ")+map.zones.centers.length+t(" · Γ₀ marks the first BZ at the origin")+(map.zones.truncated?t(" · Display limit reached. Reduce energy, lattice constants or scan range."):''):'';
    $('exitAngle').textContent=fmt(q.beta,1)+'°';$('selectedAngle').textContent=fmt(state.incidence,1)+'°';$('lossBadge').textContent='ΔE = '+fmt(state.loss)+' eV';
    $('angleStart').textContent=fmt(state.start,1)+'°';$('angleEnd').textContent=fmt(state.end,1)+'°';
    const count=currentScan.length,secs=count*state.dwell;$('pointCount').textContent=count||'—';$('scanBadge').textContent=count?(count===1?t('1 POINT'):t('{count} POINTS',{count})):t("Check inputs");
    $('scanTime').textContent=count?(secs<3600?fmt(secs/60,1)+' min':fmt(secs/3600,2)+' h'):'—';
    const values=currentScan.map(p=>(state.units==='rlu'?p.hkl:p.q)[state.scanComponent]),component=componentNames(state.units)[state.scanComponent];
    $('scanSummary').textContent=count?component+' = '+fmt(Math.min(...values),4)+' … '+fmt(Math.max(...values),4)+' '+unitName(state.units)+' · Δ'+component+' = '+state.hStep+' '+unitName(state.units):t('Check the scan range and momentum step.');
    renderScanPoints();syncMomentumInputs();
    drawGeometry();drawSpectrum();if(count&&$('energySimulation').open)drawHeatmap();else clearHeatmap();renderReferences();persist();
  }
  function angleFailure(error){$('angleError').setAttribute('data-error-source',error.message);$('angleError').textContent=I.error(error.message)+t(' The previous geometry has been kept.');$('angleError').hidden=false;}
  function selectGeometry(axis,value){
    try{
      const next=M.geometryAt(state,axis,value);M.validate(next,{scanRange:false});state=next;
      $('angleError').hidden=true;syncSliders(true);schedule();
    }catch(e){syncMomentumInputs();$('incidenceRange').value=state.incidence;angleFailure(e);}
  }
  function selectAngle(value){selectGeometry(state.scanAxis,value);}
  function inputIncidence(){selectGeometry('incidence',$('incidence').value.trim()===''?NaN:Number($('incidence').value));}
  function calculateAngles(){
    try{
      const value=$('momentumTarget').value.trim()===''?NaN:Number($('momentumTarget').value);
      const next=M.geometryForMomentum(state,value,state.momentumComponent,state.units);
      M.validate(next,{scanRange:false});state=next;
      $('angleError').hidden=true;syncSliders(true);schedule();
    }catch(e){angleFailure(e);}
  }
  function inputEndpoint(key,source){
    try{
      const value=source.value.trim()===''?NaN:Number(source.value);
      const angle=state.scanRangeUnit==='angle'?value:M.inverseAngle(state,value,state.scanAxis,state.scanComponent,state.units,state[key]);
      state[key]=angle;$('scanError').hidden=true;syncSliders();render();
    }catch(e){syncSliders();$('scanError').textContent=I.error(e.message)+t(' The previous range has been kept.');$('scanError').hidden=false;}
  }
  function renderScanPoints(){
    const language=document.documentElement.lang;
    if(tableScan===currentScan&&tableDwell===state.dwell&&tableLanguage===language){
      for(const [index,p]of currentScan.entries())$('scanPoints').children[index].className=Math.abs(p.scanValue-state[state.scanAxis])<1e-7?'selected':'';
      return;
    }
    tableScan=currentScan;tableDwell=state.dwell;tableLanguage=language;
    $('scanPoints').replaceChildren();
    for(const [index,p]of currentScan.entries()){
      const tr=document.createElement('tr'),td=document.createElement('td'),button=document.createElement('button');button.textContent=index+1;button.setAttribute('aria-label',t('Select scan point {index}',{index:index+1}));button.addEventListener('click',()=>selectAngle(p.scanValue));td.append(button);tr.append(td);
      for(const value of [p.incidence,p.beta,p.scattering,p.azimuth,p.tilt,...p.hkl,...p.q,p.magnitude,state.dwell/60]){const cell=document.createElement('td');cell.textContent=fmt(value,5);tr.append(cell);}
      if(Math.abs(p.scanValue-state[state.scanAxis])<1e-7)tr.className='selected';$('scanPoints').append(tr);
    }
  }
  function drawGeometry(){
    const svg=$('geometry');svg.replaceChildren();const cx=200,cy=105,r=80,ai=state.incidence*M.RAD,bo=(state.scattering-state.incidence)*M.RAD;
    const defs=add(svg,'defs');for(const [id,c]of [['incoming','#77e4c8'],['outgoing','#ffb45d'],['transfer','#b399f5']]){const m=node('marker',{id,markerWidth:7,markerHeight:7,refX:6,refY:3.5,orient:'auto'});m.append(node('path',{d:'M0,0 L7,3.5 L0,7 Z',fill:c}));defs.append(m);}
    add(svg,'rect',{x:65,y:cy,width:270,height:30,fill:'#193137'});line(svg,65,cy,335,cy,'#77948d',1.5);label(svg,310,cy+20,t('sample'),'#77948d',10);line(svg,cx,15,cx,140,'#36565b',1,{'stroke-dasharray':'4 4'});label(svg,cx+8,17,t('normal (τ = 0)'),'#8eaaa7',10,'start');
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
    currentSpectrum=M.spectrum(state,state[state.scanAxis],count);const svg=$('spectrum');svg.replaceChildren();
    const maximum=Math.max(1e-20,...currentSpectrum.map(p=>p.intensity))*1.1,X=x=>62+(x-state.lossMin)/(state.lossMax-state.lossMin)*555,Y=y=>245-y/maximum*205;
    for(let i=0;i<=5;i++){const x=state.lossMin+(state.lossMax-state.lossMin)*i/5;line(svg,X(x),32,X(x),245,'#1d373e',1,{'stroke-dasharray':'2 4'});label(svg,X(x),265,fmt(x,2),'#8eaaa7',10);const y=maximum*i/5;line(svg,62,Y(y),617,Y(y),'#1d373e');label(svg,54,Y(y)+3,y<.01&&y>0?y.toExponential(1):fmt(y,1),'#8eaaa7',9,'end');}
    label(svg,345,291,t('Energy loss / eV'),'#a9c1ba',11);label(svg,16,140,t('Intensity / a.u.'),'#a9c1ba',10,'middle',{transform:'rotate(-90 16 140)'});
    const ps=M.peaks(state);
    if(state.showComponents)ps.forEach((p,j)=>path(svg,currentSpectrum.map(v=>[X(v.loss),Y(v.components[j])]),p.color,1.3,{opacity:.65,'stroke-dasharray':'4 3'}));
    path(svg,currentSpectrum.map(v=>[X(v.loss),Y(v.intensity)]),'#ddf5ec',2);
    if(state.loss>=state.lossMin&&state.loss<=state.lossMax){line(svg,X(state.loss),32,X(state.loss),245,'#ffb45d',1,{'stroke-dasharray':'4 4'});label(svg,X(state.loss)+4,25,'ΔE','#ffb45d',10,'start');}
    label(svg,608,21,`α = ${fmt(state.incidence,1)}°`,'#77e4c8',11,'end');
    const coarse=(state.lossMax-state.lossMin)/(count-1)>state.resolution/1000/3;
    $('spectrumSummary').textContent=t('Dispersive peak {energy} eV · resonance factor {factor} · not absolute counts',{energy:fmt(ps[2].center),factor:M.resonanceFactor(state).toPrecision(3)})+(coarse?t(' · Narrow the displayed range to resolve the requested linewidth.'):'');
  }
  function heatColor(t){const stops=[[17,27,55],[40,82,125],[76,158,154],[183,216,155],[250,230,163]],v=Math.min(3.99999,Math.max(0,t)*4),i=Math.floor(v),u=v-i;return stops[i].map((x,j)=>Math.round(x+(stops[i+1][j]-x)*u));}
  function drawHeatmap(){
    const key=trajectoryKey()+JSON.stringify(['resonance','resonanceWidth','resolution','lossMin','lossMax','phonon','magnon','dd','intrinsic','elasticWeight','phononWeight','magnonWeight','ddWeight'].map(k=>state[k]));
    if(!currentHeatmap||heatmapKey!==key){currentHeatmap=M.heatmap(state,101,240);heatmapKey=key;}const hm=currentHeatmap,canvas=$('heatmap'),ctx=canvas.getContext('2d');
    canvas.width=1280;canvas.height=600;ctx.scale(2,2);ctx.clearRect(0,0,640,300);
    const off=document.createElement('canvas');off.width=hm.columns;off.height=hm.rows;const oc=off.getContext('2d'),im=oc.createImageData(hm.columns,hm.rows);
    for(let x=0;x<hm.columns;x++)for(let y=0;y<hm.rows;y++){const rgb=heatColor(hm.data[x][hm.rows-1-y].intensity/hm.max),idx=(y*hm.columns+x)*4;im.data[idx]=rgb[0];im.data[idx+1]=rgb[1];im.data[idx+2]=rgb[2];im.data[idx+3]=255;}
    oc.putImageData(im,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,62,20,555,225);
    ctx.fillStyle='#8eaaa7';ctx.font='10px system-ui';ctx.textAlign='center';
    for(let i=0;i<=5;i++){ctx.fillText(fmt(state.start+(state.end-state.start)*i/5,1),62+555*i/5,263);ctx.textAlign='right';ctx.fillText(fmt(state.lossMin+(state.lossMax-state.lossMin)*i/5,2),53,249-225*i/5);ctx.textAlign='center';}
    ctx.fillStyle='#a9c1ba';ctx.font='11px system-ui';ctx.fillText(axisSymbol()+" / °",340,288);ctx.save();ctx.translate(17,135);ctx.rotate(-Math.PI/2);ctx.fillText(t('Energy loss / eV'),0,0);ctx.restore();
    if(state[state.scanAxis]>=state.start&&state[state.scanAxis]<=state.end&&state.start!==state.end){const x=62+(state[state.scanAxis]-state.start)/(state.end-state.start)*555;ctx.strokeStyle='#ffb45d';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,20);ctx.lineTo(x,245);ctx.stroke();ctx.setLineDash([]);}
  }
  function renderReferences(){
    const key=JSON.stringify([elementFilter,$('edgeSearch').value,state.edge,state.energy,state.scattering,document.documentElement.lang]);
    if(referenceKey===key)return;referenceKey=key;
    const query=$('edgeSearch').value.trim().toLowerCase();const rows=refs.filter(r=>(!elementFilter||r.element===elementFilter)&&(!query||`${r.element} ${r.edge} ${r.orbital} ${r.energy}`.toLowerCase().includes(query)));
    $('edgeTable').replaceChildren();for(const r of rows){const selected=r.id===state.edge&&Math.abs(r.energy-state.energy)<1e-8;const tr=document.createElement('tr');if(selected)tr.className='selected';for(const text of [r.element,r.edge,r.orbital,fmt(r.energy,1),fmt(2*r.energy/M.HBARC*Math.sin(state.scattering*M.RAD/2),4)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}const td=document.createElement('td'),button=document.createElement('button');button.textContent=selected?t("Applied"):t("Apply");button.setAttribute('aria-label',t('Apply {element} {edge}',r));button.addEventListener('click',()=>applyEdge(r.id));td.append(button);tr.append(td);$('edgeTable').append(tr);}
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent=t("No matching reference. Change the search or element filter.");tr.append(td);$('edgeTable').append(tr);}
    for(const el of $('elements').children)el.setAttribute('aria-pressed',String(el.dataset.element===elementFilter));
  }
  function applyEdge(id){const r=refs.find(x=>x.id===id);state.edge=id;if(r){state.energy=r.energy;if(state.loss>=state.energy)state.loss=state.energy/10;if(state.lossMax>=state.energy)state.lossMax=state.energy*.9;if(state.lossMin>=state.lossMax)state.lossMin=-.15;}try{if(state.angleMode==='l')Object.assign(state,M.captureL(state));if(state.angleMode==='hk')Object.assign(state,M.captureHK(state));}catch{/* Invalid geometry is reported by render. */}syncControls(true);render();}
  function download(name,data,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function metadata(){return '# RIXS Cut Planner v1; q=kin-kout; surface normal || a cross b\n# settings='+JSON.stringify(state)+'\n';}
  function exportScan(){if(!valid||!currentScan.length)return;const header='index,incidence_deg,exit_deg,energy_in_eV,energy_out_eV,loss_eV,qx_A-1,qy_A-1,qz_A-1,qparallel_A-1,qabs_A-1,H_rlu,K_rlu,L_rlu,dwell_min,scattering_deg,tilt_deg,azimuth_deg\n';const rows=currentScan.map((q,i)=>[i+1,q.incidence,q.beta,state.energy,state.energy-state.loss,state.loss,...q.q,q.parallel,q.magnitude,...q.hkl,state.dwell/60,q.scattering,q.tilt,q.azimuth].join(','));download('rixs-scan.csv',metadata()+header+rows.join('\n'),'text/csv;charset=utf-8');message("Scan settings and momenta exported as CSV.");}
  function exportSpectrum(){if(!valid)return;download('rixs-spectrum.csv',metadata()+'# Phenomenological relative intensity; not absolute counts\nloss_eV,total_au,elastic_au,phonon_au,dispersive_au,dd_au\n'+currentSpectrum.map(p=>[p.loss,p.intensity,...p.components].join(',')).join('\n'),'text/csv;charset=utf-8');message("Spectrum and peak components exported as CSV.");}
  function exportHeatmap(){if(!valid||!currentScan.length)return;if(!currentHeatmap)drawHeatmap();const hm=currentHeatmap,rows=[];for(let x=0;x<hm.columns;x++)for(const p of hm.data[x])rows.push([hm.angles[x],p.loss,p.intensity,hm.scatterings[x]].join(','));download('rixs-intensity-map.csv',metadata()+'# Uniform angle grid independent of momentum spacing; unnormalized relative intensity\n'+state.scanAxis+'_deg,loss_eV,intensity_au,scattering_deg\n'+rows.join('\n'),'text/csv;charset=utf-8');message("Intensity map exported as CSV.");}
  // Initialization and interaction wiring.
  const clear=document.createElement('button');clear.textContent=t("All");clear.dataset.element='';clear.setAttribute('aria-pressed','true');clear.addEventListener('click',()=>{elementFilter='';renderReferences();});$('elements').append(clear);
  const periods=[['H','','','','','','','','','','','','','','','','','He'],['Li','Be','','','','','','','','','','','B','C','N','O','F','Ne'],['Na','Mg','','','','','','','','','','','Al','Si','P','S','Cl','Ar'],['K','Ca','Sc','Ti','V','Cr','Mn','Fe','Co','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr'],['Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe'],['Cs','Ba','La','Hf','Ta','W','Re','Os','Ir','Pt','Au','Hg','Tl','Pb','Bi','Po','At','Rn'],['Fr','Ra','Ac'],['','','','Ce','Pr','Nd','Pm','Sm','Eu','Gd','Tb','Dy','Ho','Er','Tm','Yb','Lu'],['','','','Th','Pa','U']];
  clear.style.gridColumn='1 / -1';clear.style.gridRow='1';
  for(const r of refs.filter((r,i,arr)=>arr.findIndex(v=>v.element===r.element)===i)){const b=document.createElement('button');b.className='element';b.dataset.element=r.element;const row=periods.findIndex(p=>p.includes(r.element));b.style.gridRow=String(row+2);b.style.gridColumn=String(periods[row].indexOf(r.element)+1);const n=document.createElement('small');n.textContent=r.z;const s=document.createElement('strong');s.textContent=r.element;b.append(n,s);b.setAttribute('aria-label',t('Filter references by {element}',r));b.addEventListener('click',()=>{elementFilter=r.element;renderReferences();});$('elements').append(b);}
  try{const saved=localStorage.getItem(KEY);if(saved){const data=JSON.parse(saved);if(data.version!==1)throw Error();state=M.sanitize(data.settings);}}catch{message("Saved settings could not be loaded. Default settings are shown.");}
  const map=new window.RIXSMap.MomentumMap($('momentumMap'),$('mapTooltip'),selectAngle);
  syncControls();
  for(const el of document.querySelectorAll('[data-state]'))el.addEventListener('input',['azimuth','tilt'].includes(el.id)?()=>selectGeometry(el.id,el.value.trim()===''?NaN:Number(el.value)):updateFromInputs);
  $('incidence').addEventListener('input',inputIncidence);
  $('calculateAngles').addEventListener('click',calculateAngles);
  for(const id of ['incidence','azimuth','tilt','dwell'])$(id).addEventListener('blur',syncMomentumInputs);
  $('dwell').addEventListener('input',()=>{state.dwell=$('dwell').value.trim()===''?NaN:Number($('dwell').value)*60;schedule();});
  for(const key of ['start','end'])for(const el of [$(key),$(key+'Range')])el.addEventListener('input',()=>inputEndpoint(key,el));
  $('incidenceRange').addEventListener('input',()=>selectGeometry('incidence',Number($('incidenceRange').value)));
  for(const el of document.querySelectorAll('[data-view]'))el.addEventListener('click',()=>{if(state.dimension===3)map.setView(el.dataset.view);else{state.projection=el.dataset.view;render();}});
  $('language').addEventListener('change',()=>{
    I.setLanguage($('language').value);syncMapHelp();syncAngleMode();syncSliders();
    $('latticeNote').textContent=latticeNote();
    for(const el of $('elements').children){if(el.dataset.element)el.setAttribute('aria-label',t('Filter references by {element}',{element:el.dataset.element}));else el.textContent=t('All');}
    if(!$('message').hidden){const source=$('message').getAttribute('data-message');if(source)$('message').textContent=I.error(source)+I.error($('message').getAttribute('data-message-detail')||'');}
    if(!$('angleError').hidden)$('angleError').textContent=I.error($('angleError').getAttribute('data-error-source'))+t(' The previous geometry has been kept.');
    render();
  });
  $('energySimulation').addEventListener('toggle',()=>{if(valid&&currentScan.length&&$('energySimulation').open)drawHeatmap();});
  $('edgeSearch').addEventListener('input',()=>{if($('edgeSearch').value.trim())elementFilter='';renderReferences();});
  $('zoomIn').addEventListener('click',()=>{if(valid)map.zoomBy(1.3);});$('zoomOut').addEventListener('click',()=>{if(valid)map.zoomBy(1/1.3);});$('mapReset').addEventListener('click',()=>map.reset());
  for(const [id,mode]of [['mapRotate','rotate'],['mapPan','pan']])$(id).addEventListener('click',()=>{map.setMode(mode);$('mapRotate').setAttribute('aria-pressed',String(mode==='rotate'));$('mapPan').setAttribute('aria-pressed',String(mode==='pan'));});
  $('heatmap').addEventListener('click',e=>{if(!valid||!currentHeatmap)return;const r=$('heatmap').getBoundingClientRect(),x=(e.clientX-r.left)/r.width*640,y=(e.clientY-r.top)/r.height*300;if(x>=62&&x<=617&&y>=20&&y<=245)selectAngle(state.start+(state.end-state.start)*(x-62)/555);});
  $('scanDownload').addEventListener('click',exportScan);$('spectrumDownload').addEventListener('click',exportSpectrum);$('heatmapDownload').addEventListener('click',exportHeatmap);
  $('mapDownload').addEventListener('click',()=>{
    if(!valid)return;const copy=$('momentumMap').cloneNode(true);copy.setAttribute('xmlns',svgNS);copy.setAttribute('viewBox','0 -90 900 550');copy.setAttribute('width','1200');copy.setAttribute('height','733');
    copy.insertBefore(node('rect',{x:0,y:-90,width:900,height:550,fill:'#0d1d22'}),copy.firstChild);
    label(copy,24,-65,t('Current momentum')+' / '+$('momentumUnit').textContent,'#8eaaa7',11,'start');
    label(copy,24,-43,$('vectorLabel').textContent+' = '+$('hkl').textContent,'#77e4c8',14,'start');
    if(state.units==='angstrom')label(copy,24,-20,'|q| '+$('qMagnitude').textContent+'   q∥ '+$('qParallel').textContent+'   qz '+$('qNormal').textContent,'#77e4c8',12,'start');
    copy.append(node('desc',{},metadata()));download('rixs-momentum-map.svg',new XMLSerializer().serializeToString(copy),'image/svg+xml');message("Momentum map exported as SVG.");
  });
  $('saveSettings').addEventListener('click',()=>{if(valid){download('rixs-settings.json',JSON.stringify({version:1,settings:state},null,2),'application/json');message("Settings saved as JSON.");}});
  $('loadSettings').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw Error("The settings file is too large.");const data=JSON.parse(await file.text());if(data.version!==1||!data.settings||Array.isArray(data.settings))throw Error("This is not a supported v1 settings file.");const next=M.sanitize(data.settings);state=next;map.reset(false);syncControls();render();message("Settings loaded.");}catch(err){message("Could not load settings. Current conditions are unchanged. ",err.message);}e.target.value='';});
  $('reset').addEventListener('click',()=>{state={...M.defaults};map.reset(false);elementFilter='';$('edgeSearch').value='';$('message').hidden=true;syncControls();render();message("Default conditions restored.");});
  render();
})();
