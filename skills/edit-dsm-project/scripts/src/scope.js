/* Bound the visible projection while keeping the original order and IDs. */
const Scope = (() => {
  function page(items, number, size) {
    const pages=Math.max(1,Math.ceil(items.length/size));
    const current=Math.max(0,Math.min(number,pages-1));
    const start=current*size;
    return {items:items.slice(start,start+size),current,pages,start,total:items.length};
  }
  function graph(model, mode, layer, focus, pair, groups, number, structure) {
    const by=new Map(model.nodes.map(n=>[n.id,n]));
    let nodes=model.nodes;
    let edges=model.edges.filter(e=>e.layer===layer);
    if(Object.hasOwn(Views.architectureKinds,mode)){
      const kinds=Views.architectureKinds[mode];
      nodes=nodes.filter(n=>kinds.includes(n.kind)&&(mode!=='infra'||!n.attrs?.verification));
      const ids=new Set(nodes.map(n=>n.id));
      edges=[...Views.structures(model),...edges].filter(e=>ids.has(e.from)&&ids.has(e.to));
    }else if(mode==='component'){
      nodes=nodes.filter(n=>['module','component','system','service','product'].includes(n.kind));
      const eligible=new Set(nodes.map(n=>n.id));
      edges=edges.filter(e=>eligible.has(e.from)&&eligible.has(e.to));
    }else if(mode==='neighbors'){
      edges=edges.filter(e=>e.from===focus||e.to===focus);
      const adjacent=new Set([focus,...edges.flatMap(e=>[e.from,e.to])]);
      nodes=nodes.filter(n=>adjacent.has(n.id));
    }else if(mode==='all'){
      nodes=groups.flat().map(id=>by.get(id));
    }else if(mode==='tree'||mode==='concept'){
      edges=Views.structures(model).filter(e=>mode==='concept'||e.layer==='parent');
    }
    const window=page(nodes,number,48);
    const selected=new Set(window.items.map(n=>n.id));
    const pins=pair|| (structure?[structure.from,structure.to]:[]);
    for(const n of nodes)if(pins.includes(n.id)||mode==='neighbors'&&n.id===focus)selected.add(n.id);
    const inside=edges.filter(e=>selected.has(e.from)&&selected.has(e.to));
    const boundary=edges.filter(e=>selected.has(e.from)!==selected.has(e.to));
    const slice={nodes:[...selected].map(id=>by.get(id)),edges:inside};
    return {window,focusPage:Math.max(0,Math.floor(nodes.findIndex(n=>n.id===focus)/48)),model:slice,edges:inside,crossing:boundary.length,boundary,by,groups:groups.map(g=>g.filter(id=>selected.has(id))).filter(g=>g.length)};
  }
  return {page,graph};
})();
if(typeof module!=='undefined')module.exports=Scope;
