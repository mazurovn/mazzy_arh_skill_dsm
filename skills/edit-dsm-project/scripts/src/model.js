/* Shared by the browser and the local agent. IDs remain stable through renames. */
const DSM = (() => {
  const kinds = ['component','module','product','release','feature'];
  const states = ['idea','planned','active','review','blocked','done','unspecified'];
  const nodeCols = ['id','name','kind','state','parent','release','segment','bundle','effort','capacity','note'];
  const edgeCols = ['layer','from','to','weight','reason'];
  const copy = x => JSON.parse(JSON.stringify(x));
  const fail = msg => { throw new Error(msg); };
  const idOK = s => typeof s === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(s);
  const uid = () => globalThis.crypto.randomUUID();
  function only(o, keys) {
    if(!o || typeof o !== 'object' || Array.isArray(o)) fail('Ожидается объект');
    for(const k of Object.keys(o)) if(!keys.includes(k)) fail('Неизвестное поле: '+k);
  }
  function asText(s, name) {
    if (typeof s !== 'string') fail('Ожидается текст: '+name);
    return s;
  }
  function node(n) {
    only(n,nodeCols);
    const v={id:'',name:'',kind:'component',state:'unspecified',parent:'',release:'',segment:'',bundle:'',effort:null,capacity:null,note:'',...n};
    if(!idOK(v.id)||!asText(v.name,'name').trim()) fail('Нужны корректный ID и название узла: '+v.id);
    if(!kinds.includes(v.kind)||!states.includes(v.state)) fail('Недопустимый вид или статус: '+v.id);
    for(const key of ['parent','release','segment','bundle','note']) asText(v[key],key);
    for(const key of ['effort','capacity']) if(v[key]!==null && (!Number.isFinite(v[key])||v[key]<0)) fail('Оценка должна быть неотрицательным числом: '+key);
    if(v.capacity!==null && v.kind!=='release') fail('Ёмкость задаётся у релиза: '+v.id);
    if(v.bundle && v.kind!=='feature') fail('В пакеты объединяются фичи: '+v.id);
    return v;
  }
  function edge(e) {
    only(e,edgeCols);
    if(!['flow','risk'].includes(e.layer)||!idOK(e.from)||!idOK(e.to)||e.from===e.to) fail('Некорректная связь: '+[e.layer,e.from,e.to].join(' '));
    if(!Number.isSafeInteger(e.weight)||e.weight<=0||!asText(e.reason,'reason').trim()) fail('У связи обязательны положительный целый вес и основание');
    return {...e};
  }
  function ek(e){return JSON.stringify([e.layer,...(e.layer==='risk'?[e.from,e.to].sort():[e.from,e.to])]);}
  function validate(data) {
    only(data,['title','nodes','edges']);
    if(!asText(data.title,'title').trim()||!Array.isArray(data.nodes)||!Array.isArray(data.edges)) fail('Нужны название проекта, узлы и связи');
    const nodes=data.nodes.map(node), edges=data.edges.map(edge), by=new Map(nodes.map(n=>[n.id,n]));
    if(by.size!==nodes.length) fail('Повтор ID узла');
    for(const n of nodes) {
      if(n.release && (by.get(n.release)?.kind!=='release'||n.id===n.release)) fail('Неверная ссылка на релиз у '+n.id);
      const seen=new Set([n.id]); let p=n.parent;
      while(p) { if(!by.has(p)||seen.has(p)) fail('Неверный родитель или цикл у '+n.id); seen.add(p); p=by.get(p).parent; }
    }
    const keys=new Set();
    for(const e of edges){if(!by.has(e.from)||!by.has(e.to))fail('Неизвестный конец связи: '+e.from+' / '+e.to);if(keys.has(ek(e)))fail('Повтор связи: '+e.from+' / '+e.to);keys.add(ek(e));}
    return {title:data.title,nodes,edges};
  }
  const head = doc => doc.history[doc.history.length-1];
  function document(doc) {
    if(doc?.schema!=='dsm-project/1'||!idOK(doc.project)||!Array.isArray(doc.history)||!doc.history.length)fail('Неверный формат проекта DSM');
    let parent=null;const seen=new Set();
    for(const h of doc.history){if(!idOK(h.rev)||seen.has(h.rev)||h.parent!==parent||typeof h.note!=='string'||typeof h.actor!=='string'||!Number.isFinite(Date.parse(h.at)))fail('Повреждена цепочка версий');seen.add(h.rev);validate(h.data);parent=h.rev;}
    return {...doc,history:doc.history.map(h=>({...h,data:validate(h.data)}))};
  }
  function revision(data,note,actor,parent=null){
    if(typeof note!=='string'||!note.trim()||typeof actor!=='string'||!actor.trim())fail('Укажите автора и описание изменения');
    return {rev:uid(),parent,at:new Date().toISOString(),actor,note,data:validate(data)};
  }
  function create(data,note='Создание проекта',actor='Автор'){return {schema:'dsm-project/1',project:uid(),history:[revision(data,note,actor)]};}
  function commit(doc,data,base,note,actor){if(head(doc).rev!==base)fail('Конфликт версий: перечитайте проект и сравните изменения');return {...doc,history:[...doc.history,revision(data,note,actor,base)]};}
  function patch(data,ops){
    if(!Array.isArray(ops)||!ops.length)fail('Ожидается непустой массив ops');
    const d=copy(data);
    for(const op of ops){
      if(op.op==='title'){d.title=op.value;continue;}
      if(op.op==='node'){const i=d.nodes.findIndex(n=>n.id===op.value.id);if(i<0)d.nodes.push(node(op.value));else d.nodes[i]=node({...d.nodes[i],...op.value});continue;}
      if(op.op==='edge'){const v=edge(op.value), i=d.edges.findIndex(e=>ek(e)===ek(v));if(i<0)d.edges.push(v);else d.edges[i]=v;continue;}
      if(op.op==='removeEdge'){const i=d.edges.findIndex(e=>ek(e)===ek(op.value));if(i<0)fail('Связь не найдена');d.edges.splice(i,1);continue;}
      if(op.op==='removeNode'){const i=d.nodes.findIndex(n=>n.id===op.id);if(i<0)fail('Узел не найден');d.nodes.splice(i,1);continue;}
      fail('Неизвестная операция: '+op.op);
    }
    return validate(d);
  }
  function diff(a,b){
    const out=[];
    if(a.title!==b.title)out.push({type:'project',key:'title',before:a.title,after:b.title});
    for(const [field,key] of [['nodes',n=>n.id],['edges',ek]]){
      const x=new Map(a[field].map(v=>[key(v),v])), y=new Map(b[field].map(v=>[key(v),v]));
      for(const k of new Set([...x.keys(),...y.keys()])){const before=x.get(k)??null,after=y.get(k)??null;
        if(!before||!after||Object.keys(before).some(p=>before[p]!==after[p]))out.push({type:field,key:k,before,after});
      }
      const ax=[...x.keys()].filter(k=>y.has(k)),by=[...y.keys()].filter(k=>x.has(k));
      if(JSON.stringify(ax)!==JSON.stringify(by))out.push({type:field,key:'(порядок)',before:ax,after:by});
    }
    return out;
  }
  function legacy(src,title='Импорт DSM'){
    if(!Array.isArray(src.nodes)||!Array.isArray(src.flow)||!Array.isArray(src.risk))fail('Ожидается каталог nodes/flow/risk');
    return validate({title,nodes:src.nodes.map(n=>node({id:n.code,name:n.name,kind:'module'})),edges:['flow','risk'].flatMap(layer=>src[layer].map(e=>({...e,layer})))});
  }
  function plan(d){
    return d.nodes.filter(n=>n.kind==='release').map(r=>{
      const items=d.nodes.filter(n=>n.release===r.id), ids=new Set(items.map(n=>n.id));
      return {id:r.id,name:r.name,capacity:r.capacity,assigned:items.length,knownEffort:items.reduce((a,n)=>a+(n.effort??0),0),unknown:items.filter(n=>n.effort===null).length,done:items.filter(n=>n.state==='done').length,
        outgoing:d.edges.filter(e=>e.layer==='flow'&&ids.has(e.from)&&!ids.has(e.to)).length,
        crossChecks:d.edges.filter(e=>e.layer==='risk'&&ids.has(e.from)!==ids.has(e.to)).length};
    });
  }
  return {kinds,states,nodeCols,edgeCols,uid,idOK,copy,fail,node,edge,ek,validate,document,create,head,commit,patch,diff,legacy,plan};
})();
if (typeof module !== 'undefined') module.exports=DSM;
