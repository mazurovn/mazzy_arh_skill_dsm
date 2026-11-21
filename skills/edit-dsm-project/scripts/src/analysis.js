const Analysis=(()=>{
  function matrix(data,layer,order=data.nodes.map(n=>n.id)){
    const ids=new Map(order.map((id,i)=>[id,i])),rows=order.map(()=>Array(order.length).fill(0));
    for(const e of data.edges.filter(e=>e.layer===layer)){
      if(!ids.has(e.from)||!ids.has(e.to))continue;
      const a=ids.get(e.from),b=ids.get(e.to); rows[a][b]=e.weight;
      if(layer==='risk')rows[b][a]=e.weight;
    }
    return rows;
  }
  function* permutations(a){if(!a.length){yield [];return;}
    for(let i=0;i<a.length;i++)for(const rest of permutations(a.filter((_,j)=>i!==j)))yield [a[i],...rest];
  }
  // Surviving groups keep their creation order, including the original tie break.
  function sparseGroups(count,pairs,degree,total){
    const neighbors=Array.from({length:count},()=>new Map());
    const members=Array.from({length:count},(_,i)=>[i]),mass=[...degree],heap=[];
    const before=(a,b)=>a.gain>b.gain||a.gain===b.gain&&(a.i<b.i||a.i===b.i&&a.j<b.j);
    function offer(i,j,w){
      const item={i:Math.min(i,j),j:Math.max(i,j),gain:2*total*w-mass[i]*mass[j]};
      if(item.gain<=2*total*total*1e-12)return;
      let k=heap.length;heap.push(item);
      while(k){const parent=(k-1)>>1;if(!before(item,heap[parent]))break;heap[k]=heap[parent];k=parent;}
      heap[k]=item;
    }
    function take(){
      const first=heap[0],last=heap.pop();
      if(heap.length){
        let k=0;
        while(k*2+1<heap.length){
          let child=k*2+1;
          if(child+1<heap.length&&before(heap[child+1],heap[child]))child++;
          if(!before(heap[child],last))break;
          heap[k]=heap[child];k=child;
        }
        heap[k]=last;
      }
      return first;
    }
    for(const [a,b,w] of pairs){
      const weight=(neighbors[a].get(b)||0)+w;
      neighbors[a].set(b,weight);neighbors[b].set(a,weight);
    }
    neighbors.forEach((links,i)=>{for(const [j,w] of links)if(i<j)offer(i,j,w);});
    while(heap.length){
      const {i,j}=take();
      if(!members[i]||!members[j])continue;
      const merged=members.length,links=new Map();
      members.push(members[i].concat(members[j]));mass.push(mass[i]+mass[j]);
      for(const old of [i,j])for(const [other,w] of neighbors[old]){
        if(other===i||other===j)continue;
        links.set(other,w+(links.get(other)||0));neighbors[other].delete(old);
      }
      members[i]=members[j]=null;neighbors[i]=neighbors[j]=null;neighbors.push(links);
      for(const [other,w] of links){neighbors[other].set(merged,w);offer(merged,other,w);}
    }
    return members.filter(Boolean);
  }
  function calculate(data,layer){
    const ids=data.nodes.map(n=>n.id),index=new Map(ids.map((v,i)=>[v,i])),edges=data.edges.filter(e=>e.layer===layer);
    const total=edges.reduce((s,e)=>s+e.weight,0), degree=ids.map(()=>0);
    const pairs=edges.map(e=>[index.get(e.from),index.get(e.to),e.weight]);
    for(const [a,b,w] of pairs){degree[a]+=w;degree[b]+=w;}
    let groups=ids.map((_,i)=>[i]);
    const useSparse=ids.length>80&&total<=100000;
    if(useSparse)groups=sparseGroups(ids.length,pairs,degree,total);
    while(total&&!useSparse){
      const gOf=new Map(), mass=groups.map((g,i)=>{g.forEach(n=>gOf.set(n,i));return g.reduce((s,n)=>s+degree[n],0);});
      const between=new Map();
      for(const [a,b,w] of pairs){const i=gOf.get(a),j=gOf.get(b);if(i===j)continue;
        const k=Math.min(i,j)*groups.length+Math.max(i,j);between.set(k,(between.get(k)||0)+w);}
      let best=1e-12,chosen=null;
      for(const k of [...between.keys()].sort((a,b)=>a-b)){const i=Math.floor(k/groups.length),j=k%groups.length;
        const delta=between.get(k)/total-mass[i]*mass[j]/(2*total*total);
        if(delta>best+(chosen?1e-12:0)){best=delta;chosen=[i,j];}}
      if(!chosen)break;
      const [i,j]=chosen;const merged=[...groups[i],...groups[j]];
      groups=groups.filter((_,k)=>k!==i&&k!==j);groups.push(merged);
    }
    groups.forEach(g=>g.sort((a,b)=>a-b));groups.sort((a,b)=>a[0]-b[0]);
    const cost=order=>{const pos=[];order.forEach((x,i)=>pos[x]=i);return pairs.reduce((s,[a,b,w])=>s+w*Math.abs(pos[a]-pos[b]),0);};
    const lex=(a,b)=>{for(let i=0;i<a.length;i++){if(ids[a[i]]<ids[b[i]])return -1;if(ids[a[i]]>ids[b[i]])return 1;}return 0;};
    let best=groups.flat(),bestCost=cost(best);
    const exactBlocks=groups.length<=6&&ids.length<=26;
    const perms=!total?[groups]:exactBlocks?permutations(groups):[groups,[...groups].reverse()];
    for(const perm of perms){
      let order=perm.flat(),current=cost(order);
      while(total&&ids.length<=50){
        let candidate=null,low=current,offset=0;
        for(const g of perm){for(let i=offset;i<offset+g.length;i++)for(let j=i+1;j<offset+g.length;j++){
          const p=[...order];[p[i],p[j]]=[p[j],p[i]];const c=cost(p);
          if(c<current && (c<low||c===low&&candidate&&lex(p,candidate)<0)){low=c;candidate=p;}
        }offset+=g.length;}
        if(!candidate)break;order=candidate;current=low;
      }
      if(current<bestCost||current===bestCost&&lex(order,best)<0){best=order;bestCost=current;}
    }
    const gid=[];groups.forEach((g,i)=>g.forEach(n=>gid[n]=i));
    const cross=pairs.filter(([a,b])=>gid[a]!==gid[b]);
    const q=total?groups.reduce((s,g,i)=>s+pairs.reduce((s,[a,b,w])=>s+(gid[a]===i&&gid[b]===i?w:0),0)/total-(g.reduce((s,n)=>s+degree[n],0)/(2*total))**2,0):0;
    return {layer,groups:groups.map(g=>g.map(i=>ids[i])),order:best.map(i=>ids[i]),links:edges.length,weight:total,cost_before:cost(ids.map((_,i)=>i)),cost_after:bestCost,cross_links:cross.length,cross_weight:cross.reduce((s,e)=>s+e[2],0),modularity:q};
  }
  function impact(data,id){
    const incoming=new Map();
    for(const e of data.edges)if(e.layer==='flow'){
      if(!incoming.has(e.to))incoming.set(e.to,[]);
      incoming.get(e.to).push(e.from);
    }
    const seen=new Set([id]),queue=[id];
    for(let i=0;i<queue.length;i++)for(const from of incoming.get(queue[i])||[]){
      if(!seen.has(from)){seen.add(from);queue.push(from);}
    }
    return {dependents:queue.slice(1),checks:data.edges.filter(e=>e.layer==='risk'&&(e.from===id||e.to===id)).map(e=>e.from===id?e.to:e.from)};
  }
  return {matrix,calculate,impact};
})();
if(typeof module!=='undefined')module.exports=Analysis;
