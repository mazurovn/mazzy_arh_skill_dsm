function reviewPanel({doc,esc,button:b,option,field,sel,table,tools,modal,push,download,proposed,render,inspect,toast}){
  let current='',scope='all',priority='',report='cycles',reportFilter='',opened=null,source='';
  const model=()=>DSM.head(doc()).data;
  const button=(name,label,id='',extra='')=>b('desk'+name,label,(id?'data-id="'+esc(id)+'" ':'')+extra);
  const labels={idea:'Новые',planned:'Принятые',active:'В проработке',blocked:'Отложенные',done:'Закрытые'};
  const priorityLabels={critical:'Критический',high:'Высокий',normal:'Обычный',low:'Низкий'};
  function textarea(name,title,value=''){
    return '<label class="field">'+title+'<textarea name="'+name+'" required>'+esc(value)+'</textarea></label>';
  }
  function selectRequest(id){
    const requests=model().nodes.filter(n=>n.kind==='request');
    const filtered=requests.filter(n=>(scope==='all'||n.state===scope)&&(!priority||n.attrs?.priority===priority));
    return {requests,filtered,n:filtered.find(n=>n.id===id)||filtered[0]};
  }
  function view(){
    const {requests,filtered,n}=selectRequest(current);
    const proposals=model().nodes.filter(n=>n.kind==='proposal');
    const promoted=n&&proposals.some(p=>p.refs?.includes(n.id));
    const actions=tools([button('New','+ Запрос','','class="primary"'),button('OpenZip','Загрузить пакет .zip')]);
    const panel='<section class="card"><div class="cardhead"><h2>Запросы на изменение</h2>'+actions+'</div>'+
      '<div class="tools"><select id="deskScope" aria-label="Стадия запроса">'+Object.entries({all:'Все стадии',...labels}).map(([k,v])=>option(k,v,scope)).join('')+'</select><select id="deskPriority" aria-label="Приоритет запроса">'+Object.entries({'':'Все приоритеты',...priorityLabels}).map(([k,v])=>option(k,v,priority)).join('')+'</select></div>'+
      (filtered.length?table(['Запрос','Название','Приоритет','Ответственный','Стадия'],filtered.map(r=>[button('Select',esc(r.id),r.id),esc(r.name),esc(priorityLabels[r.attrs?.priority]||'—'),esc(r.attrs?.owner||'—'),esc(labels[r.state]||r.state)])):'<p class="hint">'+(requests.length?'Нет запросов с такими фильтрами.':'Создайте запрос с проблемой, ожидаемым результатом и условием приёмки.')+'</p>')+'</section>';
    const cards=proposals.map(p=>{
      const {tasks,related}=Specifications.context(model(),p.id),check=Specifications.readiness(model(),p.id);
      return '<details class="request-card"><summary>'+esc(p.id)+' · '+esc(p.name)+'</summary><p>'+esc(related.map(n=>n.id).join(' · '))+'</p>'+
        check.errors.map(e=>'<p class="validation">'+esc(e)+'</p>').join('')+check.warnings.map(e=>'<p>'+esc(e)+'</p>').join('')+
        '<p>Задачи · '+tasks.filter(n=>n.state==='done').length+' / '+tasks.length+'</p>'+tasks.map(t=>'<div class="file-item"><span>'+esc(t.name)+' · '+esc(t.attrs?.owner||'—')+'</span>'+button('TaskState',t.state==='done'?'Вернуть в работу':'Завершить',t.id,p.state==='done'?'disabled':'')+'</div>').join('')+
        tools([button('Task','Добавить задачу',p.id,p.state==='done'?'disabled':''),button('Package','Просмотреть пакет',p.id,check.errors.length?'disabled':''),b('specZip','Скачать ZIP','data-id="'+esc(p.id)+'" '+(check.errors.length?'disabled':'')),b('applySpec','Apply','data-id="'+esc(p.id)+'" '+(p.state==='done'?'disabled':''))])+'</details>';
    }).join('');
    return '<div class="board"><div class="stack">'+panel+'<section class="card"><h2>Предложения OpenSpec</h2>'+ (cards||'<p>Принятый запрос можно преобразовать в предложение.</p>')+'</section></div>'+
      (n?'<aside class="card"><h3>'+esc(n.name)+'</h3><dl class="facts">'+[['Инициатор',n.attrs?.requester],['Проблема',n.note],['Результат',n.attrs?.outcome],['Приёмка',n.attrs?.acceptance],['Решение разбора',n.attrs?.rationale]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v||'—')+'</dd>').join('')+'</dl>'+tools((n.refs||[]).map(id=>button('Object',esc(id),id)))+tools([button('Review','Разобрать',n.id,promoted?'disabled':''),button('Promote','Создать предложение',n.id,' '+(n.attrs?.disposition==='accepted'&&!promoted?'':'disabled')),button('Brief','Описание .md',n.id),button('Timeline','История запроса',n.id)])+'</aside>':'')+'</div>';
  }
  function packageViewer(){
    const paths=Object.keys(opened).sort(),select=sel('entry','Файл пакета',paths.map(p=>[p,p]),paths.find(p=>p.endsWith('/proposal.md'))||paths[0]);
    modal('Содержимое пакета · '+source,select+'<pre id="deskPackageText"></pre>',()=>{
      if(!opened['dsm-package.json'])return;
      proposed(Specifications.importPackage(doc(),opened),source);return false;
    },opened['dsm-package.json']?'Проверить импорт':'Закрыть');
    const input=document.querySelector('#fields [name=entry]'),show=()=>document.getElementById('deskPackageText').textContent=opened[input.value]||'';
    input.onchange=show;show();
  }
  async function zip(file){
    if(!file)return;
    try{if(file.size>16*1024*1024)throw Error('ZIP превышает 16 МиБ');opened=await Specifications.openPackage(await file.arrayBuffer());source=file.name;packageViewer();}catch(e){toast(e.message);}
  }
  function reports(){
    const r=Reports.run(model(),report);
    const rows=r.rows.filter(row=>row.join(' ').toLowerCase().includes(reportFilter.toLowerCase()));
    const ids=new Set(model().nodes.map(n=>n.id));
    return '<article class="card"><div class="cardhead"><h2>Архитектурный анализ</h2>'+button('ReportCsv','Выгрузить CSV')+'</div><div class="tools"><select id="deskReport" aria-label="Отчёт">'+Object.entries(Reports.definitions).map(([k,[name]])=>option(k,name,report)).join('')+'</select><input id="reportFilter" type="search" aria-label="Фильтр отчёта" placeholder="Найти в результатах" value="'+esc(reportFilter)+'"></div><p>Строк · '+rows.length+' из '+r.rows.length+'</p>'+
      (rows.length?table(r.columns,rows.map(row=>row.map(v=>ids.has(v)?button('Object',esc(v),v):esc(v??'—')))):'<p>Для этого отчёта в выбранной модели нет совпадений.</p>')+'</article>';
  }
  async function handle(action,id){
    const m=model();
    switch(action){
      case 'Select':current=id;render();break;
      case 'Object':inspect(id);break;
      case 'New':modal('Новый запрос на изменение','<div class="fields2">'+field('id','ID','','required')+field('name','Название','','required')+field('requester','Инициатор','','required')+field('owner','Ответственный')+sel('priority','Приоритет',Object.entries(priorityLabels),'normal')+field('objects','Связанные ID через пробел')+'</div>'+textarea('problem','Проблема')+textarea('outcome','Ожидаемый результат')+textarea('acceptance','Как проверить результат'),async f=>{
        const next=Changes.request(model(),{...f,refs:f.objects.trim().split(/\s+/).filter(Boolean)});await push(next,'Запрос · '+f.id,f.requester);scope='all';priority='';current=f.id;render();
      });break;
      case 'Review':modal('Разбор запроса '+id,sel('outcome','Решение',[['accepted','Принять'],['deferred','Отложить'],['declined','Отклонить']],'accepted')+field('reviewer','Рецензент','','required')+textarea('reason','Обоснование'),f=>push(Changes.review(model(),id,f.outcome,f.reviewer,f.reason),'Разбор · '+id+' · '+f.reason,f.reviewer));break;
      case 'Promote':modal('Предложение по запросу '+id,field('newId','ID предложения','','required'),f=>push(Changes.promote(model(),id,f.newId),'OpenSpec propose · '+f.newId+' · '+id));break;
      case 'Task':modal('Задача предложения '+id,field('id','ID задачи','','required')+field('name','Задача','','required')+field('owner','Исполнитель'),f=>push(Changes.task(model(),id,f.id,f.name,f.owner),'Добавление задачи · '+f.id));break;
      case 'TaskState':{const n=m.nodes.find(n=>n.id===id&&n.kind==='changeTask');await push(DSM.patch(m,[{op:'node',value:{id,state:n.state==='done'?'active':'done'}}]),'Состояние задачи · '+id);break;}
      case 'Brief':download(id+'.md',Changes.brief(m,id),'text/markdown');break;
      case 'Timeline':modal('История запроса '+id,table(['Ревизия','Автор','Описание','Поля'],Changes.timeline(doc(),id).map(h=>[esc(h.rev.slice(0,8)),esc(h.actor),esc(h.note),esc(h.fields.join(', '))])),()=>{},'Закрыть');break;
      case 'Package':opened=Specifications.packageFiles(doc(),id).files;source=id;packageViewer();break;
      case 'OpenZip':{const input=document.createElement('input');input.type='file';input.accept='.zip';input.onchange=()=>zip(input.files[0]);input.click();break;}
      case 'ReportCsv':{const r=Reports.run(m,report);download(report+'.csv',Formats.csv([r.columns,...r.rows.filter(row=>row.join(' ').toLowerCase().includes(reportFilter.toLowerCase()))]),'text/csv');break;}
    }
  }
  function bind(){
    const el=id=>document.getElementById(id);
    if(el('deskScope'))el('deskScope').onchange=e=>{scope=e.target.value;render();};
    if(el('deskPriority'))el('deskPriority').onchange=e=>{priority=e.target.value;render();};
    if(el('deskReport'))el('deskReport').onchange=e=>{report=e.target.value;reportFilter='';render();};
    if(el('reportFilter'))el('reportFilter').oninput=e=>{reportFilter=e.target.value;render();el('reportFilter').focus();};
  }
  return {view,reports,bind,handle};
}
