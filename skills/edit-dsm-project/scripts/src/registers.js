const Registers=(()=>{
  const defaults=()=>({kind:'',state:'',segment:'',release:'*',order:'initial'});
  function match(query,...values){
    const corpus=values.join(' ').toLocaleLowerCase();
    return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>corpus.includes(word));
  }
  function nodes(model,query,filters){
    const items=model.nodes.filter(n=>(!filters.kind||filters.kind===n.kind)&&(!filters.state||filters.state===n.state)&&
      (!filters.segment||filters.segment===n.segment)&&(filters.release==='*'||filters.release===n.release)&&
      match(query,n.id,n.name,n.note,n.segment,n.bundle,n.state,n.kind,...Object.entries(n.attrs||{}).flat(),...(n.refs||[])));
    if(filters.order!=='initial')items.sort((a,b)=>a[filters.order].localeCompare(b[filters.order],'ru',{numeric:true})||a.id.localeCompare(b.id));
    return items;
  }
  const historyCache=new WeakMap();
  function historyIndex(doc){
    if(historyCache.has(doc))return historyCache.get(doc);
    const actors=new Set(),ids=new Set();
    for(const h of doc.history){actors.add(h.actor);for(const n of h.data.nodes)ids.add(n.id);}
    const index={authors:[...actors].sort(),ids:[...ids].sort(),touches:new Map()};
    historyCache.set(doc,index);
    return index;
  }
  // Cache precisely the selected object's card and incident DSM edges. Other
  // objects never need serialisation, even on the first filter after a reload.
  function touched(doc,id){
    const {touches}=historyIndex(doc);
    if(touches.has(id))return touches.get(id);
    const hits=new Set();
    let previous=null,oldEdges=new Map();
    for(const [i,h] of doc.history.entries()){
      const n=h.data.nodes.find(n=>n.id===id)||null;
      const edges=new Map();
      for(const e of h.data.edges)if(e.from===id||e.to===id)edges.set(Model.ek(e),e);
      const cardChanged=Model.nodeCols.concat(Model.optionalNodeCols).some(k=>JSON.stringify(previous?.[k])!==JSON.stringify(n?.[k]));
      if(cardChanged||edges.size!==oldEdges.size||[...edges].some(([key,e])=>{
        const old=oldEdges.get(key);return !old||Model.edgeCols.some(k=>old[k]!==e[k]);
      }))hits.add(i);
      previous=n;oldEdges=edges;
    }
    touches.set(id,hits);return hits;
  }
  function revisions(doc,filters){
    const entries=[];
    for(const [i,h] of doc.history.entries()){
      const dt=new Date(h.at),pad=n=>String(n).padStart(2,'0'),day=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());
      if(filters.actor&&h.actor!==filters.actor||filters.from&&day<filters.from||filters.until&&day>filters.until||!match(filters.text,h.rev,h.note,h.actor))continue;
      if(filters.object&&!touched(doc,filters.object).has(i))continue;
      entries.push({i,h});
    }
    return filters.oldest?entries:entries.reverse();
  }
  const Model=typeof DSM!=='undefined'?DSM:require('./model.js');
  return {defaults,match,nodes,revisions,historyIndex};
})();
if(typeof module!=='undefined')module.exports=Registers;
