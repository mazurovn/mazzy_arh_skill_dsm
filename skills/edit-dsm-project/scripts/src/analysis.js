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
  function calculate(data,layer){
    const ids=data.nodes.map(n=>n.id),index=new Map(ids.map((v,i)=>[v,i])),edges=data.edges.filter(e=>e.layer===layer);
    const total=edges.reduce((s,e)=>s+e.weight,0), degree=ids.map(()=>0);
    const pairs=edges.map(e=>[index.get(e.from),index.get(e.to),e.weight]);
    for(const [a,b,w] of pairs){degree[a]+=w;degree[b]+=w;}
    let groups=ids.map((_,i)=>[i]);
    while(total){
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
    const seen=new Set([id]),queue=[id];for(let i=0;i<queue.length;i++)for(const e of data.edges)if(e.layer==='flow'&&e.to===queue[i]&&!seen.has(e.from)){seen.add(e.from);queue.push(e.from);}
    return {dependents:queue.slice(1),checks:data.edges.filter(e=>e.layer==='risk'&&(e.from===id||e.to===id)).map(e=>e.from===id?e.to:e.from)};
  }
  return {matrix,calculate,impact};
})();
if(typeof module!=='undefined')module.exports=Analysis;
