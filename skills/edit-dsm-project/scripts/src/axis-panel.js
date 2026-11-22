function axisPanel({doc,online,esc,b,option,table,field,modal,push,render,download,openBook,openPair,card,section,tools,act}){
  let selected='',axis='none',at='',busy=false;
  const labels={passed:'Критерий выполнен',failed:'Критерий нарушен',inconclusive:'Недостаточно данных для проверки отказа'};
  const model=()=>doc().history.at(-1).data;
  const fmt=v=>v==null?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:6});
  const value=(id,text)=>'<label>'+esc(text)+' <select id="'+id+'">';
  const runs=(root)=>model().nodes.filter(n=>n.parent===root&&n.attrs?.machineRole==='axisRun');
  const resultTable=(e)=>{const last=e.run.rows.at(-1),v=AxisBench.metrics(e.run,e.config.settings,e.fault);
    return table(['Ось','Команда в конце, мм','Энкодер, мм','Пиковая ошибка, мм'],[0,1,2].map(i=>['XYZ'[i],fmt(last[2+i]),fmt(last[5+i]/e.config.settings.countsPerMm),fmt(v.peaks[i])]));};
  function drawing(c){
    const ids=c.allocated.map(n=>n.id),pos=new Map(ids.map((id,i)=>[id,90+i*175]));
    const nodes=c.allocated.map(n=>'<g><rect x="'+(pos.get(n.id)-68)+'" y="49" width="136" height="45" rx="6"/><text x="'+pos.get(n.id)+'" y="77">'+esc(n.id)+'</text></g>').join('');
    const lines=c.paths.map(([a,b,label],i)=>{
      const forward=i<3,y=forward?49:94,h=forward?20:116+(i-3)*24,x1=pos.get(a),x2=pos.get(b),off=forward?24:-20;
      return '<path d="M'+(x1+off)+' '+y+' V'+h+' H'+(x2-off)+' V'+y+'" marker-end="url(#axisArrow)"><title>'+esc(label)+'</title></path>';
    }).join('');
    return '<svg class="axis-diagram" viewBox="0 0 720 155" role="img" aria-label="Схема команд и обратной связи"><defs><marker id="axisArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="#406c60"/></marker></defs>'+lines+nodes+'</svg>';
  }
  function reviews(entries){
    const ids=new Set(entries.map(n=>n.id));
    return model().nodes.filter(n=>n.attrs?.machineRole==='axisReview'&&n.refs?.some(id=>ids.has(id))&&n.refs.filter(id=>model().nodes.some(x=>x.id===id&&x.attrs?.machineRole==='axisRun')).every(id=>ids.has(id)));
  }
  function dossier(c,entries,base){
    const lines=['# '+c.adr+' · Архитектурная проработка контроля осей','','## Граница и распределение ответственности','',
      'Ревизия конфигурации '+base+' · проект '+doc().project+'.','',...c.allocated.map(n=>'- '+n.id+' · '+n.name+' ('+n.parent+'). '+n.role),'','### Контракт '+c.iface,'',c.contract,'','| Откуда | Куда | Содержимое |','| --- | --- | --- |',...c.paths.map(p=>'| '+p.join(' | ')+' |'),'','## Требование '+c.req,'',c.criterion,'',
      'Допуск '+c.settings.toleranceMm+' мм. Период '+c.settings.periodMs+' мс. Срабатывание после '+c.settings.tripSamples+' тактов сверх допуска. Максимальное время реакции '+c.settings.maxResponseMs+' мс.',
      '','## ADR '+c.adr,'','Выбранное решение. '+c.decision,'','Альтернатива. '+c.alternative,'','Основание. '+c.rationale,'','Последствия. '+c.consequences,'',
      '## План испытаний '+c.plan,'',c.method,'','## Свидетельства SIL','','| Прогон | Режим | Критерий | Реакция, мс | Макс. ошибка XYZ, мм |','| --- | --- | --- | ---: | --- |'];
    const evidence=[];
    for(const n of entries){const e=AxisBench.read(n),v=AxisBench.metrics(e.run,e.config.settings,e.fault);
      lines.push('| '+[n.id,e.fault.axis==='none'?'Штатный':e.fault.axis,labels[v.verdict],v.delay??'—',v.peaks.join(' / ')].join(' | ')+' |');
      evidence.push('- '+n.id+' · '+e.run.engine+' · '+n.attrs.base+' · SHA-256 '+e.run.sha256+' · '+e.run.rows.length+' отсчётов · строка ALARM '+(e.run.alarmLine??'—')+'.');
    }
    return [...lines,'',...evidence,'','## Обзор результатов','',...reviews(entries).map(n=>n.id+' · '+n.attrs.owner+' · '+n.note+' · '+n.refs.join(', ')),'','## Границы приёмки','','Факт — показания программной модели энкодера. Валидация изделия технологом, тормозной путь и динамика привода требуют испытаний на оборудовании.','','## Исходное задание '+c.job,'','~~~~gcode',c.program,'~~~~',''].join('\n');
  }
  function view(root,parts){
    if(!parts.some(n=>n.attrs?.machineRole==='axisPlan'))return section('Настройка испытания','<p>Свяжите задание, планировщик, контроллер и привод. В каталоге появятся требование, ADR и план верификации.</p>'+act('AxisSetup','Подготовить архитектурную проработку'));
    const c=AxisBench.config(model(),root),all=runs(root),sel=all.find(n=>n.id===selected)||all.at(-1);
    const current=all.filter(n=>AxisBench.current(model(),root,n));
    const coverage=['none','X','Y','Z'].map(mode=>{
      const n=current.filter(n=>AxisBench.read(n).fault.axis===mode).at(-1);
      return [mode==='none'?'Штатный':'Энкодер '+mode,n?labels[n.attrs.verdict]:'Ожидает испытания',n?act('AxisSelect',esc(n.id),n.id):'—'];});
    let receipt='';
    if(sel){const e=AxisBench.read(sel),r=e.run,m=AxisBench.metrics(r,e.config.settings,e.fault);
      receipt=section('Протокол испытания',value('axisReceipt','Прогон')+all.toReversed().map(n=>option(n.id,n.id+' · '+n.name,sel.id)).join('')+'</select></label>'+
        '<p class="axis-status">'+esc(labels[m.verdict])+' · '+(AxisBench.current(model(),root,sel)?'Текущая конфигурация':'Архивная конфигурация — повторите испытание')+'</p>'+
        table(['Событие','Время, мс','Что произошло'],[['Приём задания',0,'Контроллер подтвердил SHA-256'],...(r.injected===null?[]:[['Внесение отказа',r.injected,'Зафиксирован отсчёт энкодера '+esc(e.fault.axis)]]),...(r.alarm===null?[]:[['ALARM',r.alarm,'Ось '+esc(r.axis)+' · строка '+r.alarmLine],['HOLD',r.rows.at(-1)[0],'Команды удерживаются по трём осям']]),['Завершение наблюдения',r.rows.at(-1)[0],r.rows.length+' отсчётов']])+
        '<p>Реакция '+fmt(m.delay)+' мс · допустимо '+fmt(e.config.settings.maxResponseMs)+' мс</p>'+resultTable(e)+
        tools([act('AxisNotebook','План и факт в Jupyter',sel.id),act('AxisExportRun','Документ этого прогона',sel.id)])+
        '<details><summary>Происхождение данных и ссылки</summary><p>'+esc(r.engine)+' · '+esc(sel.attrs.base)+'</p><code class="axis-hash">'+esc(r.sha256)+'</code><p>'+sel.refs.map(card).join(' ')+'</p></details>');
    }
    return section('Архитектурная проработка',tools([card(c.req),card(c.adr),card(c.plan),card(c.iface),b('specZip','Пакет OpenSpec','data-id="'+esc(c.proposal)+'"'),act('AxisExport','Скачать досье .md'),act('AxisPrint','Отчёт для печати')])+
      drawing(c)+'<details><summary>Содержание интерфейсов</summary>'+table(['Источник','Получатель','Передаётся'],c.paths.map(([a,z,t])=>[card(a),card(z),esc(t)]))+'</details><div class="axis-layout">'+c.allocated.map(n=>'<div>'+card(n.id)+'<strong>'+esc(n.name)+'</strong><small>'+esc(n.parent)+'</small></div>').join('')+'</div>'+
      '<p>'+esc(c.criterion)+'</p>'+tools([act('AxisCriterion','Изменить критерий'),b('journeySelect','Маршрут требования','data-id="'+esc(c.req)+'"'),...(c.check?[act('AxisDSM','Открыть проверку в DSM')]:[])])+
      '<details id="axisAdr"><summary>ADR · варианты, выбор и последствия</summary>'+
      table(['Часть решения','Содержание'],[['Выбрано',esc(c.decision)],['Альтернатива',esc(c.alternative)],['Основание',esc(c.rationale)],['Последствия',esc(c.consequences)]])+act('AxisEdit','Редактировать ADR')+'</details>')+
      section('Испытание обратной связи','<p>'+esc(c.job)+' · '+esc(parts.find(n=>n.id===c.job).name)+' · '+(online()?'Программный контроллер · отдельный локальный процесс':'Автономный программный контроллер в Web Worker')+'</p>'+
      tools([act('Stage','Открыть задание .nc','job'),value('axisFault','Режим')+[['none','Штатный ход'],['X','Замер энкодера X'],['Y','Замер энкодера Y'],['Z','Замер энкодера Z']].map(([v,l])=>option(v,l,axis)).join('')+'</select></label>',
      ...(axis==='none'?[]:['<label>Внести на такте с момента, мс <input id="axisAt" type="number" min="0" step="1" placeholder="Начало движения оси" value="'+esc(at)+'"></label>']),
      b('machineAxisRun',busy?'Идёт испытание…':'Передать в контроллер и испытать','class="primary" '+(busy?'disabled':''))])+
      '<p>Допуск '+fmt(c.settings.toleranceMm)+' мм · '+c.settings.tripSamples+' такта подряд · реакция до '+c.settings.maxResponseMs+' мс.</p>')+receipt+
      section('Покрытие испытаниями',table(['Проверка','Последнее свидетельство этой конфигурации','Протокол'],coverage)+tools([act('AxisReview','Оформить обзор SIL'),...reviews(current).map(n=>card(n.id))])+'<p>Валидация технологом на оборудовании · ожидает приёмки</p>');
  }
  function bind(){
    const el=id=>document.getElementById(id);
    el('axisFault')?.addEventListener('change',e=>{axis=e.target.value;render();});
    el('axisAt')?.addEventListener('input',e=>{at=e.target.value;});
    el('axisReceipt')?.addEventListener('change',e=>{selected=e.target.value;render();});
  }
  async function runOffline(packet){
    const src='const parse='+Machine.simulate.toString()+'; const execute='+AxisController.execute.toString()+'; onmessage=async e=>{try{const p=e.data;const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(p.program));const sha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");postMessage({...execute(p,parse),sha256,engine:"worker-sil"});}catch(e){postMessage({error:e.message});}}';
    const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'})),worker=new Worker(url);
    let timer;try{return await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Истекло время ответа стенда')),10000);worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data);worker.onerror=()=>reject(Error('Контроллер не запустился'));worker.postMessage(packet);});}
    finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);}
  }
  async function handle(k,id,root,parts){
    const d=doc(),h=d.history.at(-1),m=h.data;
    if(k==='AxisSetup'){
      const choose=(key,title,kind)=>'<label>'+title+' <select name="'+key+'">'+parts.filter(n=>n.kind===kind&&(key!=='job'||n.attrs?.machineRole==='job')).map(n=>option(n.id,n.id+' · '+n.name,'')).join('')+'</select></label>';
      modal('Настройка архитектурной проработки',choose('job','Задание','artifact')+choose('client','Клиентское ПО','module')+choose('planner','Планировщик','module')+choose('controller','Контроллер','component')+choose('drive','Привод','component'),
        f=>push(AxisBench.setup(m,root,f),'Создание требования, ADR и плана испытаний','Системный инженер',h.rev));return;
    }
    if(k==='AxisSelect'){selected=id;render();return;}
    const c=AxisBench.config(m,root);
    if(k==='AxisReview'){
      modal('Обзор результатов испытаний',field('owner','Ответственный за обзор','Системный инженер','required')+'<label class="field">Вывод и оставшиеся вопросы<textarea name="conclusion" rows="4" required></textarea></label>',f=>push(AxisBench.review(m,root,f.owner,f.conclusion),'Обзор свидетельств SIL',f.owner,h.rev));return;
    }
    if(k==='AxisDSM'){if(c.check)openPair('risk',c.check.from,c.check.to);return;}
    if(k==='AxisEdit'||k==='AxisCriterion'){
      const adr=k==='AxisEdit',n=parts.find(n=>n.id===(adr?c.adr:c.req));
      const fields=adr?[['note','Выбранное решение'],['alternative','Альтернатива'],['rationale','Почему выбран этот вариант'],['consequences','Последствия']]:[['note','Требование'],['toleranceMm','Допуск, мм'],['tripSamples','Тактов сверх допуска'],['maxResponseMs','Предельная реакция, мс']];
      modal(adr?'Редакция ADR':'Редакция критерия',fields.map(([key,title])=>'<label class="field">'+title+(adr||key==='note'?'<textarea name="'+key+'" rows="3" required>'+esc(key==='note'?n.note:n.attrs[key])+'</textarea>':'<input type="number" min="0.000001" step="any" name="'+key+'" value="'+n.attrs[key]+'" required>')+'</label>').join(''),f=>{
        const attrs={...n.attrs};for(const [key] of fields.slice(1))attrs[key]=adr?f[key].trim():Number(f[key]);
        const next=DSM.patch(m,[{op:'node',value:{id:n.id,note:f.note.trim(),attrs}}]);AxisBench.config(next,root);
        return push(next,'Редакция '+n.id,'Системный инженер',h.rev);
      });return;
    }
    if(k==='AxisNotebook'){openBook(root,{axisRun:id});return;}
    if(k==='AxisPrint'){
      const evidence=runs(root).filter(n=>AxisBench.current(m,root,n));
      const p=t=>'<p>'+esc(t)+'</p>';
      const results=table(['Прогон','Режим','Результат','Реакция, мс','Пики XYZ, мм'],evidence.map(n=>{const e=AxisBench.read(n),x=AxisBench.metrics(e.run,e.config.settings,e.fault);return [esc(n.id),e.fault.axis==='none'?'Штатный':esc(e.fault.axis),labels[x.verdict],fmt(x.delay),x.peaks.map(fmt).join(' / ')];}));
      const layout='<h1>Контроль обратной связи осей</h1>'+p(m.title)+'<h2>Граница и распределение ответственности</h2>'+drawing(c)+table(['Компонент','Назначение'],c.allocated.map(n=>[esc(n.id)+' · '+esc(n.name),esc(n.role)]))+'<h2>Интерфейс '+esc(c.iface)+'</h2>'+p(c.contract)+table(['Источник','Получатель','Содержание'],c.paths.map(row=>row.map(esc)));
      const decision='<h2>Требование '+esc(c.req)+'</h2>'+p(c.criterion)+table(['Допуск, мм','Период, мс','Тактов на обнаружение','Предел реакции, мс'],[[c.settings.toleranceMm,c.settings.periodMs,c.settings.tripSamples,c.settings.maxResponseMs]])+'<h2>Архитектурное решение '+esc(c.adr)+'</h2>'+table(['Часть ADR','Содержание'],[['Выбор',esc(c.decision)],['Альтернатива',esc(c.alternative)],['Основание',esc(c.rationale)],['Последствия',esc(c.consequences)]])+'<h2>План испытаний '+esc(c.plan)+'</h2>'+p(c.method)+'<h3>Исходное задание '+esc(c.job)+'</h3><pre>'+esc(c.program)+'</pre>';
      const proof='<h2>Свидетельства SIL</h2>'+results+
        evidence.map(n=>{const e=AxisBench.read(n);return '<h3>'+esc(n.id)+' · '+esc(n.name)+'</h3>'+p(e.run.engine+' · '+e.run.rows.length+' отсчётов · исходная версия '+n.attrs.base)+'<small>SHA-256 '+esc(e.run.sha256)+'</small>';}).join('')+
        '<h2>Обзор результатов</h2>'+(reviews(evidence).map(n=>p(n.id+' · '+n.attrs.owner+' · '+n.note)).join('')||p('Ожидает документированного обзора инженером.'))+'<h2>Граница приёмки</h2>'+p('Факт — координаты модели энкодера. Для приёмки требуются испытания технологом, проверка динамики привода и измерение физического тормозного пути.');
      const css='@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:15px/1.45 system-ui;max-width:850px;margin:2rem auto;padding:0 1rem;color:#153b33}h1{font-size:32px}h2{font-size:22px;margin:1.3rem 0 .55rem}h3{font-size:16px;margin:.95rem 0 .25rem}p{margin:.4rem 0}small,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;padding:.6rem;background:#f0f5f1}th,td{padding:.45rem;text-align:left;border-bottom:1px solid #c2d3cb;vertical-align:top}th{background:#eaf2ed}table{border-collapse:collapse;width:100%}.axis-diagram{width:100%}.axis-diagram path{fill:none;stroke:#406c60;stroke-width:2}.axis-diagram rect{fill:#e6f2ed;stroke:#406c60}.axis-diagram text{text-anchor:middle;fill:#174d3c}footer{margin-top:1.2rem;font:11px monospace;overflow-wrap:anywhere;color:#465c55}@media print{body{margin:0;max-width:none;padding:0;font-size:11pt}button{display:none}article+article{break-before:page}h2,h3{break-after:avoid}tr,svg{break-inside:avoid}}';
      const stamp='<footer>'+esc(d.project)+' · '+esc(h.rev)+'</footer>';
      const html='<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Архитектурная проработка '+esc(c.adr)+'</title><style>'+css+'</style></head><body><button onclick="window.print()">Печать / PDF</button>'+[layout,decision,proof].map(s=>'<article>'+s+stamp+'</article>').join('')+'</body></html>';
      download(root+'-architecture.html',html,'text/html');return;
    }
    if(k==='AxisExport'||k==='AxisExportRun'){
      const all=runs(root),n=all.find(n=>n.id===id),single=k==='AxisExportRun';
      download((single?id:root+'-architecture')+'.md',dossier(single?AxisBench.read(n).config:c,single?[n]:all.filter(n=>AxisBench.current(m,root,n)),single?n.attrs.base:h.rev),'text/markdown');return;
    }
    if(k==='AxisRun'){
      if(busy)return;
      const fault={axis,atMs:axis==='none'||at===''?null:Number(at)};
      busy=true;render();
      try{
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.program));
        const sha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        let run;
        if(online()){
          const res=await fetch('/api/axis-bench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:d.project,base:h.rev,root,fault,sha256})});
          run=await res.json();if(!res.ok)throw Error(run.error||'Стенд недоступен');
        }else run=await runOffline({program:c.program,limits:c.limits,settings:c.settings,fault});
        if(run.sha256!==sha256)throw Error('Получено подтверждение другого задания');
        const next=AxisBench.add(d,root,h.rev,fault,run);
        await push(next,'Стенд SIL · '+c.job+' · '+(axis==='none'?'штатный ход':fault.axis),'Инженер испытаний',h.rev);
        selected=next.nodes.at(-1).id;
      }finally{busy=false;render();}
    }
  }
  return {view,bind,handle,reset(){selected='';axis='none';at='';}};
}
