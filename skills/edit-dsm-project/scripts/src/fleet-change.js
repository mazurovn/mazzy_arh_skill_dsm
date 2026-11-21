const FleetChange=((M,F,A)=>{
  const index=m=>new Map(m.nodes.map(n=>[n.id,n]));
  const node=value=>({op:'node',value});
  const required=(v,label)=>{if(typeof v!=='string'||!v.trim())throw Error('Заполните '+label);return v.trim();};
  function fresh(model,prefix){const by=index(model);let i=1;while(by.has(prefix+'-'+i))i++;return prefix+'-'+i;}
  const linked=(m,id)=>m.nodes.filter(n=>n.refs?.includes(id)||n.parent===id);
  const variants=(m,id)=>linked(m,id).filter(n=>F.role(n)==='variant'&&n.parent===id);
  function cluster(model,analysis,layer){
    const ids=new Set(analysis.sites.flatMap(s=>s.loads.map(l=>l.id)));
    const subset={nodes:model.nodes.filter(n=>ids.has(n.id)),edges:model.edges.filter(e=>ids.has(e.from)&&ids.has(e.to))};
    return A.calculate(subset,layer);
  }
  function freeze(doc,id,choice,name,release,budget,description){
    const h=M.head(doc),m=h.data,by=index(m);
    if(by.get(release)?.kind!=='release')throw Error('Выберите релиз');
    if(!choice?.available)throw Error('Нет допустимого варианта');
    if(budget!=null&&(!Number.isSafeInteger(budget)||budget<0))throw Error('Неверный бюджет');
    const variant=fresh(m,'PLAN'),ops=[node({id:variant,name:required(name,'название варианта'),kind:'artifact',parent:id,release,state:'planned',
      note:required(description,'целевое состояние'),attrs:{fleetRole:'variant',base:h.rev,option:choice.key,stage:'draft',...(budget==null?{}:{budget})}})];
    const proposal=fresh(m,'CHANGE'),task=fresh(m,'WORK');
    ops.push(node({id:proposal,kind:'proposal',name:'Изменение парка · '+name,release,state:'planned',note:description,
      refs:[variant,id],attrs:{fleetRole:'fleetProposal'}}),
      node({id:task,kind:'changeTask',parent:proposal,release,state:'planned',name:'Поставка и ввод · '+name,refs:[variant,id]}));
    let seq=0;
    for(const site of choice.sites)for(const [stock,quantity] of Object.entries(site.order)){
      if(!quantity)continue;let key;
      do{key='LINE-'+variant+'-'+(++seq);}while(by.has(key));
      ops.push(node({id:key,name:'Приобрести · '+by.get(stock).name,kind:'artifact',parent:variant,release,attrs:{fleetRole:'order',quantity},relations:[['uses',stock],['deployedOn',site.site]]}));
    }
    return M.patch(m,ops);
  }
  function historical(doc,plan){
    const h=doc.history.find(h=>h.rev===plan.attrs.base);
    if(!h)throw Error('Нет исходной ревизии варианта '+plan.id);
    const original=F.inputs(h.data,plan.parent),m=M.head(doc).data,lines=m.nodes.filter(n=>n.parent===plan.id&&F.role(n)==='order');
    const order={},pools=new Map(original.flatMap(s=>s.pools.map(p=>[p.id,s.id])));
    for(const l of lines){
      const [pool]=F.ids(l,'uses'),[site]=F.ids(l,'deployedOn');
      if(pools.get(pool)!==site||!site||Object.hasOwn(order,pool))throw Error('Некорректная позиция заказа '+l.id);
      Object.defineProperty(order,pool,{value:l.attrs.quantity,enumerable:true});
    }
    return {base:h,original,choice:F.summary(plan.id,plan.name,original.map(s=>F.evaluate(s,Object.fromEntries(s.pools.map(p=>[p.id,order[p.id]??0])))))};
  }
  function approve(doc,planId,f){
    const m=M.head(doc).data,by=index(m),plan=by.get(planId);
    if(F.role(plan)!=='variant'||plan.attrs.stage!=='draft')throw Error('Выберите черновик');
    const req=by.get(f.requirement),spec=by.get(f.specification);
    if(req?.kind!=='requirement'||!req.refs?.includes(plan.parent)||F.role(spec)!=='specification'||!spec.refs?.includes(req.id))throw Error('Свяжите требование с закупкой, а спецификацию с требованием');
    const decision={context:required(f.context,'контекст'),alternatives:required(f.alternatives,'сравнение альтернатив'),rationale:required(f.rationale,'обоснование'),consequences:required(f.consequences,'последствия'),owner:required(f.owner,'ответственного')};
    const {choice}=historical(doc,plan),rule=F.tree(choice,plan.attrs.budget);
    if(rule.checks.some(c=>!c.pass))throw Error(rule.outcome);
    const proposal=m.nodes.find(n=>F.role(n)==='fleetProposal'&&n.refs?.includes(planId));
    const governing=[req.id,spec.id,...(proposal?[proposal.id]:[])];
    const evidence=JSON.stringify([req.id,req.note,req.attrs?.when,req.attrs?.then,spec.id,spec.note]);
    const adr=fresh(m,'ADR');
    return M.patch(m,[node({id:adr,name:'Выбор архитектуры · '+plan.name,kind:'adr',state:'done',release:plan.release,
      note:Object.entries(decision).slice(0,4).map(([k,v],i)=>['Контекст','Альтернативы','Решение','Последствия'][i]+'\n'+v).join('\n\n'),
      refs:[plan.id,plan.parent,...governing],attrs:{...decision,evidence,baseline:plan.attrs.base,approvedOrder:JSON.stringify(choice.sites.map(s=>s.order)),approvedBudget:plan.attrs.budget??'',
        approvedRelease:plan.release}}),node({id:plan.id,state:'active',refs:[...governing,adr],attrs:{...plan.attrs,stage:'approved'}}),
      ...(proposal?[node({id:proposal.id,state:'active',refs:[...new Set([...proposal.refs,req.id,spec.id,adr])]})]:[])]);
  }
  function implement(doc,id){
    const m=M.head(doc).data,by=index(m),plan=by.get(id);
    if(F.role(plan)!=='variant'||plan.attrs.stage!=='approved')throw Error('Нужен согласованный вариант');
    const {original,choice}=historical(doc,plan),adr=(plan.refs||[]).map(k=>by.get(k)).find(n=>n?.kind==='adr'&&n.refs?.includes(id));
    if(!adr||adr.attrs?.approvedOrder!==JSON.stringify(choice.sites.map(s=>s.order))||adr.attrs?.baseline!==plan.attrs.base||adr.attrs?.approvedRelease!==plan.release||
      adr.attrs?.approvedBudget!==(plan.attrs.budget??''))throw Error('Параметры расходятся с согласованным ADR');
    if(JSON.stringify(F.inputs(m,plan.parent))!==JSON.stringify(original))throw Error('Состав, цена или нагрузка изменились после расчёта. Пересчитайте вариант.');
    const req=(adr.refs||[]).map(k=>by.get(k)).find(n=>n?.kind==='requirement'),spec=(adr.refs||[]).map(k=>by.get(k)).find(n=>F.role(n)==='specification');
    if(!req?.refs?.includes(plan.parent)||!spec?.refs?.includes(req.id)||adr.attrs.evidence&&adr.attrs.evidence!==JSON.stringify([req.id,req.note,req.attrs?.when,req.attrs?.then,spec.id,spec.note]))throw Error('Требование или спецификация изменились после согласования ADR');
    const proposal=(plan.refs||[]).map(k=>by.get(k)).find(n=>F.role(n)==='fleetProposal');
    const ops=proposal?[node({id:proposal.id,state:'done',attrs:{...proposal.attrs,appliedObject:plan.parent}}),
      ...m.nodes.filter(n=>n.kind==='changeTask'&&n.parent===proposal.id).map(n=>node({id:n.id,state:'done'}))]:[];
    for(const s of choice.sites)for(const [stock,add] of Object.entries(s.order))if(add){const attrs=by.get(stock).attrs;
      ops.push(node({id:stock,attrs:{...attrs,quantity:attrs.quantity+add,maxBuy:attrs.maxBuy-add}}));}
    ops.push(node({id,state:'done',attrs:{...plan.attrs,stage:'implemented'}}));
    return M.patch(m,ops);
  }
  function groupRows(sites,key){
    const groups=new Map();
    for(const s of sites)for(const p of s.pools){
      const label=key==='sku'?p.sku:key==='cluster'?s.cluster:s.id;
      if(!groups.has(label))groups.set(label,{key:label,stock:[],sites:new Set(),quantity:0});
      const g=groups.get(label);g.stock.push(p.id);g.sites.add(s.id);g.quantity+=p.quantity;
    }
    return [...groups.values()].map(g=>({...g,sites:[...g.sites]}));
  }
  function saveClusters(m,root,layer){
    if(!['flow','risk'].includes(layer))throw Error('Выберите слой DSM');
    const groups=cluster(m,F.analyze(m,root),layer).groups,old=linked(m,root).filter(n=>F.role(n)==='partition'&&n.attrs.layer===layer);
    const ops=[];
    for(const [i,members] of groups.entries()){
      const prior=old.find(n=>n.attrs.number===i+1),id=prior?.id||fresh({nodes:[...m.nodes,...ops.map(o=>o.value)]},'GROUP');
      ops.push(node({id,name:'DSM '+layer+' · группа '+(i+1),kind:'cluster',parent:root,refs:members,state:'active',attrs:{fleetRole:'partition',number:i+1,layer}}));
    }
    for(const obsolete of old.filter(n=>n.attrs.number>groups.length))ops.push(node({id:obsolete.id,state:'done',refs:[]}));
    return M.patch(m,ops);
  }
  function fromBook(doc,input){
    const h=M.head(doc);
    if(doc.project!==input.project||h.rev!==input.base)throw Error('Другая база блокнота. Загрузите актуальный проект.');
    const m=M.validate(input.data),f=input.lab,analysis=F.analyze(m,f.root);
    let candidate=analysis.choices.find(c=>c.key===f.key);
    if(f.key==='manual'){
      const valid=new Set(analysis.sites.flatMap(s=>s.pools.map(p=>p.id)));
      if(!f.order||Object.keys(f.order).some(k=>!valid.has(k)))throw Error('Неизвестная строка ручного заказа');
      candidate=F.summary('manual','Ручной заказ',analysis.sites.map(s=>F.evaluate(s,Object.fromEntries(s.pools.map(p=>[p.id,f.order[p.id]??0])))));
    }
    if(!candidate?.available)throw Error('Выбранный вариант недоступен');
    const results=candidate.sites.flatMap(s=>s.failures.map(x=>[s.site,x.host,x.unplaced,x.moves]));
    if(f.cost!==candidate.cost||f.worst!==candidate.worst||JSON.stringify(f.failures)!==JSON.stringify(results))throw Error('Расчёты Python и DSM расходятся. Выполните все ячейки заново.');
    if(!f.clusters||['flow','risk'].some(layer=>JSON.stringify(f.clusters[layer])!==JSON.stringify(cluster(m,analysis,layer).groups)))throw Error('Разбиение Python и DSM расходится');
    const settings=f.lifecycle||{},act=settings.action||'record';
    if(act==='cluster')return saveClusters(m,f.root,settings.layer||'flow');
    if(['save','approve','implement'].includes(act)){
      if(M.diff(h.data,m).length)throw Error('Сначала верните исходные правки через record и сгенерируйте блокнот на новой базе');
      if(act==='save')return freeze(doc,f.root,candidate,settings.name,settings.release,f.budget,settings.description);
      if(index(m).get(settings.plan)?.parent!==f.root)throw Error('Вариант другой закупки');
      return act==='approve'?approve(doc,settings.plan,settings):implement(doc,settings.plan);
    }
    if(act!=='record')throw Error('Неизвестная операция блокнота');
    const plans=variants(m,f.root).filter(n=>n.attrs.stage==='implemented');
    const delivery=plans.flatMap(n=>[n.id,n.release,...(n.refs||[])]);
    const refs=[...new Set([f.root,...delivery,...analysis.sites.flatMap(s=>[s.id,s.cluster,...s.pools.flatMap(p=>[p.id,p.sku]),...s.loads.map(l=>l.id)]),
      ...linked(m,f.root).filter(n=>n.kind==='requirement'||['specification','source'].includes(F.role(n))).map(n=>n.id)])];
    let observed={};
    if(f.inventory_source){
      const src=f.inventory_source,rows=f.inventory;
      if(!src.filename||!/^[a-f0-9]{64}$/.test(src.sha256)||!Number.isSafeInteger(src.bytes)||src.bytes<=0||src.bytes>2*1024*1024||typeof src.content64!=='string'||atob(src.content64).length!==src.bytes||!Array.isArray(rows))throw Error('Повреждена ведомость измерений');
      const pools=analysis.sites.flatMap(s=>s.pools),byPool=new Map(pools.map(p=>[p.id,p])),seen=new Set(),count=new Map();
      let good=0;
      for(const row of rows){
        const p=byPool.get(row.pool);
        if(!p||typeof row.serial!=='string'||!row.serial.trim()||seen.has(row.serial)||!Array.isArray(row.values)||row.values.length!==3||row.values.some(v=>!Number.isSafeInteger(v)||v<=0))throw Error('Некорректный замер сервера');
        seen.add(row.serial);if(row.values.every((v,i)=>v>=p.limits[i])){good++;count.set(p.id,(count.get(p.id)||0)+1);}
      }
      observed={inventoryFile:src.filename,inventoryHash:src.sha256,inventoryBytes:src.bytes,content64:src.content64,observations:JSON.stringify(rows),
        qualified:good,measured:seen.size,conforms:good===seen.size&&pools.every(p=>(count.get(p.id)||0)===p.quantity)};
    }
    return M.patch(m,[node({id:fresh(m,'SIM'),kind:'artifact',parent:f.root,name:'Моделирование отказов · '+candidate.label,state:'done',refs,
      note:'Симуляция одиночной потери узла. Стоимость '+candidate.cost+' ₽. Максимум неразмещённых реплик '+candidate.worst+'.',
      attrs:{fleetRole:'simulation',...observed,option:f.key,...(f.budget==null?{}:{budget:f.budget}),base:h.rev,cost:candidate.cost,worst:candidate.worst,order:JSON.stringify(candidate.sites.map(s=>s.order)),failures:JSON.stringify(results)}})]);
  }
  return {fresh,linked,variants,cluster,freeze,historical,approve,implement,groupRows,saveClusters,fromBook};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Fleet!=='undefined'?Fleet:require('./fleet.js'),typeof Analysis!=='undefined'?Analysis:require('./analysis.js'));
if(typeof module!=='undefined')module.exports=FleetChange;
