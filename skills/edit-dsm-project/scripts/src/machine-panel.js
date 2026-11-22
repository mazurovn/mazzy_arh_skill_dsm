function machinePanel({doc,online,esc,b,option,table,field,modal,push,render,toast,download,openBook,openPair,openGraph}){
  const model=()=>DSM.head(doc()).data;
  const stages={design:'Изделие',interfaces:'Интерфейсы и матрицы',job:'Задание ЧПУ',bench:'Испытания и ADR',capture:'Диагностика'};
  let project='',root='',stage='design',layer='flow',ordered=false,draft=null,jobResult=null,trace=null;
  const card=(id)=>b('objectRow',esc(id),'class="tiny" data-id="'+esc(id)+'"');
  const act=(k,label,id='')=>b('machine'+k,label,'data-id="'+esc(id)+'"');
  const section=(title,body)=>'<section class="card"><h2>'+title+'</h2>'+body+'</section>';
  const tools=items=>'<div class="tools">'+items.join('')+'</div>';
  const fmt=n=>n.toLocaleString('ru-RU');
  const bench=axisPanel({doc,online,esc,b,option,table,field,modal,push,render,download,openBook,openPair,card,section,tools,act});
  function reset(){bench.reset();draft=null;jobResult=null;trace=null;}
  function current(){
    const all=Machine.products(model());
    if(project!==doc().project||!all.some(n=>n.id===root)){project=doc().project;root=all[0]?.id||'';stage='design';reset();}
    return all;
  }
  function design(parts){
    const groups=parts.filter(n=>n.kind==='system'),decisions=parts.filter(n=>n.kind==='adr');
    return section('Работа над изделием',tools([act('Stage','1. Проверить задание','job'),act('Stage','2. Решение и испытание','bench'),act('Stage','3. Проверить диагностику','capture')]))+section('Состав изделия',tools([act('Graph','Компонентная схема','component'),act('Graph','Программная архитектура','software')])+table(['Подсистема','Компоненты и модули','Назначение'],groups.map(g=>[card(g.id)+' '+esc(g.name),parts.filter(n=>n.parent===g.id).map(n=>card(n.id)+' '+esc(n.name)).join('<br>'),esc(g.note)])))+
      section('Требования и решения',table(['Карточка','Назначение','Связи'],[...parts.filter(n=>n.kind==='requirement'),...decisions].map(n=>[card(n.id)+' '+esc(n.name),esc(n.note),(n.refs||[]).map(card).join(' ')])))+
      section('Пилотный релиз',table(['Работа','Исполнитель','Релиз','Этап'],parts.filter(n=>n.kind==='changeTask').map(n=>[card(n.id)+' '+esc(n.name),esc(n.attrs?.owner),card(n.release),esc(({done:'Готово',planned:'Запланировано',active:'В работе'})[n.state]||n.state)]))+tools([b('tab','Маршрут изменения','data-id="journey"'),b('tab','План релизов','data-id="plan"')]))+
      section('Клиентское задание и запись испытания',tools([act('Stage','Проверить программу','job'),act('Stage','Подобрать память и проверить файл','capture')]));
  }
  function matrix(parts){
    const m=model(),scope=Machine.architecture(m,root),a=Analysis.calculate(scope,layer);
    const order=ordered?a.order:scope.nodes.map(n=>n.id),fns=parts.filter(n=>n.kind==='capability');
    const interfaces=parts.filter(n=>n.attrs?.machineRole==='interface');
    const visible=order.slice(0,32),cells=Analysis.matrix(scope,layer,visible);
    const overflow=visible.length<order.length?'<p>Показаны первые 32 объекта. '+b('tab','Открыть полную матрицу','data-id="matrix"')+'</p>':'';
    return section('Граница изделия и контракты',table(['Интерфейс','Граница','Участники','Условие совместимости'],interfaces.map(n=>[card(n.id)+' '+esc(n.name),n.attrs.boundary==='external'?'Внешняя':'Внутренняя',(n.refs||[]).map(card).join(' '),esc(n.note)])))+
      section('MDM · функции и реализации',table(['Реализация',...fns.map(n=>card(n.id)+' '+esc(n.name))],scope.nodes.filter(n=>n.relations?.some(([k])=>k==='realizes')).map(n=>[card(n.id)+' '+esc(n.name),...fns.map(f=>n.relations.some(([k,to])=>k==='realizes'&&to===f.id)?'●':'—')])))+
      section('DSM · зависимости компонентов',tools([select('machineLayer','Слой',[['flow','Потоки'],['risk','Совместные проверки']],layer),select('machineOrder','Порядок',[['input','Исходный'],['groups','После кластеризации']],ordered?'groups':'input')])+
      '<p>'+order.length+' × '+order.length+' · '+a.links+' связей · взвешенная длина до упорядочивания '+a.cost_before+', после '+a.cost_after+'</p>'+
      overflow+'<div class="machine-matrix">'+table(['Источник / цель',...visible.map(esc)],cells.map((row,i)=>[card(order[i]),...row.map((v,j)=>v?b('machinePair',String(v),'class="tiny" aria-label="'+esc(order[i]+' → '+order[j])+'" data-id="'+esc(order[i])+'" data-to="'+esc(order[j])+'"'):'·')]))+'</div>'+
      table(['Группа','Объекты'],a.groups.map((g,i)=>[i+1,g.map(card).join(' ')]))+
      '<details><summary>Проверка строк без связей в слое</summary>'+scope.nodes.filter(n=>!scope.edges.some(e=>e.layer===layer&&(e.from===n.id||e.to===n.id))).map(n=>card(n.id)).join(' ')+'</details>');
  }
  function select(id,title,rows,value){return '<label>'+title+' <select id="'+id+'">'+rows.map(([v,l])=>option(v,l,value)).join('')+'</select></label>';}
  function plot(moves,limits){
    const points=[moves[0].from,...moves.map(m=>m.to)],scale=Math.min(560/limits[0],230/limits[1]);
    const line=points.map(([x,y])=>(20+x*scale).toFixed(2)+','+(255-y*scale).toFixed(2)).join(' ');
    return '<svg viewBox="0 0 600 280" role="img" aria-label="Траектория программы, проекция XY"><rect x="20" y="'+(255-limits[1]*scale)+'" width="'+limits[0]*scale+'" height="'+limits[1]*scale+'" fill="#eff5f2" stroke="#819a91"/><polyline points="'+line+'" fill="none" stroke="#196b56" stroke-width="2"/><text x="20" y="275">XY · мм</text></svg>';
  }
  function job(parts){
    const source=parts.find(n=>n.attrs?.machineRole==='job'),limits=Machine.envelope(model(),root);
    const result=jobResult?.base===DSM.head(doc()).rev?jobResult:null;
    return section('Программа технолога','<p>Рабочая зона '+limits.join(' × ')+' мм. Начало симуляции — (0, 0, 0). Поддержаны G21, G90, G0 и G1. Для рабочего хода задайте F в мм/мин.</p>'+
      '<label class="field">Линейная программа<textarea id="machineProgram" spellcheck="false" rows="9">'+esc(draft??source?.note??'')+'</textarea></label>'+
      tools(['<label>Открыть .nc <input id="machineJobFile" type="file" accept=".nc,.txt,.gcode"></label>',act('Run','Проверить траекторию'),act('SaveJob','Сохранить задание'),act('ToBench','К решению и испытанию')]))+
      (result?section('Результат симуляции','<p>'+result.moves.length+' перемещений · '+fmt(Math.round(result.length*100)/100)+' мм пути</p><div class="machine-plot">'+plot(result.moves,limits)+'</div>'+table(['Строка','Тип','Конец XYZ, мм','Подача, мм/мин'],result.moves.slice(0,200).map(r=>[r.line,r.rapid?'Быстрый ход':'Рабочий ход',r.to.join(' · '),r.feed??'—']))+(result.moves.length>200?'<p>Показаны первые 200 перемещений.</p>':'')):'');
  }
  function waveform(values){
    if(!values.length)return '';
    const low=Math.min(...values),high=Math.max(...values),span=high-low||1;
    const line=values.map((v,i)=>(10+540*i/Math.max(1,values.length-1)).toFixed(2)+','+(90-80*(v-low)/span).toFixed(2)).join(' ');
    return '<figure><svg viewBox="0 0 560 100" role="img" aria-label="Осциллограмма первого канала"><polyline points="'+line+'" fill="none" stroke="#196b56" stroke-width="2"/></svg><figcaption>Первый поток, канал 1 · '+values.length+' отсчётов · диапазон кодов '+low+'…'+high+'</figcaption></figure>';
  }
  function capture(parts){
    const m=model(),r=Machine.calculate(m,root),currentTrace=trace?.base===DSM.head(doc()).rev?trace:null;
    return section('Запись вибрации при отключённом клиенте','<div class="sizing-metrics">'+[[r.duration+' с','Окно записи'],[fmt(r.bytes),'Требуется, байт'],[esc(r.selected||'Нет варианта'),'Минимальная ёмкость']].map(([v,l])=>'<div><strong>'+v+'</strong><span>'+l+'</span></div>').join('')+'</div>'+
      tools([act('Duration','Изменить окно записи'),act('Notebook','Пересчитать в Jupyter'),card(r.requirement),card(r.format)])+
      table(['Датчик','Количество','Отсчётов на каждый','Блоков на каждый','Всего байт'],r.streams.map(s=>[card(s.id),s.count,fmt(s.samples),fmt(s.blocks),fmt(s.total)]))+
      table(['Вариант памяти','Номинал, байт','После резерва '+r.reserve+'%, байт','Остаток, байт'],r.options.map(o=>[card(o.id),fmt(o.capacity),fmt(o.usable),fmt(o.margin)])))+
      section('Приём файла клиентским ПО','<p>Декодер VIB1 проверяет CRC, последовательность блоков, время и число отсчётов каждого потока.</p>'+tools([act('ExportTrace','Скачать тестовый VIB1'),'<label>Проверить запись <input id="machineTrace" type="file" accept=".vib,.bin"></label>'])+
      (currentTrace?'<p><b>'+esc(currentTrace.file)+'</b> · '+(currentTrace.complete?'Окно подтверждено':'Неполное окно')+' · '+fmt(currentTrace.bytes)+' байт</p>'+table(['Датчик','Поток','Получено','Ожидалось','Блоков'],currentTrace.streams.map(s=>[card(s.sensor),s.number,s.samples,s.expected,s.blocks]))+waveform(currentTrace.wave)+tools([act('TraceBook','Открыть сигнал в Jupyter'),act('SaveTrace','Сохранить протокол файла')]):''))+
      section('Проверенные файлы',table(['Файл','Окно','SHA-256'],parts.filter(n=>n.attrs?.machineRole==='traceReceipt').map(n=>[card(n.id)+' '+esc(n.name),n.attrs.complete?'Подтверждено':'Неполное',esc(n.attrs.sha256)])))+
      section('Расчёты в истории',table(['Протокол','Исходная ревизия','Память','Источники'],parts.filter(n=>n.attrs?.machineRole==='calculation').map(n=>[card(n.id),esc(n.attrs.base),n.attrs.selected?card(n.attrs.selected):'—',(n.refs||[]).map(card).join(' ')])));
  }
  function view(){
    const all=current();
    if(!all.length)return section('Разработка станка','<p>Откройте проект станка в разделе «Обмен». Для нового изделия задайте карточке продукта атрибут workbench=cnc.</p>'+b('tab','Открыть обмен','data-id="io"'));
    const parts=Machine.parts(model(),root);
    let body;try{body=({design,interfaces:matrix,job,bench:()=>bench.view(root,parts),capture})[stage](parts);}catch(e){body=section('Исходные данные','<p>'+esc(e.message)+'</p>'+b('tab','Каталог','data-id="catalog"'));}
    return '<div class="stack">'+section('Разработка станка',select('machineRoot','Изделие',all.map(n=>[n.id,n.name]),root)+'<nav class="fleet-steps" aria-label="Работа над станком">'+Object.entries(stages).map(([id,name])=>b('machineStage',name,'data-id="'+id+'" aria-pressed="'+(stage===id)+'"')).join('')+'</nav>')+body+'</div>';
  }
  function bind(){
    bench.bind();
    const el=id=>document.getElementById(id);
    el('machineRoot')?.addEventListener('change',e=>{root=e.target.value;reset();render();});
    el('machineLayer')?.addEventListener('change',e=>{layer=e.target.value;render();});
    el('machineOrder')?.addEventListener('change',e=>{ordered=e.target.value==='groups';render();});
    el('machineProgram')?.addEventListener('input',e=>{draft=e.target.value;if(jobResult){jobResult=null;const result=el('machineProgram').closest('section').nextElementSibling;if(result)result.remove();}});
    for(const [id,isTrace] of [['machineJobFile',false],['machineTrace',true]])el(id)?.addEventListener('change',async e=>{
      const file=e.target.files[0],rev=DSM.head(doc()).rev,owner=root;if(!file)return;
      try{
        if(file.size>(isTrace?32*1024*1024:128000))throw Error('Файл слишком велик');
        const content=isTrace?new Uint8Array(await file.arrayBuffer()):await file.text();
        if(rev!==DSM.head(doc()).rev||owner!==root)throw Error('Проект изменился во время загрузки');
        if(isTrace){
          const decoded=Vibration.inspect(model(),root,content,Machine);
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content)),v=>v.toString(16).padStart(2,'0')).join('');
          if(rev!==DSM.head(doc()).rev||owner!==root)throw Error('Проект изменился во время проверки');
          trace={...decoded,file:file.name,base:rev,digest,content};
        }else{draft=content;jobResult=null;}
        render();
      }catch(err){if(isTrace)trace=null;render();toast(err.message);}
    });
  }
  async function handle(k,id,t){
    if(k==='Stage'){stage=id;render();return;}
    if(k==='ToBench'){
      const n=Machine.parts(model(),root).find(n=>n.attrs?.machineRole==='job');
      if(!n||document.getElementById('machineProgram').value!==n.note)throw Error('Сначала сохраните изменённое задание');
      stage='bench';render();return;
    }
    if(k.startsWith('Axis'))return bench.handle(k,id,root,Machine.parts(model(),root));
    if(k==='Pair'){openPair(layer,id,t.dataset.to);return;}
    if(k==='Graph'){openGraph(id,root);return;}
    if(k==='Notebook'){openBook(root);return;}
    const m=model(),h=DSM.head(doc()),parts=Machine.parts(m,root);
    if(k==='Duration'){const c=Machine.calculate(m,root),n=parts.find(n=>n.id===c.requirement);
      modal('Требование к записи',field('seconds','Длительность, с',c.duration,'type="number" min="1" step="1" required')+field('criterion','Проверяемый результат',n.attrs.then,'required'),f=>{
        const attrs={...n.attrs,durationSeconds:Number(f.seconds),then:f.criterion},next=DSM.patch(m,[{op:'node',value:{id:n.id,attrs}}]);Machine.calculate(next,root);
        return push(next,'Окно диагностической записи · '+f.seconds+' с','Конструктор',h.rev);
      });return;}
    if(k==='TraceBook'){
      if(!trace||trace.base!==h.rev)throw Error('Проверьте файл на текущей версии');
      const file=trace;
      const packed=new Uint8Array(await new Response(new Blob([file.content]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      if(packed.length>10*1024*1024)throw Error('Сжатый файл превышает 10 МиБ для встраивания в блокнот');
      let binary='';for(let i=0;i<packed.length;i+=32768)binary+=String.fromCharCode(...packed.subarray(i,i+32768));
      if(file!==trace||h.rev!==DSM.head(doc()).rev)throw Error('Исходная версия записи изменилась');
      openBook(root,{machineTrace:{name:file.file,digest:file.digest,packed:btoa(binary)}});return;
    }
    if(k==='SaveTrace'){
      if(!trace||trace.base!==h.rev)throw Error('Проверьте файл на текущей версии');
      const c=Machine.calculate(m,root);let seq=1;while(m.nodes.some(n=>n.id==='TRACE-'+seq))seq++;
      const value={id:'TRACE-'+seq,name:trace.file,kind:'artifact',parent:root,state:'done',
        attrs:{machineRole:'traceReceipt',sha256:trace.digest,base:h.rev,bytes:trace.bytes,complete:trace.complete,streamCount:trace.streams.length},
        refs:[c.requirement,c.format,...c.streams.map(s=>s.id)],relations:[[trace.complete?'verifies':'uses',c.requirement]],
        note:trace.streams.map(s=>s.sensor+' #'+s.number+' · '+s.samples+' / '+s.expected+' отсчётов').join('\n')};
      return push(DSM.patch(m,[{op:'node',value}]),'Проверка VIB1 · '+trace.file,'Технолог',h.rev);
    }
    if(k==='ExportTrace'){download(root+'-test.vib',Vibration.generate(m,root,Machine),'application/octet-stream');return;}
    const program=document.getElementById('machineProgram')?.value;
    const checked=Machine.simulate(program,Machine.envelope(m,root));draft=program;
    if(k==='Run'){jobResult={...checked,base:h.rev};render();return;}
    if(k==='SaveJob'){const n=parts.find(n=>n.attrs?.machineRole==='job');if(!n)throw Error('Добавьте карточку задания с machineRole=job');
      if(n.note===program){toast('Эта программа уже сохранена');return;}
      return push(DSM.patch(m,[{op:'node',value:{id:n.id,note:program}}]),'Программа технолога · '+n.id,'Технолог',h.rev);
    }
  }
  return {view,bind,handle};
}
