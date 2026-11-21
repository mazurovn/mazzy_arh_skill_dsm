/* The guided workflow writes normal model cards and versioned relationships. */
const Delivery = ((M,C) => {
  const stages={
    intake:'Требование',review:'Разбор запроса',deferred:'Отложено',declined:'Отклонено',
    propose:'Подготовка предложения',decision:'Архитектурное решение',plan:'Планирование',
    work:'Исполнение работ',apply:'Применение модели',verify:'Проверка внедрения',
    deviation:'Устранение отклонения',done:'Внедрение подтверждено'
  };
  const cached=new WeakMap();
  function index(model){
    if(cached.has(model))return cached.get(model);
    const by=new Map(),reverse=new Map(),children=new Map();
    function add(map,id,n){if(!map.has(id))map.set(id,[]);map.get(id).push(n);}
    for(const n of model.nodes){
      by.set(n.id,n);
      for(const ref of n.refs||[])add(reverse,ref,n);
      if(n.parent)add(children,n.parent,n);
    }
    const value={by,reverse,children};
    cached.set(model,value);return value;
  }
  function related(idx,n,kind){
    if(!n)return [];
    return [...new Set([...(n.refs||[]).map(id=>idx.by.get(id)),...(idx.reverse.get(n.id)||[])])].filter(x=>x?.kind===kind);
  }
  function chain(model,id,requestId,proposalId){
    const idx=index(model),requirement=idx.by.get(id);
    if(requirement?.kind!=='requirement')throw Error('Выберите требование');
    const requests=related(idx,requirement,'request');
    const failed=related(idx,requirement,'deviation').filter(n=>n.state!=='done');
    const needsCheck=p=>p.state==='done'&&!related(idx,p,'installation').some(n=>n.refs?.includes(id)&&n.attrs?.verification==='passed');
    const priority=p=>failed.some(d=>d.refs?.includes(p.id))||needsCheck(p);
    const choose=(items,wanted,attention)=>items.find(n=>n.id===wanted)||items.find(n=>n.state!=='done')||items.find(attention)||items.at(-1);
    const request=choose(requests,requestId,r=>related(idx,r,'proposal').some(priority));
    const proposals=request?related(idx,request,'proposal'):related(idx,requirement,'proposal');
    const proposal=choose(proposals,proposalId,priority);
    const tasks=(idx.children.get(proposal?.id)||[]).filter(n=>n.kind==='changeTask');
    const decisions=related(idx,proposal,'adr');
    const observations=related(idx,proposal,'installation').filter(n=>n.refs?.includes(id)&&n.attrs?.verification);
    const findings=related(idx,proposal,'deviation').filter(n=>n.refs?.includes(id));
    const deviations=findings.filter(n=>n.state!=='done');
    let stage='intake';
    if(proposal){
      if(proposal.state==='done')stage=deviations.length?'deviation':observations.some(n=>n.attrs.verification==='passed')?'done':'verify';
      else if(!decisions.length)stage='decision';
      else if(!tasks.length)stage='plan';
      else stage=tasks.some(t=>t.state!=='done')?'work':'apply';
    }else if(request){
      stage=({accepted:'propose',deferred:'deferred',declined:'declined'})[request.attrs?.disposition]||'review';
    }
    return {requirement,requests,request,proposals,proposal,tasks,decisions,observations,deviations,findings,stage};
  }
  function value(s,label){if(typeof s!=='string'||!s.trim())throw Error('Заполните «'+label+'»');return s.trim();}
  function fresh(model,id){if(index(model).by.has(id))throw Error('ID уже занят · '+id);return id;}
  function nextId(model,prefix){
    const by=index(model).by;let i=1;while(by.has(prefix+'-'+i))i++;return prefix+'-'+i;
  }
  function requirement(model,f){
    return M.patch(model,[{op:'node',value:{id:fresh(model,f.id),kind:'requirement',state:'planned',name:value(f.name,'Название'),
      note:value(f.need,'Потребность'),attrs:{when:value(f.when,'Условие'),then:value(f.then,'Результат'),owner:value(f.owner,'Ответственный'),due:f.due||''}}}]);
  }
  function decision(model,ch,f){
    return M.patch(model,[{op:'node',value:{id:fresh(model,f.id),kind:'adr',state:'done',name:value(f.name,'Решение'),
      note:'## Контекст\n\n'+ch.requirement.note+'\n\n## Решение\n\n'+value(f.choice,'Выбранный вариант')+'\n\n## Последствия\n\n'+value(f.effects,'Последствия'),
      refs:[ch.proposal.id,ch.requirement.id],attrs:{owner:value(f.actor,'Автор')}}}]);
  }
  function task(model,ch,f){
    if(!index(model).by.has(f.release)||index(model).by.get(f.release).kind!=='release')throw Error('Выберите релиз');
    const effort=f.effort===''||f.effort==null?null:Number(f.effort);
    const next=C.task(model,ch.proposal.id,f.id,f.name,value(f.owner,'Исполнитель'));
    if(f.after&&!ch.tasks.some(t=>t.id===f.after))throw Error('Предшественник должен относиться к предложению');
    return M.patch(next,[{op:'node',value:{id:f.id,release:f.release,effort,relations:f.after?[['dependsOn',f.after]]:[]}}]);
  }
  function checkTasks(model){
    const {by}=index(model);
    for(const n of model.nodes)if(n.kind==='changeTask'&&n.state==='done'){
      for(const [kind,id] of n.relations||[])if(kind==='dependsOn'&&by.get(id)?.kind==='changeTask'&&by.get(id).state!=='done')
        throw Error('Сначала завершите работу '+id+' для '+n.id);
    }
    return model;
  }
  function taskState(model,id){
    const n=index(model).by.get(id);
    if(n?.kind!=='changeTask'||index(model).by.get(n.parent)?.state==='done')throw Error('Требуется работа открытого предложения');
    return checkTasks(M.patch(model,[{op:'node',value:{id,state:n.state==='done'?'active':'done'}}]));
  }
  function apply(model,ch,f){
    if(ch.stage!=='apply')throw Error('Для применения нужны решение и завершённые работы');
    const target=value(f.target,'ID объекта'),existing=index(model).by.get(target);
    const field=value(f.attribute,'Атрибут');
    if(['__proto__','constructor','prototype'].includes(field))throw Error('Выберите другое имя атрибута');
    const raw=value(f.value,'Значение');
    let result=raw;
    if(f.type==='number'){result=Number(raw);if(!Number.isFinite(result))throw Error('Введите число');}
    if(f.type==='boolean'){if(!['true','false'].includes(raw))throw Error('Введите true или false');result=raw==='true';}
    if(existing&&['requirement','proposal','request','changeTask','adr'].includes(existing.kind))throw Error('Выберите объект архитектуры');
    const card=existing?{id:target}:{id:target,name:value(f.targetName,'Название нового компонента'),kind:'component'};
    const relations=(existing?.relations||[]).slice();
    if(!relations.some(([k,id])=>k==='realizes'&&id===ch.requirement.id))relations.push(['realizes',ch.requirement.id]);
    const patch=M.patch(model,[{op:'node',value:{...card,attrs:{...existing?.attrs,[field]:result},relations}},
      {op:'node',value:{id:ch.proposal.id,attrs:{...ch.proposal.attrs,appliedObject:target}}}]);
    return C.completeProposal(patch,ch.proposal.id);
  }
  function observe(model,ch,f){
    if(ch.proposal?.state!=='done')throw Error('Сначала примените предложение');
    const environment=value(f.environment,'Среда'),actor=value(f.actor,'Автор'),evidence=value(f.evidence,'Фактический результат');
    if(!['passed','failed'].includes(f.outcome))throw Error('Выберите результат проверки');
    const target=ch.proposal.attrs?.appliedObject||f.target;
    if(!target||!index(model).by.has(target))throw Error('Укажите проверенный объект проекта');
    const refs=[...new Set([ch.requirement.id,ch.proposal.id,target])];
    const id=nextId(model,'OBS'),failed=f.outcome==='failed',attrs={environment,owner:actor,verification:f.outcome,observedAt:new Date().toISOString()};
    const ops=[{op:'node',value:{id,kind:'installation',name:'Проверка · '+environment,state:'done',note:evidence,attrs,refs}}];
    const same=ch.deviations.filter(d=>d.attrs?.environment===environment&&d.refs?.includes(target)&&d.attrs?.source==='delivery');
    if(failed){
      ops.push({op:'node',value:{id:nextId(model,'DEV'),kind:'deviation',name:'Расхождение · '+environment,state:'review',refs:[...refs,id],
        note:evidence,attrs:{source:'delivery',environment,expected:ch.requirement.attrs?.then||ch.requirement.note,actual:evidence}}});
    }else for(const d of same)ops.push({op:'node',value:{id:d.id,state:'done',refs:[...d.refs,id]}});
    const idx=index(model);
    const pending=related(idx,ch.requirement,'deviation').some(d=>d.state!=='done'&&!same.includes(d))||
      ch.requests.some(r=>r.id!==ch.request?.id&&r.state!=='done')||
      related(idx,ch.requirement,'proposal').some(p=>p.id!==ch.proposal.id&&(p.state!=='done'||
        !related(idx,p,'installation').some(n=>n.refs?.includes(ch.requirement.id)&&n.attrs?.verification==='passed')));
    ops.push({op:'node',value:{id:ch.requirement.id,state:failed||pending?'review':'done'}});
    return M.patch(model,ops);
  }
  function portfolio(model,filters,today){
    const rows=[];
    for(const r of model.nodes.filter(n=>n.kind==='requirement')){
      const ch=chain(model,r.id),owner=r.attrs?.owner||'',due=r.attrs?.due||'';
      const overdue=!!due&&due<today&&ch.stage!=='done'&&ch.stage!=='declined';
      if(filters.stage&&filters.stage!==ch.stage||filters.owner&&filters.owner!==owner||filters.overdue&&!overdue)continue;
      rows.push({id:r.id,name:r.name,stage:ch.stage,owner,due,overdue});
    }
    return rows;
  }
  function trace(ch){
    const nodes=[ch.requirement,ch.request,ch.proposal,...ch.decisions,...ch.tasks,...ch.observations,...ch.findings].filter(Boolean);
    return '# '+ch.requirement.name+'\n\nЭтап · '+stages[ch.stage]+'\n\n'+nodes.map(n=>'## '+n.id+' · '+n.name+'\n\n'+n.note+'\n\n'+
      Object.entries(n.attrs||{}).map(([k,v])=>'- '+k+' · '+v).join('\n')+(n.release?'\n- Релиз · '+n.release:'')+'\n').join('\n');
  }
  return {stages,index,chain,requirement,decision,task,taskState,checkTasks,apply,observe,portfolio,trace,nextId,fresh};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Changes!=='undefined'?Changes:require('./changes.js'));
if(typeof module!=='undefined')module.exports=Delivery;
