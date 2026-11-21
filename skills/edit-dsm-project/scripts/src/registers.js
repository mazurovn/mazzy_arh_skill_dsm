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
  function revisions(doc,filters){
    const entries=[];
    for(const [i,h] of doc.history.entries()){
      const dt=new Date(h.at),pad=n=>String(n).padStart(2,'0'),day=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());
      if(filters.actor&&h.actor!==filters.actor||filters.from&&day<filters.from||filters.until&&day>filters.until||!match(filters.text,h.rev,h.note,h.actor))continue;
      if(filters.object){
        const id=filters.object,prev=doc.history[i-1]?.data||{title:h.data.title,nodes:[],edges:[]};
        const differs=Model.diff(prev,h.data).some(c=>c.type==='nodes'&&c.key===id||c.type==='edges'&&[c.before,c.after].some(e=>e&&(e.from===id||e.to===id)));
        if(!differs)continue;
      }
      entries.push({i,h});
    }
    return filters.oldest?entries:entries.reverse();
  }
  const Model=typeof DSM!=='undefined'?DSM:require('./model.js');
  return {defaults,match,nodes,revisions};
})();
if(typeof module!=='undefined')module.exports=Registers;
