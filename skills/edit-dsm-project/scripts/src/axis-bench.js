const AxisBench=((M,machine)=>{
  const roles={job:'job',req:'axisAcceptance',adr:'axisDecision',plan:'axisPlan'};
  function config(model,root){
    const parts=machine.parts(model,root);
    const find=(role,kind)=>{const list=parts.filter(n=>n.attrs?.machineRole===role&&n.kind===kind);
      if(list.length!==1)throw Error('Для стенда нужна одна карточка роли '+role);return list[0];};
    const job=find(roles.job,'artifact'),req=find(roles.req,'requirement'),adr=find(roles.adr,'adr'),plan=find(roles.plan,'artifact');
    if(!adr.refs?.includes(req.id)||![job.id,req.id,adr.id].every(id=>plan.refs?.includes(id)))throw Error('Проверьте ссылки плана испытаний на задание, требование и ADR');
    const number=(key,min,max,whole=false)=>{const v=req.attrs[key];if(!Number.isFinite(v)||v<min||v>max||(whole&&!Number.isInteger(v)))throw Error('Проверьте параметр '+key);return v;};
    const settings={periodMs:number('periodMs',1,1000,true),countsPerMm:number('countsPerMm',1,100000,true),rapidMmMin:number('rapidMmMin',1,100000),
      toleranceMm:number('toleranceMm',0.000001,1000),tripSamples:number('tripSamples',1,100,true),maxResponseMs:number('maxResponseMs',1,60000,true)};
    const allocated=plan.refs.map(id=>model.nodes.find(n=>n.id===id)).filter(n=>['system','component','module'].includes(n.kind)).map(n=>({id:n.id,name:n.name,parent:n.parent,role:n.note}));
    const {client,planner,controller,drive,iface}=plan.attrs;
    if(![client,planner,controller,drive,iface].every(id=>plan.refs.includes(id)))throw Error('Распределите участников и интерфейс в плане испытаний');
    const contract=parts.find(n=>n.id===iface);
    if(!contract||![client,planner,controller,drive].every(id=>contract.refs?.includes(id)))throw Error('Уточните участников контракта обратной связи');
    const paths=[[client,planner,'Программа NC'],[planner,controller,'Уставки XYZ, мм'],[controller,drive,'Команда положения'],[drive,controller,'Отсчёты энкодеров'],[controller,client,'SHA-256, телеметрия и ALARM']];
    const risk=model.edges.find(e=>M.ek(e)===M.ek({from:controller,to:drive,layer:'risk'}));
    return {root,proposal:plan.attrs.proposal,check:risk?{from:risk.from,to:risk.to,reason:risk.reason,weight:risk.weight}:null,iface,contract:contract.note,paths,job:job.id,program:job.note,limits:machine.envelope(model,root),req:req.id,criterion:req.note,adr:adr.id,decision:adr.note,
      rationale:adr.attrs.rationale,alternative:adr.attrs.alternative,consequences:adr.attrs.consequences,plan:plan.id,method:plan.note,allocated,settings};
  }
  function setup(model,root,{job,client,planner,drive,controller}){
    const parts=machine.parts(model,root),role=k=>parts.some(n=>n.attrs?.machineRole===k);
    if([roles.req,roles.adr,roles.plan].some(role))throw Error('Конфигурация испытания уже существует. Откройте её карточки.');
    const get=(id,kind)=>parts.find(n=>n.id===id&&n.kind===kind);
    if(!get(job,'artifact')||get(job,'artifact').attrs?.machineRole!=='job'||!get(client,'module')||client===planner||!get(planner,'module')||!get(drive,'component')||!get(controller,'component')||drive===controller)throw Error('Выберите задание, клиентский модуль, планировщик, привод и отдельный контроллер этого изделия');
    const fresh=stem=>{if(!model.nodes.some(n=>n.id===stem))return stem;let i=2;while(model.nodes.some(n=>n.id===stem+'-'+i))i++;return stem+'-'+i;};
    const req=fresh('REQ-AXIS'),adr=fresh('ADR-HOLD'),plan=fresh('TEST-AXIS'),iface=fresh('IF-AXIS'),proposal=fresh('axis-feedback-pilot'),request=fresh('CR-AXIS'),release=fresh('REL-AXIS');
    const cards=[
      {id:req,kind:'requirement',name:'Контроль обратной связи осей',note:'В штатном режиме измеренное положение каждой оси должно находиться в допуске. При замере энкодера движущейся оси контроллер должен зафиксировать превышение и удержать все три команды в пределах заданного времени реакции.',attrs:{machineRole:roles.req,when:'При штатном ходе и замере показания движущейся оси',then:'Телеметрия подтверждает допуск в штатном режиме и удержание трёх команд в пределах лимита реакции при внесённом отказе.',periodMs:20,countsPerMm:100,rapidMmMin:1200,toleranceMm:0.2,tripSamples:2,maxResponseMs:80},refs:[planner,drive,controller]},
      {id:adr,kind:'adr',name:'Где обнаруживать потерю обратной связи',state:'done',refs:[req,proposal,planner,drive,controller],note:'Контроллер сравнивает команду с показаниями энкодера каждый такт. При устойчивом превышении допуска он фиксирует ALARM и удерживает все три команды.',
        attrs:{machineRole:roles.adr,alternative:'Обнаруживать расхождение в клиентском ПО и отправлять команду останова.',rationale:'Контроллер располагает командой и обратной связью в одном такте. Реакция не зависит от доступности клиентского ПК.',consequences:'Нужны калибровка энкодера и подбор допуска. Малый допуск повышает риск ложного останова. Физический тормозной путь измеряется на оборудовании.'}},
      {id:iface,kind:'artifact',name:'Команда осей и обратная связь',refs:[client,planner,controller,drive,req,adr],attrs:{machineRole:'interface',boundary:'internal'},note:'Клиент передаёт задание UTF-8. Контроллер подтверждает SHA-256, записывает уставки XYZ в мм, показания энкодеров в отсчётах и событие ALARM с номером строки NC.'},
      {id:request,kind:'request',name:'Обнаруживать замер энкодера на станке',state:'done',refs:[req],attrs:{disposition:'accepted',requester:'Технолог',owner:'Системный инженер'}},
      {id:proposal,kind:'proposal',name:'Верификация останова по обратной связи',state:'active',refs:[req,request,iface],note:'## Why\n\nТехнологу требуется распознавать потерю обратной связи.\n\n## What Changes\n\nПроверять замер энкодера в контроллере. Версионировать протокол, требование и ADR.\n\n## Capabilities\n\n- axis-feedback\n\n## Impact\n\nКлиент, контроллер, привод и процедура приёмки.'},
      {id:release,kind:'release',name:'Пилот контроля обратной связи',capacity:4},
      {id:fresh('TASK-SIL'),kind:'changeTask',parent:proposal,release,effort:2,state:'planned',name:'Рассмотреть протоколы SIL и заключение Jupyter',refs:[plan,req,adr],attrs:{owner:'Инженер испытаний'}},
      {id:fresh('TASK-ACCEPT'),kind:'changeTask',parent:proposal,release,effort:2,state:'planned',name:'Подтвердить приёмку изделия технологом',refs:[req,adr],attrs:{owner:'Технолог'}},
      {id:plan,kind:'artifact',name:'План верификации обратной связи',refs:[req,adr,job,client,planner,controller,drive,iface,proposal],attrs:{proposal,machineRole:roles.plan,client,planner,controller,drive,iface},note:'Один исходный файл. Штатный прогон проверяет точность по XYZ и завершение программы. Во втором прогоне фиксируется отсчёт выбранного энкодера. Проверить время реакции, номер оси и удержание команды. Валидация технологом изделия остаётся отдельной работой.'}
    ].map(n=>({op:'node',value:{parent:root,...n}}));
    const related=get(controller,'component');
    cards.push({op:'node',value:{id:controller,relations:[...(related.relations||[]),['realizes',req]]}});
    const contracts=[[client,planner,'flow','Загрузка исходной программы'],[planner,controller,'flow','Передача уставок XYZ'],[controller,drive,'flow','Задание положения и чтение энкодера'],[client,controller,'flow','Квитанция и протокол испытания'],[controller,drive,'risk','Совместная проверка замера энкодера и удержания команд']];
    for(const [from,to,layer,reason] of contracts){
      const value={from,to,layer,reason,weight:layer==='risk'?3:2};
      if(!model.edges.some(e=>M.ek(e)===M.ek(value)))cards.push({op:'edge',value});
    }
    return M.patch(model,cards);
  }
  function metrics(run,settings,fault){
    const {rows,alarm,injected}=run;
    if(!rows.length||rows.length>8003||rows.some((r,i)=>!Array.isArray(r)||r.length!==9||r[0]!==i*settings.periodMs||!Number.isInteger(r[1])||r.slice(2,8).some(v=>!Number.isFinite(v))||r.slice(5,8).some(v=>!Number.isInteger(v))||!['RUN','ALARM','HOLD'].includes(r[8])))throw Error('Неверные строки телеметрии SIL');
    const faultIndex=['X','Y','Z'].indexOf(fault.axis);
    const first=rows.findIndex(r=>r[0]===injected);
    const excited=first>0&&rows.slice(first).some(r=>r[2+faultIndex]!==rows[first-1][2+faultIndex]);
    const peaks=[0,0,0],streak=[0,0,0];let hold=0,steady=true,expectedAlarm=null,expectedAxis=null;
    const trigger=rows.find(r=>r[8]==='ALARM');
    for(const r of rows){
      for(let i=0;i<3;i++){
        const err=Math.abs(r[2+i]-r[5+i]/settings.countsPerMm);
        peaks[i]=Math.max(peaks[i],err);streak[i]=err>settings.toleranceMm+1e-9?streak[i]+1:0;
        if(expectedAlarm===null&&streak[i]>=settings.tripSamples){expectedAlarm=r[0];expectedAxis='XYZ'[i];}
      }
      if(r[8]==='HOLD'){hold++;if(!trigger||r.slice(2,5).some((v,i)=>v!==trigger[i+2]))steady=false;}
    }
    if(alarm!==(trigger?.[0]??null)||alarm!==expectedAlarm||run.axis!==expectedAxis||rows.some(r=>r[8]!==((alarm===null||r[0]<alarm)?'RUN':r[0]===alarm?'ALARM':'HOLD')))throw Error('События контроллера расходятся с телеметрией');
    if(first>0&&faultIndex>=0&&rows.slice(first).some(r=>r[faultIndex+5]!==rows[first-1][faultIndex+5]))throw Error('Обратная связь выбранной оси не зафиксирована');
    const delay=alarm!==null&&injected!==null?alarm-injected:null;
    let verdict;
    if(fault.axis==='none')verdict=alarm===null&&peaks.every(v=>v<=settings.toleranceMm+1e-9)?'passed':'failed';
    else if(injected===null||!excited)verdict='inconclusive';
    else verdict=alarm!==null&&run.axis===fault.axis&&delay>=0&&delay<=settings.maxResponseMs&&steady&&hold>=2?'passed':'failed';
    return {peaks:peaks.map(v=>Math.round(v*1e6)/1e6),delay,hold,verdict};
  }
  function add(doc,root,base,fault,run){
    const h=M.head(doc);if(h.rev!==base)throw Error('Конфликт версии стенда');
    const c=config(h.data,root),summary=metrics(run,c.settings,fault);
    let i=1;while(h.data.nodes.some(n=>n.id==='AXRUN-'+i))i++;
    const id='AXRUN-'+i,refs=[c.job,c.req,c.adr,c.plan,c.iface,...c.allocated.map(n=>n.id)];
    return M.patch(h.data,[{op:'node',value:{id,parent:root,kind:'artifact',name:fault.axis==='none'?'Штатный прогон XYZ':'Замер энкодера '+fault.axis,state:'done',
      attrs:{machineRole:'axisRun',base,sha256:run.sha256,verdict:summary.verdict,packet:JSON.stringify({config:c,fault,run})},refs,relations:[[summary.verdict==='passed'?'verifies':'uses',c.req]],
      note:'Программный стенд SIL · '+run.engine+' · '+run.rows.length+' отсчётов.'}}]);
  }
  function read(node){if(node?.attrs?.machineRole!=='axisRun')throw Error('Выберите протокол стенда');return JSON.parse(node.attrs.packet);}
  function current(model,root,node){try{return JSON.stringify(config(model,root))===JSON.stringify(read(node).config);}catch{return false;}}
  function record(doc,input){
    const h=M.head(doc);if(doc.project!==input.project||h.rev!==input.base)throw Error('Конфликт версии расчёта осей');
    const node=h.data.nodes.find(n=>n.id===input.runId),e=read(node),m=metrics(e.run,e.config.settings,e.fault);
    if(input.sha256!==e.run.sha256||JSON.stringify([m.peaks,m.delay,m.hold,m.verdict])!==JSON.stringify(input.values))throw Error('Результат Python расходится с протоколом');
    if(h.data.nodes.some(n=>n.attrs?.machineRole==='axisAnalysis'&&n.refs?.includes(node.id)))throw Error('Для этого прогона заключение уже зарегистрировано');
    let i=1;while(h.data.nodes.some(n=>n.id==='AXREPORT-'+i))i++;
    return M.patch(h.data,[{op:'node',value:{id:'AXREPORT-'+i,parent:node.parent,kind:'artifact',name:'Заключение Jupyter · '+node.id,state:'done',refs:[node.id,e.config.req,e.config.adr,e.config.plan],
      attrs:{machineRole:'axisAnalysis',sha256:input.sha256,base:input.base,verdict:m.verdict},note:'Пиковые ошибки X/Y/Z, мм: '+m.peaks.join(' / ')+'. Тактов удержания: '+m.hold+'.'}}]);
  }
  function review(model,root,owner,conclusion){
    if(!owner?.trim()||!conclusion?.trim())throw Error('Укажите ответственного и вывод обзора');
    const c=config(model,root),all=machine.parts(model,root);
    const runs=all.filter(n=>n.attrs?.machineRole==='axisRun'&&current(model,root,n));
    const chosen=['none','X','Y','Z'].map(axis=>runs.filter(n=>read(n).fault.axis===axis).at(-1));
    if(chosen.some(n=>n?.attrs.verdict!=='passed'))throw Error('Для обзора нужны четыре успешных прогона текущей конфигурации');
    const ids=chosen.map(n=>n.id),report=all.filter(n=>n.attrs?.machineRole==='axisAnalysis'&&ids.some(id=>n.refs?.includes(id))).at(-1);
    if(!report)throw Error('Верните заключение Jupyter по одному из выбранных прогонов');
    if(all.some(n=>n.attrs?.machineRole==='axisReview'&&[...ids,report.id].every(id=>n.refs.includes(id))))throw Error('Этот набор свидетельств уже рассмотрен');
    const task=all.find(n=>n.parent===c.proposal&&n.kind==='changeTask'&&n.refs?.includes(c.plan));
    let i=1;while(model.nodes.some(n=>n.id==='AXREVIEW-'+i))i++;
    const refs=[c.req,c.adr,c.plan,c.proposal,...ids,report.id,...(task?[task.id]:[])];
    const review={id:'AXREVIEW-'+i,parent:root,kind:'artifact',name:'Обзор результатов SIL',note:conclusion.trim(),state:'done',refs,attrs:{machineRole:'axisReview',owner:owner.trim()}};
    const ops=[{op:'node',value:review}];if(task)ops.push({op:'node',value:{id:task.id,state:'done'}});
    return M.patch(model,ops);
  }
  return {config,setup,metrics,add,read,current,record,review};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Machine!=='undefined'?Machine:require('./machine.js'));
if(typeof module!=='undefined')module.exports=AxisBench;
