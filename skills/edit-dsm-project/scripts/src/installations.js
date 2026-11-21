/* Homogeneous installation plans and measured acceptance share the same resource units. */
const Installations = ((M,D) => {
  const keys=['cpuCores','ramGiB','diskGiB'];
  const titles=['CPU, ядра','RAM, ГиБ','Диск, ГиБ'];
  const loads=['component','service','module','system'];
  function number(value,label,min=0){
    if(!Number.isSafeInteger(value)||value<min)throw Error(label+' · требуется целое число от '+min);
    return value;
  }
  const linked=(node,relation)=> (node.relations||[]).filter(([k])=>k===relation).map(([,id])=>id);
  function plans(model){return model.nodes.filter(n=>n.kind==='installation'&&!n.attrs?.verification);}
  function calculate(model,id){
    const {by}=D.index(model),install=by.get(id);
    if(!install||!plans(model).includes(install))throw Error('Выберите инсталляцию');
    const targets=(k,kind)=>linked(install,k).map(id=>by.get(id)).filter(n=>n?.kind===kind);
    const [hosts,clusters]=[targets('uses','server'),targets('deployedOn','cluster')];
    if(hosts.length!==1||clusters.length!==1)throw Error(id+' · укажите один тип сервера (uses) и один кластер (deployedOn)');
    const host=hosts[0],limits=keys.map(k=>number(host.attrs?.[k],host.id+' / '+k,1));
    const spare=number(install.attrs?.spareHosts,id+' / spareHosts'),existing=number(install.attrs?.existingHosts,id+' / existingHosts');
    const price=host.attrs?.unitPriceRub;
    if(price!==undefined)number(price,host.id+' / unitPriceRub');
    const workloads=model.nodes.filter(n=>loads.includes(n.kind)&&linked(n,'deployedOn').includes(id)).map(n=>{
      const replicas=number(n.attrs?.replicas,n.id+' / replicas',1);
      const demand=keys.map(k=>number(n.attrs?.[k],n.id+' / '+k));
      if(!demand.some(Boolean)||demand.some((v,k)=>v>limits[k]))throw Error(n.id+' · реплика должна иметь ненулевую нагрузку и помещаться на одном узле');
      if(n.attrs?.antiAffinity!==undefined&&typeof n.attrs.antiAffinity!=='boolean')throw Error(n.id+' / antiAffinity · требуется true или false');
      return {id:n.id,name:n.name,replicas,demand,apart:n.attrs?.antiAffinity===true,score:Math.max(...demand.map((v,k)=>v/limits[k]))};
    });
    if(!workloads.length)throw Error(id+' · назначьте хотя бы одну нагрузку через deployedOn');
    if(workloads.reduce((s,w)=>s+w.replicas,0)>4096)throw Error('Поддерживается до 4096 реплик в одной инсталляции');
    workloads.sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0));
    const bins=[],totals=[0,0,0];
    for(const w of workloads)for(let r=0;r<w.replicas;r++){
      let bin=bins.find(b=>(!w.apart||!Object.hasOwn(b.members,w.id))&&w.demand.every((v,k)=>v+b.used[k]<=limits[k]));
      if(!bin){bin={used:[0,0,0],members:Object.create(null)};bins.push(bin);}
      bin.members[w.id]=(bin.members[w.id]||0)+1;
      w.demand.forEach((v,k)=>{bin.used[k]=number(bin.used[k]+v,'Загрузка');totals[k]=number(totals[k]+v,'Суммарная нагрузка');});
    }
    const required=number(bins.length+spare,'Узлы с резервом'),purchase=Math.max(0,required-existing);
    return {id,host:host.id,cluster:clusters[0].id,environment:install.attrs?.environment||'',limits,workloads,bins,totals,spare,existing,required,purchase,budget:price===undefined?null:number(price*purchase,'Бюджет')};
  }
  function coverage(model){
    const functions=model.nodes.filter(n=>['feature','capability'].includes(n.kind)),{by,reverse}=D.index(model);
    const implementations=new Map(),requirements=new Map();
    for(const n of model.nodes)for(const target of linked(n,'realizes')){
      const map=by.get(target)?.kind==='requirement'?requirements:implementations;
      const key=map===requirements?n.id:target;if(!map.has(key))map.set(key,[]);map.get(key).push(map===requirements?target:n);
    }
    return functions.map(f=>{
      const units=(implementations.get(f.id)||[]).filter(n=>loads.includes(n.kind));
      const routes=units.flatMap(n=>linked(n,'deployedOn').filter(id=>by.get(id)?.kind==='installation'&&!by.get(id).attrs?.verification).map(id=>[n.id,id]));
      const reqs=[...new Set([...(requirements.get(f.id)||[]),...units.flatMap(n=>requirements.get(n.id)||[])])];
      const evidence=[...new Set(reqs.flatMap(r=>(reverse.get(r)||[]).filter(n=>n.kind==='installation'&&n.attrs?.verification&&routes.some(([,id])=>n.refs?.includes(id))).map(n=>n.id)))];
      return {id:f.id,requirements:reqs,units:units.map(n=>n.id),routes,evidence,covered:reqs.length>0&&units.length>0&&units.every(n=>routes.some(([unit])=>unit===n.id))};
    });
  }
  function receipt(doc,input){
    const h=M.head(doc);
    if(input.project!==doc.project||input.base!==h.rev)throw Error('Устаревшая база блокнота. Сгенерируйте блокнот текущей версии.');
    const f=input.observation,model=h.data;
    if(!f||!Array.isArray(f.inventory)||!f.inventory.length)throw Error('Введите фактические узлы в блокноте');
    const ch=D.chain(model,f.requirement,undefined,f.proposal);
    // A requirement can have several change requests. Resolve the exact proposal.
    const request=ch.requests.find(r=>D.index(model).by.get(f.proposal)?.refs?.includes(r.id));
    const selected=D.chain(model,f.requirement,request?.id,f.proposal);
    if(selected.proposal?.id!==f.proposal||selected.proposal.state!=='done'||selected.proposal.attrs?.appliedObject!==f.installation)throw Error('Предложение должно быть применено к выбранной инсталляции');
    const p=calculate(model,f.installation),names=new Set();
    const actual=f.inventory.map(row=>{
      if(typeof row?.id!=='string'||!row.id.trim()||names.has(row.id.trim()))throw Error('Каждому фактическому узлу нужен уникальный ID');
      const id=row.id.trim();names.add(id);
      const values=keys.map(k=>number(row[k],id+' / '+k));
      return {id,values,qualified:values.every((v,k)=>v>=p.limits[k])};
    });
    const good=actual.filter(r=>r.qualified).length;
    const source=typeof f.source==='string'&&f.source.trim();
    if(!source)throw Error('Укажите источник фактических измерений');
    const observed=D.observe(model,selected,{actor:f.actor,environment:f.environment,outcome:good>=p.required?'passed':'failed',
      evidence:source+' · соответствуют профилю '+good+' из '+p.required+' требуемых. '+actual.map(r=>r.id+' ('+r.values.join(' / ')+')').join(', ')});
    const id=D.nextId(model,'OBS'),n=D.index(observed).by.get(id);
    const refs=[...new Set([...n.refs,p.host,p.cluster,...p.workloads.map(w=>w.id),...selected.decisions.map(n=>n.id),...selected.tasks.map(n=>n.release).filter(Boolean)])];
    return M.patch(observed,[{op:'node',value:{id,refs,relations:[['verifies',f.requirement]],attrs:{...n.attrs,source:'Jupyter',evidenceSource:source,base:h.rev,inventory:JSON.stringify(actual),requiredHosts:p.required,qualifiedHosts:good}}}]);
  }
  return {keys,titles,loads,plans,calculate,coverage,receipt,linked};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Delivery!=='undefined'?Delivery:require('./delivery.js'));
if(typeof module!=='undefined')module.exports=Installations;
