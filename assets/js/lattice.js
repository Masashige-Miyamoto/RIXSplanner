/* Lattice geometry adapted from ISSP-Matsuda-lab/XPS-Explorer (MIT).
 * Copyright (c) 2026 Masashige-Miyamoto. See THIRD_PARTY_NOTICES.md.
 * Only crystal geometry, Voronoi cells and nearest-lattice-point routines.
 */
(function (root) {
  'use strict';
  const TAU = 2 * Math.PI, RAD = Math.PI / 180;
  const add = (a,b) => a.map((v,i) => v+b[i]);
  const sub = (a,b) => a.map((v,i) => v-b[i]);
  const scale = (a,s) => a.map(v => v*s);
  const dot = (a,b) => a.reduce((s,v,i) => s+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => Math.sqrt(dot(a,a));
  function unit(a) { const n=norm(a); if (!(n>1e-10)) throw Error('Direction vectors must be nonzero and independent.'); return scale(a,1/n); }
  const combine = (basis,coefficients) => basis.reduce((s,v,i) => add(s,scale(v,coefficients[i])),[0,0,0]);
  const volume = b => Math.abs(dot(b[0],cross(b[1],b[2])));
  const CENTERINGS = {orthogonal:['P','C','I','F'],hexagonal:['P','R'],rhombohedral:['R'],monoclinic:['P','C'],triclinic:['P']};
  const TRANSFORMS = {
    P:[[1,0,0],[0,1,0],[0,0,1]], C:[[.5,.5,0],[-.5,.5,0],[0,0,1]],
    I:[[-.5,.5,.5],[.5,-.5,.5],[.5,.5,-.5]], F:[[0,.5,.5],[.5,0,.5],[.5,.5,0]],
    R:[[2/3,1/3,1/3],[-1/3,1/3,1/3],[-1/3,-2/3,1/3]]
  };
  function finite(value,label) { if (!Number.isFinite(value)) throw Error(label+' must be a finite number.'); return value; }
  function positive(value,label) { finite(value,label); if(value<=0)throw Error(label+' must be positive.'); return value; }
  function lattice(config) {
    const dim=Number(config.dimension); if(![2,3].includes(dim))throw Error('Choose 2D or 3D.');
    let a=positive(config.a,'a'), b=config.b, c=config.c, alpha=config.alpha, beta=config.beta, gamma=config.gamma, centering=config.centering;
    if(dim===2) {
      if(!['square','rectangular','centered','hexagonal','oblique'].includes(config.bravais))throw Error('Choose a 2D Bravais lattice.');
      c=1;alpha=beta=90;centering=config.bravais==='centered'?'C':'P';
      if(['square','hexagonal'].includes(config.bravais))b=a;
      if(config.bravais==='hexagonal')gamma=120;else if(config.bravais!=='oblique')gamma=90;
    } else {
      if(!CENTERINGS[config.system]?.includes(centering))throw Error('This centering is incompatible with the lattice system.');
      if(config.system==='orthogonal')alpha=beta=gamma=90;
      if(config.system==='hexagonal'){b=a;alpha=beta=90;gamma=120;}
      if(config.system==='rhombohedral'){b=c=a;beta=gamma=alpha;}
      if(config.system==='monoclinic')alpha=gamma=90;
    }
    positive(b,'b');positive(c,'c');
    [alpha,beta,gamma].forEach(v=>{finite(v,'Lattice angle');if(v<=0||v>=180)throw Error('Lattice angles must lie between 0° and 180°.');});
    const ca=Math.cos(alpha*RAD),cb=Math.cos(beta*RAD),cg=Math.cos(gamma*RAD),sg=Math.sin(gamma*RAD);
    const cy=(ca-cb*cg)/sg,cz2=1-cb*cb-cy*cy;
    if(cz2<1e-10)throw Error('The lattice parameters describe a degenerate or impossible cell.');
    let conventional=[[a,0,0],[b*cg,b*sg,0],[c*cb,c*cy,c*Math.sqrt(cz2)]];
    let primitive=TRANSFORMS[centering].map(v=>combine(conventional,v));
    // Rhombohedral axes are already primitive. The accompanying conventional
    // hexagonal cell has three lattice points, not an additional R centering.
    if(dim===3 && config.system==='rhombohedral') {
      primitive=conventional;
      conventional=[sub(primitive[0],primitive[1]),sub(primitive[1],primitive[2]),add(add(primitive[0],primitive[1]),primitive[2])];
    }
    const signedVolume=dot(primitive[0],cross(primitive[1],primitive[2]));
    const reciprocal=[cross(primitive[1],primitive[2]),cross(primitive[2],primitive[0]),cross(primitive[0],primitive[1])].map(v=>scale(v,TAU/signedVolume)).slice(0,dim);
    return {dimension:dim,a,b,c,alpha,beta,gamma,centering,conventional,primitive:primitive.slice(0,dim),reciprocal,
      conventionalMeasure:dim===2?norm(cross(conventional[0],conventional[1])):volume(conventional),
      primitiveMeasure:dim===2?norm(cross(primitive[0],primitive[1])):Math.abs(signedVolume)};
  }
  function gramSchmidt(basis) {
    const orthogonal=[],mu=[],lengths=[];
    basis.forEach((v,i)=>{let w=v.slice();mu[i]=[];for(let j=0;j<i;j++){mu[i][j]=dot(v,orthogonal[j])/lengths[j];w=sub(w,scale(orthogonal[j],mu[i][j]));}orthogonal.push(w);lengths.push(dot(w,w));});
    return {orthogonal,mu,lengths};
  }
  // LLL reduction retains the lattice and keeps exact nearest-point searches small.
  function reduceBasis(input) {
    const b=input.map(v=>v.slice());let k=1,iterations=0;
    while(k<b.length){
      if(++iterations>300)throw Error('The cell is too ill-conditioned. Use a less skewed cell.');
      let gs=gramSchmidt(b);
      for(let j=k-1;j>=0;j--){const q=Math.round(gs.mu[k][j]);if(q){b[k]=sub(b[k],scale(b[j],q));gs=gramSchmidt(b);}}
      if(gs.lengths[k]>=(.75-gs.mu[k][k-1]**2)*gs.lengths[k-1])k++;
      else {[b[k],b[k-1]]=[b[k-1],b[k]];k=Math.max(1,k-1);}
    }
    return b;
  }
  function nearestSolver(input) {
    const basis=reduceBasis(input),n=basis.length,gs=gramSchmidt(basis),q=gs.orthogonal.map(unit);
    const r=q.map((v,i)=>basis.map((b,j)=>j<i?0:dot(v,b)));
    return point=>{
      const y=q.map(v=>dot(v,point)),coefficients=Array(n).fill(0);
      for(let i=n-1;i>=0;i--){let s=y[i];for(let j=i+1;j<n;j++)s-=r[i][j]*coefficients[j];coefficients[i]=Math.round(s/r[i][i]);}
      let best=coefficients.slice(),bestDistance=dot(sub(point,combine(basis,best)),sub(point,combine(basis,best))),visited=0;
      function visit(i,distance){
        if(++visited>50000)throw Error('The cell is too ill-conditioned. Use a less skewed cell.');
        if(i<0){if(distance<bestDistance){bestDistance=distance;best=coefficients.slice();}return;}
        let s=y[i];for(let j=i+1;j<n;j++)s-=r[i][j]*coefficients[j];
        const center=s/r[i][i],radius=Math.sqrt(Math.max(0,bestDistance-distance))/Math.abs(r[i][i])+1e-10;
        const low=Math.ceil(center-radius),high=Math.floor(center+radius);
        for(let value=low;value<=high;value++){coefficients[i]=value;const next=distance+(s-r[i][i]*value)**2;if(next<=bestDistance+1e-12)visit(i-1,next);}
      }
      visit(n-1,0);const shift=combine(basis,best);return {point:sub(point,shift),shift};
    };
  }
  function clipPolygon(vertices,normal,limit,epsilon,intersections=[]) {
    const output=[];
    vertices.forEach((a,i)=>{const b=vertices[(i+1)%vertices.length],da=dot(a,normal)-limit,db=dot(b,normal)-limit;
      if(da<=epsilon)output.push(a);
      if((da>epsilon)!==(db>epsilon)){const p=add(a,scale(sub(b,a),da/(da-db)));output.push(p);intersections.push(p);}
    });return output;
  }
  function unique(points,epsilon) {const result=[];for(const p of points)if(!result.some(v=>norm(sub(v,p))<epsilon))result.push(p);return result;}
  function clipPolyhedron(faces,g,epsilon) {
    const intersections=[],limit=dot(g,g)/2,clipped=faces.map(face=>clipPolygon(face,g,limit,epsilon,intersections)).filter(f=>f.length>=3);
    const cap=unique(intersections,Math.sqrt(epsilon)*.01);
    if(cap.length>=3){const center=scale(cap.reduce(add,[0,0,0]),1/cap.length),u=unit(sub(cap[0],center)),v=unit(cross(g,u));cap.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));clipped.push(cap);}
    return clipped;
  }
  function brillouinZone(input) {
    const basis=reduceBasis(input),dim=basis.length;
    const full=dim===2?[...basis,[0,0,1]]:basis;
    const determinant=dot(full[0],cross(full[1],full[2]));
    const dual=[cross(full[1],full[2]),cross(full[2],full[0]),cross(full[0],full[1])].map(v=>scale(v,1/determinant)).slice(0,dim);
    // Intersect the bisectors of ±basis first; all Voronoi vertices are inside.
    const corners=[];
    for(let mask=0;mask<2**dim;mask++)corners.push(combine(dual,basis.map((b,i)=>(mask&(1<<i)?1:-1)*dot(b,b)/2)));
    const radius=Math.max(...corners.map(norm)),extent=radius*1.01,epsilon=Math.max(1e-14,radius**2*1e-10);
    let faces=dim===2?[[[-extent,-extent,0],[extent,-extent,0],[extent,extent,0],[-extent,extent,0]]]:[
      [0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]
    ].map(face=>face.map(i=>[(i&1?1:-1)*extent,(i&2?1:-1)*extent,(i&4?1:-1)*extent]));
    const bounds=dual.map(v=>Math.ceil(2*radius*norm(v)+1e-9));
    if(bounds.reduce((count,b)=>count*(2*b+1),1)>250000)throw Error('The cell is too anisotropic to draw. Use a smaller lattice aspect ratio.');
    const neighbors=[];
    for(let i=-bounds[0];i<=bounds[0];i++)for(let j=-bounds[1];j<=bounds[1];j++)for(let k=dim===3?-bounds[2]:0;k<=(dim===3?bounds[2]:0);k++){
      if(!i&&!j&&!k)continue;const g=combine(basis,[i,j,k]);if(norm(g)<=2*radius*(1+1e-9))neighbors.push(g);
    }
    neighbors.sort((a,b)=>dot(a,a)-dot(b,b));
    for(const g of neighbors){faces=dim===2?[clipPolygon(faces[0],g,dot(g,g)/2,epsilon)]:clipPolyhedron(faces,g,epsilon);}
    const vertices=unique(faces.flat(),Math.max(1e-9,radius*1e-7)),edges=[],edgeKeys=new Set();
    for(const face of faces)face.forEach((a,i)=>{const b=face[(i+1)%face.length],ia=vertices.findIndex(v=>norm(sub(v,a))<Math.max(1e-9,radius*1e-7)),ib=vertices.findIndex(v=>norm(sub(v,b))<Math.max(1e-9,radius*1e-7));const key=[ia,ib].sort((x,y)=>x-y).join(',');if(ia!==ib&&!edgeKeys.has(key)){edgeKeys.add(key);edges.push([vertices[ia],vertices[ib]]);}});
    return {vertices,faces,edges};
  }
  const api={CENTERINGS,lattice,brillouinZone,nearestSolver,add,sub,scale,dot,cross,norm,combine,volume};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RIXSLattice=api;
}(typeof window!=='undefined'?window:globalThis));

