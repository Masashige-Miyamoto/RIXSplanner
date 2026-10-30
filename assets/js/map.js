/* SVG reciprocal-space viewer. Geometry is in model.js/lattice.js; camera,
 * pointing and touch gestures never alter the scientific coordinates. */
(function(root){
  'use strict';
  const M=root.RIXS,t=root.RIXSI18n.t,NS='http://www.w3.org/2000/svg',W=900,H=460;
  // Turntable camera: positive K (qy in Å⁻¹) remains screen-up. Stop short
  // of the poles so the vertical axis neither disappears nor flips over.
  const MAX_PITCH=85*Math.PI/180;
  const fmt=n=>Math.abs(n)<1e-9?'0':Number(n.toPrecision(4)).toString();
  const color=t=>{const a=t<.5?[103,184,244]:[119,228,200],b=t<.5?[119,228,200]:[242,212,113],u=t<.5?t*2:(t-.5)*2;return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*u)).join(',')})`;};
  const add=(svg,tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
  const line=(svg,a,b,color,width=1,attrs={})=>add(svg,'line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:color,'stroke-width':width,...attrs});
  const text=(svg,p,value,color='#8eaaa7',size=11,anchor='middle',attrs={})=>add(svg,'text',{x:p[0],y:p[1],fill:color,'font-size':size,'text-anchor':anchor,'font-family':'system-ui,sans-serif',...attrs},value);
  const path=(svg,points,color,width=1,attrs={})=>add(svg,'path',{d:points.map((p,i)=>(i?'L':'M')+p.slice(0,2).map(n=>n.toFixed(3)).join(',')).join(' '),fill:'none',stroke:color,'stroke-width':width,...attrs});
  const tickStep=span=>{const v=Math.max(span,1e-9)/6,p=10**Math.floor(Math.log10(v));return [1,2,5,10].find(x=>x*p>=v)*p;};
  function camera(v,yaw,pitch){
    const x=Math.cos(yaw)*v[0]-Math.sin(yaw)*v[2],d=Math.sin(yaw)*v[0]+Math.cos(yaw)*v[2];
    return [x,Math.cos(pitch)*v[1]-Math.sin(pitch)*d,Math.cos(pitch)*d+Math.sin(pitch)*v[1]];
  }
  // Project onto the visible back panes, then draw a crosshair on each pane,
  // following the ARPES planner cursor. All endpoints stay in displayed coordinates.
  function projectionGuides(point,min,max,yaw,pitch){
    const segments=[];
    for(let axis=0;axis<3;axis++){
      const unit=[0,0,0];unit[axis]=1;const eye=camera(unit,yaw,pitch)[2];
      if(Math.abs(eye)<1e-8)continue;
      const foot=point.slice();foot[axis]=eye>=0?min[axis]:max[axis];
      segments.push({a:point.slice(),b:foot,kind:'spike',axis});
      for(let along=0;along<3;along++)if(along!==axis){const a=foot.slice(),b=foot.slice();a[along]=min[along];b[along]=max[along];segments.push({a,b,kind:'projection',axis});}
    }
    return segments;
  }
  class MomentumMap{
    constructor(svg,tooltip,onSelect){
      this.svg=svg;this.tooltip=tooltip;this.onSelect=onSelect;this.points=[];this.touches=new Map();this.reset(false);this.mode='rotate';this.bind();
    }
    reset(draw=true){this.zoom=1;this.pan=[0,0];this.yaw=-Math.PI/4;this.pitch=Math.atan(1/Math.sqrt(2));if(draw)this.draw();}
    setView(view){this.zoom=1;this.pan=[0,0];this.yaw=view==='zy'?-Math.PI/2:0;this.pitch=view==='xz'?-Math.PI/2:0;this.draw();}
    rotate(yawDelta,pitchDelta){this.yaw+=yawDelta;this.pitch=Math.max(-MAX_PITCH,Math.min(MAX_PITCH,this.pitch+pitchDelta));}
    update(s,scan){
      const geometryKey=JSON.stringify([s.lattice,s.centering,s.a,s.b,s.c,s.alpha,s.beta,s.gamma,s.units,s.dimension,s.projection]);
      if(this.geometryKey!==geometryKey)this.reset(false);this.geometryKey=geometryKey;
      this.state={...s};this.scan=s.showScan?scan:[];this.mesh=M.zoneMesh(s);this.zones=s.showBZ?M.occupiedZones(scan.length?s:{...s,start:s.incidence,end:s.incidence},scan):{centers:[],truncated:false};
      this.tooltip.hidden=true;this.draw();return this.zones;
    }
    clear(){this.state=null;this.points=[];this.svg.replaceChildren();this.tooltip.hidden=true;text(this.svg,[450,200],t("Check the input conditions"),'#ff9aaa',15);}
    setMode(mode){this.mode=mode;this.svg.setAttribute('data-drag-mode',mode);}
    zoomBy(factor){this.zoom=Math.max(.2,Math.min(20,this.zoom*factor));this.draw();}
    coordinates(e){const r=this.svg.getBoundingClientRect(),s=Math.min(r.width/W,r.height/H);return[(e.clientX-r.left-(r.width-W*s)/2)/s,(e.clientY-r.top-(r.height-H*s)/2)/s];}
    draw(){
      if(!this.state)return;const s=this.state,svg=this.svg,is3d=s.dimension===3;svg.replaceChildren();
      svg.setAttribute('data-view',is3d?'3d':s.projection);svg.setAttribute('data-camera',`${this.yaw},${this.pitch}`);svg.setAttribute('data-zone-count',this.zones.centers.length);
      const toDisplay=q=>M.displayVector(q,s),project2=v=>s.projection==='xy'?[v[0],v[1],0]:s.projection==='zy'?[v[2],v[1],0]:[v[0],v[2],0];
      const zones=this.zones.centers.map(center=>({center,vertices:this.mesh.vertices.map(v=>toDisplay(v.map((n,i)=>n+center[i])))}));
      const points=this.scan.map(p=>toDisplay(p.q)),current=toDisplay(M.momentum(s).q);
      const all=[...points,current,[0,0,0],...zones.flatMap(z=>z.vertices)];
      const minimum=[0,1,2].map(i=>Math.min(...all.map(v=>v[i]))),maximum=[0,1,2].map(i=>Math.max(...all.map(v=>v[i]))),center=minimum.map((v,i)=>(v+maximum[i])/2);
      let project,scale;
      const left=68,right=860,top=25,bottom=397,ox=464+this.pan[0],oy=211+this.pan[1];
      if(is3d){
        const radius=Math.max(.001,Math.hypot(...maximum.map((v,i)=>(v-minimum[i])/2)));
        scale=Math.min(right-left,bottom-top)*.47/radius*this.zoom;
        project=v=>{const c=camera(v.map((n,i)=>n-center[i]),this.yaw,this.pitch);return[ox+c[0]*scale,oy-c[1]*scale,c[2]];};
      }else{
        const bounds=all.map(project2),xs=bounds.map(v=>v[0]),ys=bounds.map(v=>v[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
        scale=Math.min((right-left)/Math.max(.001,Math.max(...xs)-Math.min(...xs)),(bottom-top)/Math.max(.001,Math.max(...ys)-Math.min(...ys)))*.84*this.zoom;
        project=v=>{const q=project2(v);return[ox+(q[0]-cx)*scale,oy-(q[1]-cy)*scale,0];};
        const xmin=cx+(left-ox)/scale,xmax=cx+(right-ox)/scale,ymin=cy+(oy-bottom)/scale,ymax=cy+(oy-top)/scale;
        const sx=tickStep(xmax-xmin),sy=tickStep(ymax-ymin);
        for(let x=Math.ceil(xmin/sx)*sx;x<=xmax+sx*.001;x+=sx){const px=ox+(x-cx)*scale;line(svg,[px,top],[px,bottom],Math.abs(x)<1e-10?'#496366':'#1d373e',1,{'stroke-dasharray':'2 5'});text(svg,[px,419],fmt(x),'#769a98',10);}
        for(let y=Math.ceil(ymin/sy)*sy;y<=ymax+sy*.001;y+=sy){const py=oy-(y-cy)*scale;line(svg,[left,py],[right,py],Math.abs(y)<1e-10?'#496366':'#1d373e',1,{'stroke-dasharray':'2 5'});text(svg,[56,py+4],fmt(y),'#769a98',10,'end');}
        const labels=s.units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'],idx=s.projection==='xy'?[0,1]:s.projection==='zy'?[2,1]:[0,2],unit=s.units==='rlu'?'r.l.u.':'Å⁻¹';
        text(svg,[464,449],labels[idx[0]]+' / '+unit,'#a9c1ba',12);text(svg,[19,211],labels[idx[1]]+' / '+unit,'#a9c1ba',12,'middle',{transform:'rotate(-90 19 211)'});
      }
      const defs=add(svg,'defs'),clip=add(defs,'clipPath',{id:'mapClip'});add(clip,'rect',{x:is3d?0:left,y:top,width:is3d?W:right-left,height:bottom-top});const g=add(svg,'g',{'clip-path':'url(#mapClip)'});
      if(is3d)this.drawBox(g,project,minimum,maximum);
      // Complete cells are translated by reciprocal lattice vectors, never arbitrary offsets.
      const sorted=zones.map((z,i)=>({...z,index:i,depth:project(toDisplay(z.center))[2]})).sort((a,b)=>a.depth-b.depth);
      for(const z of sorted){
        const stroke=z.index===0?'#77e4c8':'#547681',zg=add(g,'g',{'data-zone':z.index,'data-center':z.center.join(',')});
        if(is3d){for(const edge of this.mesh.edges){const a=toDisplay(edge[0].map((n,i)=>n+z.center[i])),b=toDisplay(edge[1].map((n,i)=>n+z.center[i]));line(zg,project(a),project(b),stroke,z.index===0?1.6:1,{'stroke-opacity':z.index===0?.9:.65});}}
        else{const hull=M.convexHull(z.vertices.map(project));if(hull.length>2)path(zg,[...hull,hull[0]],stroke,z.index===0?1.6:1,{'stroke-dasharray':z.index===0?'':'5 4',fill:z.index===0?'#77e4c808':'none'});}
        const gamma=project(toDisplay(z.center));text(zg,[gamma[0]+7,gamma[1]-7],z.index===0?'Γ₀':'Γ',stroke,z.index===0?12:10,'start');
      }
      const projected=points.map(project);path(g,projected,'#77e4c8',1.8,{opacity:.45});
      this.points=projected.map((p,index)=>({x:p[0],y:p[1],depth:p[2],index})).sort((a,b)=>a.depth-b.depth);
      for(const p of this.points)add(g,'circle',{cx:p.x,cy:p.y,r:points.length>150?2:3,fill:color(p.index/Math.max(1,points.length-1)),stroke:'#0d1d22','stroke-width':.6,'data-scan-index':p.index});
      this.hoverLayer=add(g,'g',{'data-hover-hairlines':'','pointer-events':'none','aria-hidden':'true'});
      this.hoverProjection={project,minimum,maximum,is3d};
      const active=project(current);
      if(is3d){
        const guides=add(g,'g',{'data-current-hairlines':'','pointer-events':'none','aria-hidden':'true'});
        for(const segment of projectionGuides(current,minimum,maximum,this.yaw,this.pitch))line(guides,project(segment.a),project(segment.b),'#ffb45d',segment.kind==='spike'?1.25:1,{'stroke-dasharray':'4 4',opacity:segment.kind==='spike'?.85:.55,'data-guide-kind':segment.kind,'data-guide-axis':segment.axis,'data-from':segment.a.join(','),'data-to':segment.b.join(',')});
      }
      if(!is3d){const zero=project([0,0,0]);line(g,active,[active[0],zero[1]],'#ffb45d',1,{'stroke-dasharray':'3 5',opacity:.45});line(g,active,[zero[0],active[1]],'#ffb45d',1,{'stroke-dasharray':'3 5',opacity:.45});}
      add(g,'circle',{cx:active[0],cy:active[1],r:9,fill:'#ffb45d15',stroke:'#ffb45d',opacity:.8});add(g,'circle',{cx:active[0],cy:active[1],r:4,fill:'#ffb45d',stroke:'#071216','stroke-width':1.5});
      if(is3d){
        const labels=s.units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'],colors=['#e39a86','#77e4c8','#83b6ee'];
        for(let axis=0;axis<3;axis++){const v=[0,0,0];v[axis]=1;const rotated=camera(v,this.yaw,this.pitch),start=[805,405],end=[805+rotated[0]*40,405-rotated[1]*40];line(svg,start,end,colors[axis],2);text(svg,[end[0]+4,end[1]-4],labels[axis],colors[axis],11);}
        text(svg,[70,435],s.units==='rlu'?'3D · (H, K, L) / r.l.u.':'3D · (qₓ, qᵧ, qz) / Å⁻¹','#a9c1ba',12,'start');
      }
    }
    drawBox(svg,project,min,max){
      // Back panes and labeled axes give a stable 3D coordinate frame.
      const eye=camera([1,0,0],this.yaw,this.pitch)[2];
      const e=[eye,camera([0,1,0],this.yaw,this.pitch)[2],camera([0,0,1],this.yaw,this.pitch)[2]];
      for(let axis=0;axis<3;axis++){
        const other=[0,1,2].filter(i=>i!==axis),side=e[axis]>=0?min[axis]:max[axis];
        const corners=[[0,0],[1,0],[1,1],[0,1]].map(bits=>{const p=min.slice();p[axis]=side;other.forEach((a,i)=>p[a]=bits[i]?max[a]:min[a]);return project(p);});
        path(svg,[...corners,corners[0]],'#24424a',.7,{fill:'#15323930'});
        for(const along of other){const across=other.find(i=>i!==along),step=tickStep(max[along]-min[along]);
          for(let value=Math.ceil(min[along]/step)*step;value<=max[along]+step*.001;value+=step){const a=min.slice();a[axis]=side;a[along]=value;const b=a.slice();b[across]=max[across];line(svg,project(a),project(b),'#25434a',.6);}
        }
      }
      const labels=this.state.units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'];
      for(let axis=0;axis<3;axis++){
        const a=min.map((v,i)=>i===axis?v:(e[i]>=0?min[i]:max[i])),b=a.slice();b[axis]=max[axis];
        line(svg,project(a),project(b),'#708e92',1);
        const step=tickStep(max[axis]-min[axis]);for(let v=Math.ceil(min[axis]/step)*step;v<=max[axis]+step*.001;v+=step){const p=a.slice();p[axis]=v;const screen=project(p);text(svg,[screen[0]-5,screen[1]+13],fmt(v),'#8eaaa7',9);}
        const mid=project(a.map((v,i)=>(v+b[i])/2));text(svg,[mid[0]+(axis===1?-22:0),mid[1]+(axis===1?0:30)],labels[axis],'#bdd3cc',11);
      }
    }
    nearest(e){const [x,y]=this.coordinates(e);let best=null,distance=22;for(const p of this.points){if(p.x<0||p.x>W||p.y<25||p.y>397)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<=distance){best=p;distance=d;}}return best;}
    hover(e){if(!this.state)return;this.hoverLayer?.replaceChildren();const p=this.nearest(e);if(!p){this.tooltip.hidden=true;return;}const row=this.scan[p.index],v=M.displayVector(row.q,this.state),labels=this.state.units==='rlu'?['H','K','L']:['qₓ','qᵧ','qz'];
      const {project,minimum,maximum,is3d}=this.hoverProjection,layer=this.hoverLayer;
      if(is3d){for(const segment of projectionGuides(v,minimum,maximum,this.yaw,this.pitch))line(layer,project(segment.a),project(segment.b),'#d9f4f1',1,{'stroke-dasharray':'3 4','data-from':segment.a.join(','),'data-to':segment.b.join(',')});}
      else {line(layer,[68,p.y],[860,p.y],'#d9f4f1',1,{'stroke-dasharray':'3 4'});line(layer,[p.x,25],[p.x,397],'#d9f4f1',1,{'stroke-dasharray':'3 4'});}
      add(layer,'circle',{cx:p.x,cy:p.y,r:6,fill:'none',stroke:'#d9f4f1'});
      this.tooltip.textContent=`α ${fmt(row.incidence)}° · φ ${fmt(row.azimuth)}° · τ ${fmt(row.tilt)}°\n`+labels.map((l,i)=>l+' = '+fmt(v[i])).join('\n')+'\n'+(this.state.units==='rlu'?'r.l.u.':'Å⁻¹');const r=this.svg.getBoundingClientRect();this.tooltip.style.left=Math.max(8,Math.min(e.clientX-r.left+12,r.width-180))+'px';this.tooltip.style.top=Math.max(90,e.clientY-r.top+85)+'px';this.tooltip.hidden=false;
    }
    pinchStart(){const [a,b]=[...this.touches.values()];this.pinch={distance:Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1])),mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],zoom:this.zoom,pan:this.pan.slice()};this.drag=null;this.suppressClick=true;}
    bind(){
      const svg=this.svg;
      svg.addEventListener('contextmenu',e=>e.preventDefault());
      svg.addEventListener('pointerdown',e=>{if(!this.state||![0,2].includes(e.button))return;e.preventDefault();svg.focus?.();svg.setPointerCapture?.(e.pointerId);this.tooltip.hidden=true;this.hoverLayer?.replaceChildren();const p=this.coordinates(e);if(e.pointerType==='touch'){this.touches.set(e.pointerId,p);if(this.touches.size>=2){this.pinchStart();return;}}this.suppressClick=false;this.drag={id:e.pointerId,start:p,last:p,pan:e.button===2||e.shiftKey};});
      svg.addEventListener('pointermove',e=>{
        if(!this.state)return;const p=this.coordinates(e);
        if(this.touches.has(e.pointerId)){this.touches.set(e.pointerId,p);if(this.pinch&&this.touches.size>=2){e.preventDefault();const [a,b]=[...this.touches.values()],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];this.zoom=Math.max(.2,Math.min(20,this.pinch.zoom*Math.hypot(a[0]-b[0],a[1]-b[1])/this.pinch.distance));const ratio=this.zoom/this.pinch.zoom;this.pan=mid.map((v,i)=>v-[464,211][i]-(this.pinch.mid[i]-[464,211][i]-this.pinch.pan[i])*ratio);this.draw();return;}}
        if(this.drag?.id===e.pointerId){const dx=p[0]-this.drag.last[0],dy=p[1]-this.drag.last[1];this.drag.last=p;if(Math.hypot(p[0]-this.drag.start[0],p[1]-this.drag.start[1])>4)this.suppressClick=true;
          if(this.drag.pan||e.shiftKey||this.mode==='pan'||this.state.dimension!==3)this.pan=[this.pan[0]+dx,this.pan[1]+dy];else this.rotate(-dx*.008,dy*.008);this.draw();
        }else this.hover(e);
      });
      const release=e=>{this.touches.delete(e.pointerId);if(this.touches.size>=2){this.pinchStart();return;}this.pinch=null;const remaining=[...this.touches.entries()][0];this.drag=remaining?{id:remaining[0],start:remaining[1],last:remaining[1],pan:true}:null;};
      for(const ev of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(ev,release);
      svg.addEventListener('pointerleave',()=>{this.tooltip.hidden=true;this.hoverLayer?.replaceChildren();});
      svg.addEventListener('click',e=>{if(this.suppressClick){this.suppressClick=false;return;}if(!this.state)return;const p=this.nearest(e);if(p)this.onSelect(this.scan[p.index].scanValue);});
      svg.addEventListener('wheel',e=>{if(!this.state)return;e.preventDefault();this.zoomBy(Math.exp(-e.deltaY*.001));},{passive:false});
      svg.addEventListener('dblclick',()=>this.reset());
      svg.addEventListener('keydown',e=>{
        if(!this.state)return;
        if(e.key==='Home'){e.preventDefault();this.reset();return;}
        if(['+','=','-'].includes(e.key)){e.preventDefault();this.zoomBy(e.key==='-'?.8:1.25);return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
        const x=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,y=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
        if(this.state.dimension===3&&!e.shiftKey){if(this.mode==='pan')this.pan=[this.pan[0]+x*20,this.pan[1]+y*20];else this.rotate(-x*.12,y*.12);this.draw();}
        else if((e.shiftKey||x)&&this.scan.length){let index=this.scan.reduce((best,p,i)=>Math.abs(p.scanValue-this.state[this.state.scanAxis])<Math.abs(this.scan[best].scanValue-this.state[this.state.scanAxis])?i:best,0);index=Math.max(0,Math.min(this.scan.length-1,index+(x||y)));this.onSelect(this.scan[index].scanValue);}
        else{this.pan[1]+=y*20;this.draw();}
      });
    }
  }
  root.RIXSMap={MomentumMap,camera,projectionGuides};
})(typeof window!=='undefined'?window:globalThis);
