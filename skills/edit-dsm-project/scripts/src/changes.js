const Changes=((M)=>{
  const priorities=['low','normal','high','critical'];
  function text(value,label){
    if(typeof value!=='string'||!value.trim())throw Error('Заполните поле «'+label+'»');
    return value.trim();
  }
  function request(model,f){
    if(model.nodes.some(n=>n.id===f.id))throw Error('ID запроса уже занят');
    if(!priorities.includes(f.priority))throw Error('Неизвестный приоритет');
    return M.patch(model,[{op:'node',value:{kind:'request',state:'idea',id:f.id,name:text(f.name,'Название'),note:text(f.problem,'Проблема'),refs:f.refs||[],
      attrs:{requester:text(f.requester,'Инициатор'),outcome:text(f.outcome,'Ожидаемый результат'),acceptance:text(f.acceptance,'Приёмка'),priority:f.priority,owner:(f.owner||'').trim()}}}]);
  }
  function get(model,id,kind){
    const n=model.nodes.find(n=>n.id===id&&n.kind===kind);
    if(!n)throw Error('Не найдена карточка '+id);
    return n;
  }
  function review(model,id,outcome,reviewer,reason){
    const n=get(model,id,'request');
    const states={accepted:'planned',deferred:'blocked',declined:'done'};
    if(!Object.hasOwn(states,outcome))throw Error('Выберите решение');
    if(model.nodes.some(p=>p.kind==='proposal'&&p.refs?.includes(id)))throw Error('По запросу уже создано предложение');
    return M.patch(model,[{op:'node',value:{id,state:states[outcome],attrs:{...n.attrs,disposition:outcome,reviewer:text(reviewer,'Рецензент'),rationale:text(reason,'Обоснование')}}}]);
  }
  function promote(model,id,newId){
    const req=get(model,id,'request');
    if(req.attrs?.disposition!=='accepted')throw Error('Сначала примите запрос на разборе');
    if(model.nodes.some(n=>n.id===newId||n.kind==='proposal'&&n.refs?.includes(id)))throw Error('Предложение уже существует или ID занят');
    const refs=[id,...(req.refs||[])];
    const note='## Why\n\n'+req.note+'\n\n## What Changes\n\n'+req.attrs.outcome+'\n\n## Capabilities\n\n'+req.attrs.acceptance+'\n\n## Impact\n\n'+(req.refs||[]).join(', ');
    return M.patch(model,[{op:'node',value:{id,state:'active'}},{op:'node',value:{id:newId,kind:'proposal',name:req.name,state:'planned',refs,note}}]);
  }
  function task(model,proposal,id,name,owner){
    if(get(model,proposal,'proposal').state==='done')throw Error('Предложение завершено');
    if(model.nodes.some(n=>n.id===id))throw Error('ID задачи уже занят');
    return M.patch(model,[{op:'node',value:{id,name:text(name,'Задача'),kind:'changeTask',parent:proposal,state:'planned',attrs:{owner:(owner||'').trim()}}}]);
  }
  function timeline(doc,id){
    const entries=[];let previous=null;
    for(const h of doc.history){
      const n=h.data.nodes.find(n=>n.id===id);
      if(n||previous){
        const keys=new Set([...Object.keys(previous||{}),...Object.keys(n||{})]);
        const fields=[...keys].filter(k=>JSON.stringify(previous?.[k])!==JSON.stringify(n?.[k]));
        if(fields.length)entries.push({rev:h.rev,at:h.at,actor:h.actor,note:h.note,fields,before:previous||null,after:n||null});
      }
      previous=n;
    }
    return entries;
  }
  function brief(model,id){
    const req=get(model,id,'request'),attrs=req.attrs||{};
    const linked=model.nodes.filter(n=>req.refs?.includes(n.id)||n.refs?.includes(id));
    return '# '+req.name+'\n\n'+req.id+' · '+req.state+'\n\n'+[
      ['Проблема',req.note],['Ожидаемый результат',attrs.outcome],['Условия приёмки',attrs.acceptance],
      ['Инициатор',attrs.requester],['Ответственный',attrs.owner],['Приоритет',attrs.priority],
      ['Решение разбора',[attrs.disposition,attrs.reviewer,attrs.rationale].filter(Boolean).join(' · ')],
      ['Связанные карточки',linked.map(n=>'- '+n.id+' · '+n.name).join('\n')]
    ].map(([title,body])=>'## '+title+'\n\n'+(body||'—')).join('\n\n')+'\n';
  }
  function changeLog(doc,from,to){
    const first=doc.history.findIndex(h=>h.rev===from),last=doc.history.findIndex(h=>h.rev===to);
    if(first<0||last<first)throw Error('Конечная версия должна следовать за исходной');
    const sections=doc.history.slice(first+1,last+1).map((h,i)=>{
      const changes=M.diff(doc.history[first+i].data,h.data);
      return '## '+h.note+'\n\n'+h.rev+' · '+h.at+' · '+h.actor+'\n\n'+(changes.length?changes.map(d=>'- '+(d.before===null?'Добавлено':d.after===null?'Удалено':'Изменено')+' · '+d.type+' · '+d.key).join('\n'):'Именованный снимок');
    });
    return '# Журнал изменений\n\n'+from+' → '+to+'\n\n'+(sections.join('\n\n')||'Одна версия, изменений нет.')+'\n';
  }
  function completeProposal(model,id){
    const proposal=get(model,id,'proposal'),tasks=model.nodes.filter(n=>n.kind==='changeTask'&&n.parent===id);
    if(tasks.some(t=>t.state!=='done'))throw Error('Остались открытые задачи предложения');
    const ops=[{op:'node',value:{id,state:'done'}}];
    for(const r of model.nodes.filter(n=>n.kind==='request'&&proposal.refs?.includes(n.id))){
      if(!model.nodes.some(p=>p.kind==='proposal'&&p.id!==id&&p.state!=='done'&&p.refs?.includes(r.id)))ops.push({op:'node',value:{id:r.id,state:'done'}});
    }
    return M.patch(model,ops);
  }
  return {completeProposal,priorities,request,review,promote,task,timeline,brief,changeLog};
})(typeof DSM!=='undefined'?DSM:require('./model.js'));
if(typeof module!=='undefined')module.exports=Changes;
