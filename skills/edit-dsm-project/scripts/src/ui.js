(() => {
'use strict';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const embedded=DSM.document(JSON.parse($('project-data').textContent));
const original='<!doctype html>\n'+document.documentElement.outerHTML;
const tabs={journey:'Маршрут изменения',matrix:'Матрица',graph:'Граф и схема',catalog:'Каталог',plan:'Релизы и фичи',history:'Версии',io:'Обмен',notebook:'Jupyter Notebook',artifacts:'Артефакты',requirements:'Требования',requests:'Запросы',reports:'Анализ'};
const kinds=Views.types;
const sections={architecture:['journey','matrix','graph','plan','requirements','requests','artifacts','reports'],data:['catalog','notebook']};
const lastTab={architecture:'matrix',data:'catalog'};
let boundaryOpen=false,structure=null,workMode='architecture',registry='nodes',scenarioId='';
function navigate(id,record=true){
  if(record&&location.hash!=='#'+id)window.history.pushState(null,'','#'+id);
  for(const [mode,items] of Object.entries(sections))if(items.includes(id)){workMode=mode;lastTab[mode]=id;}
  if(id==='catalog')locateCatalog();
  tab=id;render();if(id==='notebook')books.refresh();
}
function showPair(from,to,target){
  structure=null;focus=from;pair=[from,to];
  if(target==='catalog'){registry='edges';filter='';}
  if(target==='matrix'&&segment&&[from,to].some(id=>nodeBy(id)?.segment!==segment))segment='';
  if(target==='graph')graphMode='neighbors';
  if(target==='matrix')locatePair(from,to);
  if(target==='graph')pages.drawing=0;
  navigate(target);
}
const states={idea:'Идея',planned:'Запланировано',active:'В работе',review:'Проверка',blocked:'Заблокировано',done:'Готово',unspecified:'Не задано'};
let doc=embedded,server=false,cacheKey='mazzy.dsm.1/'+embedded.project+'/'+DSM.head(embedded).rev,cacheOK=true,memoryBase=null;
const entryKey=cacheKey+'/opened';
let tab='matrix',layer='flow',ordered=false,focus='',pair=null,selected=new Set(),segment='',graphMode='neighbors',filter='',counter=0,submit=null,dialogBase=null,analysisCache=new Map();
const data=()=>DSM.head(doc).data, base=()=>DSM.head(doc).rev,short=s=>s.slice(0,8);
const b=(action,label,attrs='')=>'<button type="button" data-action="'+action+'" '+attrs+'>'+label+'</button>';
const option=(v,label,current)=>'<option value="'+esc(v)+'" '+(v===current?'selected':'')+'>'+esc(label)+'</option>';
const field=(name,label,value='',extra='')=>'<label class="field">'+label+'<input name="'+name+'" value="'+esc(value)+'" '+extra+'></label>';
const sel=(name,label,values,v)=>'<label class="field">'+label+'<select name="'+name+'">'+values.map(x=>option(x[0],x[1],v)).join('')+'</select></label>';
const hint=t=>'<p class="hint">'+t+'</p>';
const table=(head,rows)=>'<div class="wrap"><table class="table"><thead><tr>'+head.map(v=>'<th>'+v+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const toolbar=(items)=>'<div class="row">'+items.join('')+'</div>';
const idButton=id=>b('focus',esc(id),'class="tiny mono" data-id="'+esc(id)+'"');
let indexedModel=null,nodeIndex=new Map(),matrixLinks=new Map();
function indexModel(){
  if(indexedModel===data())return;
  indexedModel=data();nodeIndex=new Map(data().nodes.map(n=>[n.id,n]));
  matrixLinks=new Map(data().edges.map(e=>[DSM.ek(e),e]));
}
function nodeBy(id){indexModel();return nodeIndex.get(id);}
const pages={rows:0,cols:0,drawing:0,impact:0,groups:0,boundary:0,catalog:0};
function pager(key,w,label){
  if(w.pages===1)return '';
  return '<div class="pager"><span>'+label+' '+(w.start+1)+'–'+(w.start+w.items.length)+' / '+w.total+'</span>'+
    b('page','‹','aria-label="Назад · '+label+'" data-id="'+key+'" data-page="'+(w.current-1)+'" '+(w.current?'':'disabled'))+
    b('page','›','aria-label="Далее · '+label+'" data-id="'+key+'" data-page="'+(w.current+1)+'" '+(w.current+1<w.pages?'':'disabled'))+'</div>';
}
function matrixOrder(){
  return (ordered?getAnalysis().order:data().nodes.map(n=>n.id)).filter(id=>!segment||nodeBy(id).segment===segment);
}
function locatePair(from,to){
  const order=matrixOrder();
  pages.rows=Math.floor(order.indexOf(from)/32);pages.cols=Math.floor(order.indexOf(to)/32);
}

function toast(s){$('toast').textContent=s;const v=++counter;setTimeout(()=>{if(v===counter)$('toast').textContent='';},6000);}
function download(name,content,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function dynamicHtml(value){return original.replace(/(<script type="application\/json" id="project-data">)[\s\S]*?(<\/script>)/,(_,a,z)=>a+JSON.stringify(value).replaceAll('<','\\u003c')+z);}
function getAnalysis(){const key=base()+layer;if(!analysisCache.has(key)){analysisCache.clear();analysisCache.set(key,Analysis.calculate(data(),layer));}return analysisCache.get(key);}
function resetView(resetBooks=true){Object.keys(pages).forEach(k=>pages[k]=0);if(resetBooks)books.reset();resetCatalog();historyFilters={actor:'',object:'',from:'',until:'',text:'',oldest:false};structure=null;pair=null;selected.clear();focus=(data().nodes.find(n=>n.kind==='feature')||data().nodes[0])?.id||'';segment='';filter='';}
function cache(previous=null){
  if(server)return;
  try{localStorage.setItem(cacheKey,JSON.stringify(doc));cacheOK=true;memoryBase=null;}catch{if(cacheOK)memoryBase=previous;cacheOK=false;toast('Кэш браузера недоступен. Сохраните проект в JSON.');}
}
async function push(next,note,actor='Редактор',expected=dialogBase||base()){
  if(expected!==base())throw Error('Проект изменился с момента открытия формы. Скопируйте правку, закройте форму и сравните версии.');
  if(server){
    const r=await fetch('/api/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:doc.project,base:expected,note,actor,data:next})});
    const res=await r.json();if(!r.ok)throw Error(res.error);doc=DSM.document(res);
  }else{
    const saveLocal=()=>{let stored=null;try{stored=localStorage.getItem(cacheKey);}catch{}
      if(stored&&DSM.head(JSON.parse(stored)).rev!==(cacheOK?expected:memoryBase||expected))throw Error('Другая вкладка уже сохранила изменения. Обновите страницу и сравните версии.');
      doc=DSM.commit(doc,next,expected,note,actor);cache(expected);};
    if(navigator.locks)await navigator.locks.request(cacheKey,saveLocal);else saveLocal();
  }
  render();toast('Версия сохранена · '+short(base()));
}
function modal(title,html,onSubmit,label='Сохранить версию'){dialogBase=base();$('accept').disabled=false;$('dlgTitle').textContent=title;$('fields').innerHTML=html;$('formError').textContent='';$('accept').textContent=label;submit=onSubmit;$('dialog').showModal();}
function close(){submit=null;dialogBase=null;$('dialog').close();}
$('cancel').onclick=$('close').onclick=close;$('dialog').addEventListener('close',()=>{submit=null;dialogBase=null;});
$('form').onsubmit=async e=>{e.preventDefault();const handler=submit;$('accept').disabled=true;try{if(await handler(Object.fromEntries(new FormData(e.target)))!==false)close();}catch(err){$('formError').textContent=err.message;}finally{if(submit===handler)$('accept').disabled=false;}};
function shell(content){
  $('title').textContent=data().title;$('summary').textContent=(data().nodes.some(n=>n.kind==='product'&&n.note.startsWith('Вымышленный терминальный помощник в духе Qwen Code.'))?'Учебный пример в духе Qwen Code · ':'')+data().nodes.length+' объектов · '+data().edges.filter(x=>x.layer==='flow').length+' вызовов · '+data().edges.filter(x=>x.layer==='risk').length+' пар совместной проверки';
  $('mode').textContent=server?'Связь с локальным агентом':cacheOK?'Локальный проект':'Требуется выгрузка JSON';
  $('revision').textContent='Версия '+doc.history.length+' · '+short(base());
  $('workMode').innerHTML=Object.entries({architecture:'Архитектура',data:'Данные и расчёты'}).map(([k,v])=>b('workMode',v,'aria-pressed="'+(k===workMode)+'" data-id="'+k+'"')).join('');
  $('notebookHost').hidden=tab!=='notebook'||!books.active();
  $('demoGuide').hidden=doc.project!==embedded.project||!data().nodes.some(n=>n.id==='TK'&&n.note.includes('Qwen Code'))||!nodeBy('F02')||!nodeBy('F03');
  const menu={'Изменения':['journey','requirements','requests','artifacts','plan'],'Архитектура':['catalog','matrix','graph','reports'],'Данные':['notebook','history','io']};
  $('nav').innerHTML=Object.entries(menu).map(([title,items])=>'<section><h2>'+title+'</h2>'+items.map(k=>
    b('tab',tabs[k],'class="'+(k===tab?'on':'')+'" '+(k===tab?'aria-current="page" ':'')+'data-id="'+k+'"')).join('')+'</section>').join('');
  $('content').innerHTML=content;
}
function layerControl(){return '<div class="toggle">'+[['flow','Вызовы'],['risk','Совместные проверки']].map(([k,v])=>b('layer',v,'data-id="'+k+'" class="'+(k===layer?'on':'')+'"')).join('')+'</div>';}
function inspector(){
  const n=nodeBy(focus);if(!n)return '<aside class="card"><h3>Первый объект</h3>'+b('node','Добавить объект')+'</aside>';
  const e=pair&&data().edges.find(x=>DSM.ek(x)===DSM.ek({layer,from:pair[0],to:pair[1]}));
  const impact=Analysis.impact(data(),n.id),a=getAnalysis();
  const affected=Scope.page(impact.dependents,pages.impact,32),clusters=Scope.page(a.groups,pages.groups,12);
  let box='<div class="eyebrow">ИНСПЕКТОР</div><h2>'+esc(n.name)+'</h2><p><span class="tag">'+esc(n.id)+'</span> '+esc(kinds[n.kind])+'</p>';
  if(pair){box+='<div class="callout"><b>'+esc(pair.join(layer==='flow'?' → ':' ↔ '))+'</b><br>'+(e?'Вес '+e.weight+' · '+esc(e.reason):'В этой ячейке связь ещё не описана.')+'</div>'+b('edge',e?'Изменить связь':'Создать связь');}
  else {box+=hint(esc(n.note)||'Выберите ячейку матрицы, чтобы увидеть основание связи.')+b('edit','Изменить объект','data-id="'+esc(n.id)+'"');}
  if(structure)box+='<div class="callout"><b>'+esc(structure.from)+' → '+esc(structure.to)+'</b><br>'+esc(structure.reason)+'</div>'+b('structureView',tab==='catalog'?'На концептуальную схему':'В реестр архитектурных связей');
  const refs=[...new Set([...(n.refs||[]),...data().nodes.filter(other=>other.refs?.includes(n.id)).map(other=>other.id)])];
  if(n.attrs)box+=table(['Атрибут','Значение'],Object.entries(n.attrs).map(([k,v])=>[esc(k),esc(v)]));
  const relations=data().nodes.flatMap(other=>(other.relations||[]).filter(([,to])=>other.id===n.id||to===n.id).map(([k,to])=>[idButton(other.id),esc(Views.relations[k]),idButton(to)]));
  if(relations.length)box+=table(['Объект','Связь','Цель'],relations);
  if(n.kind==='proposal')box+=toolbar([b('document','Оформить ADR','data-id="adr"'),b('specZip','Пакет OpenSpec','data-id="'+esc(n.id)+'"'),b('applySpec','Apply · применить патч','data-id="'+esc(n.id)+'" '+(n.state==='done'?'disabled':''))]);
  if(n.kind==='requirement')box+=b('journeySelect','К маршруту изменения','data-id="'+esc(n.id)+'"');
  if(n.kind!=='requirement'){
    const by=Delivery.index(data()).by;
    const direct=[...(n.refs||[]),...(nodeBy(n.parent)?.refs||[]),...(n.relations||[]).filter(([kind])=>kind==='realizes').map(([,id])=>id)];
    const routes=[...new Set(direct)].filter(id=>by.get(id)?.kind==='requirement');
    if(routes.length)box+=toolbar(routes.map(id=>b('journeySelect','Маршрут '+esc(id),'data-id="'+esc(id)+'"')));
  }
  if(n.kind==='scenario')box+=b('scenarioView','Показать последовательность','data-id="'+esc(n.id)+'"');
  if(refs.length)box+='<h3>Связанные артефакты и объекты</h3>'+toolbar(refs.map(idButton));
  if(pair)box+='<div class="tools">'+[['matrix','В матрицу'],['graph','На граф'],['catalog','В реестр связей']].filter(([k])=>k!==tab).map(([k,label])=>b('pairView',label,'data-id="'+k+'"')).join('')+'</div>';
  else if(tab!=='catalog')box+=b('objectRow','В таблицу объектов','data-id="'+esc(n.id)+'"');
  return '<aside><div class="card">'+box+'</div><div class="card"><h3>Влияние изменения</h3>'+hint('Транзитивные потребители контракта '+esc(n.id))+toolbar(affected.items.map(idButton))+pager('impact',affected,'Потребители')+(impact.dependents.length?'':hint('Потребителей нет.'))+'<div class="pair"><span>Прямые совместные проверки</span><b>'+impact.checks.length+'</b></div></div><div class="card"><h3>Разбиение по связям</h3>'+hint('Группы с положительным приростом модулярности Q.')+clusters.items.map((g,i)=>'<div class="cluster"><b>Группа '+(clusters.start+i+1)+'</b> · '+esc(g.join(' · '))+'</div>').join('')+pager('groups',clusters,'Группы')+'</div></aside>';
}
function matrix(){
  const d=data(),a=getAnalysis(),order=matrixOrder();
  const rows=Scope.page(order,pages.rows,32),cols=Scope.page(order,pages.cols,32);
  const segments=[...new Set(d.nodes.map(n=>n.segment).filter(Boolean))];
  const head='<thead><tr><th></th>'+cols.items.map(id=>'<th scope="col" '+(pair?.[1]===id?'class="axis-selected" ':'')+'title="'+esc(nodeBy(id).name)+'">'+esc(id)+'</th>').join('')+'</tr></thead>';
  const body=rows.items.map(from=>'<tr><th scope="row" class="label '+(pair?.[0]===from?'axis-selected':'')+'">'+b('focus',esc(from),'data-id="'+esc(from)+'"')+'</th>'+cols.items.map(to=>{
    const w=matrixLinks.get(DSM.ek({from,to,layer}))?.weight||0,active=pair?.[0]===from&&pair?.[1]===to;
    return '<td>'+b(from===to?'focus':'cell',from===to?'·':w||'','aria-label="'+esc(from+' / '+to+' / '+w)+'" title="'+esc(from+' / '+to+' · '+w)+'" data-id="'+esc(from)+'" data-to="'+esc(to)+'" class="cell '+(from===to?'diag':'w'+Math.min(3,w))+(active?' active':'')+'"')+'</td>';
  }).join('')+'</tr>').join('');
  const jump=d.nodes.length>32?'<div class="tools"><label>Строка <input id="rowJump" list="matrixIds" value="'+esc(pair?.[0]||'')+'"></label><label>Столбец <input id="colJump" list="matrixIds" value="'+esc(pair?.[1]||'')+'"></label>'+b('jumpPair','Найти ячейку')+'<datalist id="matrixIds">'+d.nodes.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+'</option>').join('')+'</datalist></div>':'';
  return '<div class="board"><article class="card"><div class="cardhead"><div><h2>Матрица зависимостей</h2>'+hint(layer==='flow'?'Строка вызывает столбец. Нажмите ячейку для правки.':'Вес совместной проверки показан по обе стороны диагонали.')+'</div></div>'+layerControl()+'<div class="tools"><select id="order" aria-label="Порядок матрицы">'+option('initial','Исходный порядок',ordered?'':'initial')+option('group','По кластерам',ordered?'group':'')+'</select><select id="segment" aria-label="Сегмент">'+option('','Все сегменты',segment)+segments.map(s=>option(s,s,segment)).join('')+'</select></div>'+jump+'<div class="tools">'+pager('rows',rows,'Строки')+pager('cols',cols,'Столбцы')+'</div><div class="wrap"><table class="matrix">'+head+'<tbody>'+body+'</tbody></table></div><div class="legend">'+[['#edf2ef','Нет связи'],['#a9ddbd','Вес 1'],['#58ac87','Вес 2'],['#106849','Вес 3+']].map(([c,t])=>'<span><i style="background:'+c+'"></i>'+t+'</span>').join('')+'</div><div class="metricline"><span>Длина L <b>'+a.cost_before+' → '+a.cost_after+'</b></span><span>Межгрупповые связи <b>'+a.cross_links+'</b></span><span>Q <b>'+a.modularity.toFixed(3)+'</b></span></div>'+hint('Показатели рассчитаны для полного слоя. Фильтр сегмента меняет область просмотра.')+'</article>'+inspector()+'</div>';
}
function demoSteps(){
  const sample=[['F02','RUN'],['F03','RUN'],['RUN','LOG']];
  return data().nodes.some(n=>n.id==='TK'&&n.note.includes('Qwen Code'))&&sample.every(([from,to])=>data().edges.some(e=>e.layer==='flow'&&e.from===from&&e.to===to))?sample:[];
}
function graph(){
  const m=data(),scenarios=m.nodes.filter(n=>n.kind==='scenario'),scenario=scenarios.find(n=>n.id===scenarioId)||scenarios[0];
  const sequence=graphMode==='sequence';
  const steps=scenario?.steps||(!scenario?demoSteps():[]);
  const title=Views.modes[graphMode];
  const description={component:'Компоненты, модули, продукты, системы и сервисы. Линия открывает договор между двумя объектами.',concept:'Группировка по сегменту или типу. Стрелки показывают состав и ссылки на объекты.',tree:'Стрелка ведёт от родителя к дочернему объекту.',sequence:'Сообщения читаются сверху вниз. Нажмите сообщение, чтобы открыть исходный вызов.'};
  const controls='<div class="tools"><select id="graphMode" aria-label="Вид графа">'+Object.entries(Views.modes).map(([k,v])=>option(k,v,graphMode)).join('')+'</select>'+
    (['neighbors','all','component'].includes(graphMode)?layerControl():'')+'</div>';
  const selector=sequence?(scenarios.length?'<select id="scenarioSelect" aria-label="Сценарий">'+scenarios.map(n=>option(n.id,n.name,scenario.id)).join('')+'</select>':hint(steps.length?'Пример сценария Terminal Kit · подтверждение и выполнение плана':''))+
    b('makeScenario','+ Сценарий')+(scenario?b('edit','Изменить шаги','data-id="'+esc(scenario.id)+'"'):''):
    '<select id="focusSelect" aria-label="Фокус графа">'+m.nodes.map(n=>option(n.id,n.id+' · '+n.name,focus)).join('')+'</select>';
  const groups=graphMode==='all'?getAnalysis().groups:[];
  const scope=sequence?null:Scope.graph(m,graphMode,layer,focus,pair,groups,pages.drawing,structure);
  const window=sequence?Scope.page(steps,pages.drawing,40):scope.window;
  const drawing=sequence?Views.sequence(m,window.items,focus,pair,window.start):Views.diagram(scope.model,graphMode,layer,focus,pair,scope.groups,structure,scope);
  let boundary='';
  if(scope&&window.pages>1){
    boundary=hint('Во фрагменте '+scope.model.nodes.length+' объектов и '+scope.edges.length+' связей. Через границу проходят '+scope.crossing+'.');
    if(scope.crossing){
      boundary+=b('graphBoundary',boundaryOpen?'Скрыть граничные связи':'Граничные связи');
      if(boundaryOpen){
        const part=Scope.page(scope.boundary,pages.boundary,30);
        boundary+=pager('boundary',part,'Граничные связи')+table(['Связь','Основание'],part.items.map(e=>[
          b(['flow','risk'].includes(e.layer)?'cell':'structure',esc(e.from+(e.layer==='risk'?' ↔ ':' → ')+e.to),
            'data-id="'+esc(e.from)+'" data-to="'+esc(e.to)+'" data-layer="'+esc(e.layer)+'"'),esc(e.reason)]));
      }
    }
  }
  return '<div class="board"><article class="card"><div class="cardhead"><h2>'+title+'</h2>'+b('svg','Скачать SVG','class="tiny" '+(drawing.includes('<svg')?'':'disabled'))+'</div>'+hint(description[graphMode]||'Выберите линию для просмотра основания и перехода к ячейке DSM.')+controls+'<div class="tools">'+selector+'</div>'+pager('drawing',window,sequence?'Сообщения':'Объекты')+boundary+drawing+'</article>'+inspector()+'</div>';
}
let catalogFilters=Registers.defaults();
let historyFilters={actor:'',object:'',from:'',until:'',text:'',oldest:false};
function resetCatalog(){catalogFilters=Registers.defaults();filter='';pages.catalog=0;}
function locateCatalog(){
  const pos=visibleCatalog().findIndex(row=>{
    if(registry==='nodes')return row.id===focus;
    if(registry==='structure')return structure&&row.from===structure.from&&row.to===structure.to&&row.layer===structure.layer;
    return pair&&DSM.ek(row)===DSM.ek({from:pair[0],to:pair[1],layer});
  });
  if(pos>=0)pages.catalog=Math.floor(pos/75);
}
function filterSelect(id,title,choices,current){
  return '<label class="filter-control">'+title+'<select id="'+id+'">'+choices.map(([k,v])=>option(k,v,current)).join('')+'</select></label>';
}
function catalogControls(){
  const f=catalogFilters,d=data(),segments=[...new Set(d.nodes.map(n=>n.segment).filter(Boolean))].sort();
  return '<details id="catalogOptions" '+(Object.keys(f).some(k=>f[k]!==Registers.defaults()[k])?'open':'')+'><summary>Фильтры и сортировка</summary><div class="tools">'+
    filterSelect('catalog-kind','Тип',[['','Все типы'],...Object.entries(kinds)],f.kind)+filterSelect('catalog-state','Статус',[['','Все статусы'],...Object.entries(states)],f.state)+
    filterSelect('catalog-segment','Сегмент',[['','Все сегменты'],...segments.map(v=>[v,v])],f.segment)+
    filterSelect('catalog-release','Назначение',[['*','Все назначения'],['','Без релиза'],...d.nodes.filter(n=>n.kind==='release').map(n=>[n.id,n.name])],f.release)+
    filterSelect('catalog-order','Порядок',[['initial','Исходный'],['id','По ID'],['name','По названию']],f.order)+b('clearCatalog','Сбросить фильтры')+'</div></details>';
}
function visibleCatalog(){
  if(registry==='nodes')return Registers.nodes(data(),filter,catalogFilters);
  const entries=registry==='structure'?Views.structures(data()):data().edges.filter(e=>e.layer===layer);
  return entries.filter(e=>Registers.match(filter,e.from,e.to,e.layer,e.reason,e.weight));
}
function catalog(){
  const window=Scope.page(visibleCatalog(),pages.catalog,75),entries=window.items;
  const rows=registry==='nodes'?entries.map(n=>[idButton(n.id),esc(n.name),kinds[n.kind],states[n.state],esc(n.parent||'—'),esc(n.release||'—'),esc(n.segment||'—'),b('edit','Изменить','class="tiny" data-id="'+esc(n.id)+'"')]):
    registry==='structure'?entries.map(e=>[b('structure',esc(e.from+' → '+e.to),'data-id="'+esc(e.from)+'" data-to="'+esc(e.to)+'" data-layer="'+esc(e.layer)+'"'),esc(e.reason)]):
    entries.map(e=>[b('cell',esc(e.from+(layer==='flow'?' → ':' ↔ ')+e.to),'data-id="'+esc(e.from)+'" data-to="'+esc(e.to)+'"'),e.weight,esc(e.reason)]);
  const headers=registry==='nodes'?['ID','Объект','Тип','Статус','Родитель','Релиз','Сегмент','']:registry==='structure'?['Связь','Тип']:['Связь','Вес','Основание'];
  return '<div class="board"><article class="card"><div class="cardhead"><h2>Архитектурный реестр</h2>'+toolbar([b('node','+ Объект'),b('newEdge','+ Связь'),b('grid','Ввод строк',registry==='structure'?'disabled':'')])+'</div><div class="toggle">'+[['nodes','Объекты'],['edges','Связи DSM'],['structure','Архитектурные связи']].map(([k,v])=>b('registry',v,'data-id="'+k+'" class="'+(registry===k?'on':'')+'"')).join('')+'</div>'+
    '<div class="tools"><input id="query" placeholder="Поиск по реестру" aria-label="Поиск" value="'+esc(filter)+'">'+(registry==='edges'?layerControl():'')+'</div>'+(registry==='nodes'?catalogControls():'')+'<div class="tools"><span>Найдено · '+window.total+'</span>'+b('catalogCsv','CSV выборки')+'</div>'+pager('catalog',window,'Записи')+table(headers,rows)+(rows.length?'':hint('По этому запросу записей нет.'))+'</article>'+inspector()+'</div>';
}
function gridInput(){
  const edges=registry==='edges',cols=edges?['from','to','weight','reason']:['id','name'];
  const labels=edges?['Откуда','Куда','Вес','Основание']:['ID','Название'];
  const row=()=>'<tr>'+cols.map((k,i)=>'<td><input aria-label="'+labels[i]+'" data-col="'+k+'"></td>').join('')+'</tr>';
  modal('Табличный ввод',hint('Введите строки или вставьте диапазон из таблицы в первую ячейку. В существующем каталоге совпадение ID обновляет название.')+'<div class="wrap"><table class="table"><thead><tr>'+labels.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody id="gridRows">'+row()+row()+row()+'</tbody></table></div>'+b('gridRow','+ Строка'),()=>{
    const rows=Array.from($('gridRows').rows,r=>Array.from(r.querySelectorAll('input'),el=>el.value)).filter(r=>r.some(Boolean));
    if(!rows.length)throw Error('Заполните хотя бы одну строку');
    const input=Formats.readCsv(Formats.csv([cols,...rows]),{layer});
    proposed(input);return false;
  },'Предпросмотр');
  const grid=$('gridRows');
  $('fields').querySelector('[data-action=gridRow]').onclick=()=>grid.insertAdjacentHTML('beforeend',row());
  grid.onpaste=e=>{
    const text=e.clipboardData.getData('text/plain');
    if(!/[\t\n]/.test(text))return;
    e.preventDefault();const cell=e.target.closest('td');
    const pasted=text.replace(/\r/g,'').trimEnd().split('\n').map(line=>line.split('\t'));
    if(!cell||pasted.some(r=>r.length+cell.cellIndex>cols.length)){$('formError').textContent='Слишком много столбцов для выбранной ячейки';return;}
    const start=cell.parentElement.sectionRowIndex;
    pasted.forEach((values,i)=>{if(!grid.rows[start+i])grid.insertAdjacentHTML('beforeend',row());values.forEach((v,j)=>{grid.rows[start+i].cells[cell.cellIndex+j].firstChild.value=v;});});
  };
}
function requirements(){
  const coverage=Specifications.coverage(data()),open=data().nodes.filter(n=>n.kind==='deviation'&&n.state!=='done');
  return '<div class="board"><article class="card"><div class="cardhead"><h2>Покрытие требований</h2>'+b('document','+ Требование','data-id="requirement"')+'</div>'+table(['Требование','Реализация','Открытые отклонения'],coverage.map(r=>[idButton(r.requirement.id)+' '+esc(r.requirement.name),r.implementations.length?toolbar(r.implementations.map(n=>idButton(n.id))):'<span class="warn">Нет реализации</span>',toolbar(r.deviations.map(n=>idButton(n.id)))||'—']))+'<div class="cardhead"><h3>Открытые отклонения</h3>'+b('document','+ Отклонение','data-id="deviation"')+'</div>'+table(['Карточка','Объекты','Ожидалось','Фактически'],open.map(n=>[idButton(n.id)+' '+esc(n.name),toolbar((n.refs||[]).map(idButton)),esc(n.attrs?.expected??'—'),esc(n.attrs?.actual??'—')]))+'</article>'+inspector()+'</div>';
}
function applySpec(id){
  const proposal=nodeBy(id), revision=base();
  const patch={project:doc.project,base:revision,ops:[]};
  modal('Применить предложение '+id,hint('Вставьте согласованный JSON-патч. Изменения и перевод предложения в состояние «Готово» получат одну ревизию.')+'<label class="field">JSON-патч<textarea name="patch" required>'+esc(JSON.stringify(patch,null,2))+'</textarea></label>'+field('actor','Автор решения','Редактор','required')+field('note','Описание изменения','OpenSpec apply · '+id,'required'),f=>{
    const input=Formats.parseJson(JSON.parse(f.patch));
    if(input.kind!=='patch')throw Error('Ожидается JSON-патч с project, base и ops');
    const updated=Formats.preview(doc,input);
    if(!updated.nodes.some(n=>n.id===id&&n.kind==='proposal'))throw Error('Патч должен сохранить предложение');
    const next=Changes.completeProposal(updated,id);
    modal('Apply · '+proposal.name,Views.differences(DSM.diff(data(),next)),()=>push(next,f.note,f.actor,revision),'Применить и сохранить');
    return false;
  },'Предпросмотр');
}
function artifacts(){
  const nodes=data().nodes.filter(n=>['adr','proposal','scenario','artifact'].includes(n.kind));
  return '<div class="board"><article class="card"><h2>Архитектурные артефакты</h2>'+hint('Оформите изменение как предложение OpenSpec. В ADR зафиксируйте решение и укажите ID предложения и затронутых объектов.')+toolbar([b('document','+ OpenSpec proposal','data-id="proposal"'),b('document','+ ADR','data-id="adr"'),b('makeScenario','+ Сценарий')])+table(['ID','Артефакт','Тип','Связано с',''],nodes.map(n=>[idButton(n.id),esc(n.name),kinds[n.kind],toolbar((n.refs||[]).map(idButton)),toolbar([b('edit','Изменить','data-id="'+esc(n.id)+'"'),b('documentDownload','Скачать Markdown','data-id="'+esc(n.id)+'"')])]))+'</article>'+inspector()+'</div>';
}
const books=notebookPanel({doc:()=>doc,online:()=>server,visible:()=>tab==='notebook',render,proposed,modal,download,button:b,option,esc,toast});
const desk=reviewPanel({doc:()=>doc,esc,button:b,option,field,sel,table,tools:toolbar,modal,push,download,proposed,render,toast,
  inspect:id=>{registry='nodes';filter='';focus=id;pair=null;structure=null;resetCatalog();navigate('catalog');}});
const journey=deliveryPanel({model:data,doc:()=>doc,esc,button:b,field,sel,table,modal,push,download,render,navigate,toast,
  inspect:id=>{resetCatalog();registry='nodes';focus=id;pair=null;structure=null;navigate('catalog');}});
function plan(){
  const releases=DSM.plan(data()),features=data().nodes.filter(n=>n.kind==='feature');
  const cards=releases.map(r=>'<div class="card"><span class="tag">'+esc(r.id)+'</span><h3>'+esc(r.name)+'</h3><div class="big">'+r.knownEffort+' / '+(r.capacity??'—')+'</div><div class="progress '+(r.capacity!==null&&r.knownEffort>r.capacity?'over':'')+'"><i style="width:'+Math.min(100,r.capacity?r.knownEffort/r.capacity*100:r.knownEffort?100:0)+'%"></i></div><div class="pair"><span>Без оценки</span><b>'+r.unknown+'</b></div><div class="pair"><span>Внешние вызовы / проверки</span><b>'+r.outgoing+' / '+r.crossChecks+'</b></div>'+ (r.capacity!==null&&r.knownEffort>r.capacity?'<span class="warn">Перегрузка на '+(r.knownEffort-r.capacity)+'</span>':'')+'</div>').join('');
  const works=data().nodes.filter(n=>n.kind==='changeTask');
  const workTable=works.length?'<section class="card" style="margin-top:15px"><h2>Работы по изменениям</h2>'+table(['Работа','Предложение','Релиз','Исполнитель','Оценка','Состояние',''],works.map(w=>[
    b('objectRow',esc(w.id),'data-id="'+esc(w.id)+'"')+' '+esc(w.name),b('objectRow',esc(w.parent),'data-id="'+esc(w.parent)+'"'),w.release?b('objectRow',esc(w.release),'data-id="'+esc(w.release)+'"'):'Бэклог',esc(w.attrs?.owner||'—'),w.effort??'—',states[w.state],
    nodeBy(w.parent)?.state!=='done'?b('journeyTransfer','Перенести работу','data-id="'+esc(w.id)+'"'):''
  ]))+'</section>':'';
  return '<div class="cols">'+cards+'</div><div class="card" style="margin-top:15px"><div class="cardhead"><div><h2>Планирование фич</h2>'+hint('Отметьте фичи для общего пакета, сегмента, релиза или перехода состояния. Оценки заданы в условных единицах.')+'</div>'+b('bulk','Изменить выбранные ('+selected.size+')',selected.size?'class="primary"':'disabled')+'</div>'+table(['Выбор','ID','Фича','Статус','Оценка','Релиз','Пакет'],features.map(n=>['<input type="checkbox" aria-label="Выбрать '+esc(n.id)+'" data-check="'+esc(n.id)+'" '+(selected.has(n.id)?'checked':'')+'>',esc(n.id),esc(n.name),states[n.state],n.effort??'—',esc(n.release||'Бэклог'),esc(n.bundle||'—')]))+b('node','+ Объект')+'</div>'+workTable;
}
function history(){
  const f=historyFilters,entries=Registers.revisions(doc,f);
  const {ids,authors}=Registers.historyIndex(doc);
  return '<div class="card"><div class="cardhead"><h2>Версии проекта</h2>'+toolbar([b('changeLog','Журнал .md'),b('snapshot','+ Именованный снимок')])+'</div>'+
    '<details '+(Object.values(f).some(Boolean)?'open':'')+'><summary>Фильтры истории</summary><div class="tools"><input id="history-text" type="search" placeholder="Автор, описание, ревизия" aria-label="Поиск по истории" value="'+esc(f.text)+'">'+
    filterSelect('history-actor','Автор',[['','Все авторы'],...authors.map(x=>[x,x])],f.actor)+filterSelect('history-object','Изменения объекта',[['','Все объекты'],...ids.map(x=>[x,x])],f.object)+
    '<label>С <input type="date" id="history-from" value="'+esc(f.from)+'"></label><label>По <input type="date" id="history-until" value="'+esc(f.until)+'"></label>'+
    '<label><input type="checkbox" id="history-oldest" '+(f.oldest?'checked':'')+'> Сначала ранние</label></div></details>'+
    table(['Версия','Сохранено','Автор','Изменение',''],entries.map(({h,i})=>[i+1+' · <code>'+short(h.rev)+'</code>',esc(new Date(h.at).toLocaleString('ru-RU')),esc(h.actor),esc(h.note),toolbar([b('diff','Сравнить','class="tiny" data-id="'+h.rev+'"'),...(h.rev!==base()?[b('restore','Восстановить','class="tiny" data-id="'+h.rev+'"')]:[])])]))+'</div>';
}
function io(){return '<div class="cols"><div class="card"><h2>Загрузить данные</h2>'+hint('Откройте проект JSON или HTML с историей. Для обновления текущей версии выберите Markdown, CSV, Excel, блокнот или JSON-патч.')+b('open','Выбрать файл','class="primary"')+'<h3 style="margin-top:22px">Вставить исходный текст</h3>'+hint('Каталог: ID : название. Вызов: A -> B : основание. Совместная проверка: A ~ B [3] : основание. CSV принимает также заголовки на русском.')+'<textarea id="raw" aria-label="Исходный текст" placeholder="CLI : Интерфейс командной строки&#10;CFG : Настройки&#10;CLI -> CFG : Загрузить профиль"></textarea><div class="tools"><select id="rawType" aria-label="Формат текста"><option value="txt">Текстовый список</option><option value="csv">CSV</option><option value="md">Markdown</option><option value="json">JSON или патч</option></select>'+b('parse','Проверить импорт')+'</div><label class="field">Слой для CSV-матрицы или реестра без столбца layer<select id="importLayer">'+option('flow','Вызовы',layer)+option('risk','Совместные проверки',layer)+'</select></label></div><div class="card"><h2>Выгрузить версию</h2>'+hint('JSON и автономный HTML включают всю историю. В табличных представлениях записаны ID проекта и исходная ревизия. Отредактированную таблицу можно вернуть в ту же ревизию.')+'<div class="row export">'+['json','html','md','csv','xlsx','ipynb','sysl'].map(k=>b('export',k.toUpperCase(),'data-id="'+k+'"')).join('')+'</div><h3 style="margin-top:24px">Передать агенту</h3>'+hint('Передайте сохранённый JSON в чат или откройте его локальным CLI. Агент читает текущую версию и возвращает патч с тем же base.')+'<pre>'+esc(JSON.stringify({project:doc.project,base:base(),ops:[{op:'title',value:data().title}]},null,2))+'</pre>'+b('context','Скачать задание агенту')+'</div></div>';}
function render(){
  if(!nodeBy(focus))focus=data().nodes[0]?.id||'';
  if(pair&&pair.some(id=>!nodeBy(id)))pair=null;
  shell(({journey:journey.view,matrix,graph,catalog,plan,history,io,artifacts,requirements,requests:desk.view,reports:desk.reports,notebook:books.view})[tab]());
  if(tab==='journey')journey.bind();
  if(tab==='notebook')books.bind();
  if(tab==='requests'||tab==='reports')desk.bind();
  if(tab==='catalog'){
    for(const row of $('content').querySelectorAll('tbody tr')){const t=row.querySelector('[data-action]');if(t)row.classList.toggle('selected',registry==='nodes'?t.dataset.id===focus:registry==='structure'?structure?.from===t.dataset.id&&structure?.to===t.dataset.to&&structure?.layer===t.dataset.layer:!!pair&&DSM.ek({layer,from:t.dataset.id,to:t.dataset.to})===DSM.ek({layer,from:pair[0],to:pair[1]}));}
  }
}
function nodeForm(id=null,kind='feature'){
  const templates={proposal:'## Why\n\n\n## What Changes\n\n\n## Capabilities\n\n\n## Impact\n',adr:'## Контекст\n\n\n## Решение\n\n\n## Последствия\n'};

  const n=id?nodeBy(id):{id:'',name:'',kind,state:'idea',note:templates[kind]||'',attrs:kind==='requirement'?{when:'',then:''}:kind==='deviation'?{expected:'',actual:''}:{},refs:focus&&['proposal','adr','deviation','requirement'].includes(kind)?[focus]:[],steps:kind==='scenario'?demoSteps():[]},nodes=data().nodes,choices=nodes.filter(x=>x.id!==id).map(x=>[x.id,x.id+' · '+x.name]);
  modal(id?'Изменить объект':'Новый объект','<div class="fields2">'+field('id','Постоянный ID',n.id,id?'readonly':'required')+field('name','Название',n.name,'required')+sel('kind','Тип',Object.entries(kinds),n.kind)+sel('state','Состояние',Object.entries(states),n.state)+sel('parent','Родитель',[['','Нет'],...choices],n.parent||'')+sel('release','Релиз',[['','Бэклог'],...nodes.filter(x=>x.kind==='release'&&x.id!==id).map(x=>[x.id,x.name])],n.release||'')+field('segment','Сегмент',n.segment)+field('bundle','Пакет фич',n.bundle)+field('effort','Оценка работы',n.effort,'type="number" min="0" step="any"')+field('capacity','Ёмкость релиза',n.capacity,'type="number" min="0" step="any"')+'</div>'+'<label class="field">Описание или Markdown<textarea name="note">'+esc(n.note)+'</textarea></label><label class="field">Загрузить текст документа<input type="file" id="documentFile" accept=".md,.txt"></label>'+field('refs','Связанные ID через пробел',(n.refs||[]).join(' '))+
    '<details '+(n.attrs||n.relations?'open':'')+'><summary>Атрибуты и типизированные связи</summary><label class="field">Атрибуты · JSON-объект<textarea name="attrs">'+esc(JSON.stringify(n.attrs||{},null,2))+'</textarea></label><label class="field">Тип связи и ID · одна пара на строку<textarea name="relations">'+esc((n.relations||[]).map(r=>r.join(' ')).join('\n'))+'</textarea></label>'+hint(Object.entries(Views.relations).map(([k,v])=>k+' — '+v).join(' · '))+'</details><div id="scenarioFields"><label class="field">Последовательность вызовов · по одной паре ID на строку<textarea name="steps" placeholder="F02 RUN">'+esc((n.steps||[]).map(step=>step.join(' ')).join('\n'))+'</textarea></label><div class="tools"><select id="stepChoice" aria-label="Вызов сценария">'+data().edges.filter(e=>e.layer==='flow').map(e=>option(e.from+' '+e.to,e.from+' → '+e.to+' · '+e.reason,'')).join('')+'</select>'+b('appendStep','Добавить шаг')+'</div></div>',async f=>{
    if(!id&&nodeBy(f.id))throw Error('Такой ID уже существует');
    for(const k of ['effort','capacity'])f[k]=f[k]===''?null:Number(f[k]);
    f.attrs=JSON.parse(f.attrs.trim()||'{}');
    f.relations=f.relations.trim()?f.relations.trim().split(/\r?\n/).map(s=>s.trim().split(/\s+/)):[];
    f.refs=f.refs.trim().split(/\s+/).filter(Boolean);
    f.steps=f.steps.trim()?f.steps.trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/)):[];
    await push(DSM.patch(data(),[{op:'node',value:f}]),(id?'Изменение ':'Добавление ')+f.id);focus=f.id;pair=null;structure=null;if(f.kind==='scenario')scenarioId=f.id;render();
  });
  const kindSelect=$('fields').querySelector('[name=kind]');
  const fields=()=>{$('scenarioFields').hidden=kindSelect.value!=='scenario';};
  kindSelect.onchange=fields;fields();
  $('documentFile').onchange=async e=>{const f=e.target.files[0];if(f)$('fields').querySelector('[name=note]').value=await f.text();};
}
function edgeForm(fixed){
  const from=fixed&&pair?pair[0]:focus,to=fixed&&pair?pair[1]:data().nodes.find(n=>n.id!==from)?.id;
  if(!from||!to){toast('Добавьте минимум два объекта');return;}
  const endpoints=data().nodes.map(n=>[n.id,n.id+' · '+n.name]),old=data().edges.find(e=>DSM.ek(e)===DSM.ek({layer,from,to}));
  const input=fixed?'<p><b>'+esc(from)+' '+(layer==='flow'?'→':'↔')+' '+esc(to)+'</b></p>':sel('layer','Слой',[['flow','Вызовы'],['risk','Совместные проверки']],layer)+sel('from','Откуда',endpoints,from)+sel('to','Куда',endpoints,to);
  modal('Связь DSM',input+field('weight','Вес',fixed&&old?old.weight:1,'type="number" required min="1" step="1"')+field('reason','Основание',fixed&&old?old.reason:'','required')+(fixed&&old?'<label><input type="checkbox" name="remove"> Удалить эту связь</label>':''),async f=>{
    const value={layer:f.layer||layer,from:f.from||from,to:f.to||to,weight:Number(f.weight),reason:f.reason};
    await push(DSM.patch(data(),[{op:f.remove?'removeEdge':'edge',value}]),(f.remove?'Удаление':'Правка')+' связи '+value.from+' / '+value.to);
  });
}
function bulkForm(){
  const ids=[...selected],opts=[['__keep','Сохранить текущее'],['','Вернуть в бэклог'],...data().nodes.filter(n=>n.kind==='release').map(n=>[n.id,n.name])];
  modal('Групповая правка фич',hint(esc(ids.join(' · ')))+sel('release','Релиз',opts,'__keep')+sel('state','Состояние',[['__keep','Сохранить текущее'],...Object.entries(states)],'__keep')+field('bundle','Объединить в пакет (пусто — пропустить)')+field('segment','Общий сегмент (пусто — пропустить)'),async f=>{
    const set={};for(const k of ['state','release'])if(f[k]!=='__keep')set[k]=f[k];
    for(const k of ['bundle','segment'])if(f[k].trim())set[k]=f[k].trim();
    if(!Object.keys(set).length)throw Error('Укажите хотя бы одно изменение');
    await push(DSM.patch(data(),ids.map(id=>({op:'node',value:{id,...set}}))),'Групповая правка '+ids.join(', '));selected.clear();render();
  });
}
async function exportAs(k){const stem='dsm-'+short(base()),m=data(),types={html:'text/html',md:'text/markdown',csv:'text/csv',json:'application/json',ipynb:'application/x-ipynb+json',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  const payload=k==='sysl'?Sysl.write(m):k==='xlsx'?await ExcelIO.write(doc):k==='html'?dynamicHtml(doc):k==='md'?Formats.markdown(doc):k==='csv'?Formats.emitCsv(doc):JSON.stringify(k==='ipynb'?Notebook.write(doc):doc,null,2);
  download(stem+'.'+k,payload,types[k]);}
function proposed(input,source=''){
  const archive=input.kind==='archive';const next=Formats.preview(doc,input);
  const changes=DSM.diff(data(),next);
  const title=archive?'Открыть проект с историей':'Проверить изменения';
  const body=hint(esc(next.title)+' · '+next.nodes.length+' объектов · '+next.edges.length+' связей')+(archive?hint('Откроется отдельная копия проекта с '+input.doc.history.length+' верс.'):hint('Список изменений относительно текущей версии.'))+Views.differences(changes)+(!archive?importSummary(next,changes)+field('actor','Автор','Редактор','required')+field('note','Описание изменения',source?'Импорт · '+source:'Импорт данных','required'):'');
  modal(title,body,async f=>{
    if(archive){
      if(server){download('project.html',dynamicHtml(input.doc),'text/html');toast('Скачан автономный редактор с выбранным проектом');return;}
      doc=input.doc;cacheKey='mazzy.dsm.1/'+doc.project+'/'+base();try{localStorage.setItem(entryKey,cacheKey);}catch{}cache();resetView();navigate('matrix');toast('Проект открыт');
    }else{if(!changes.length)throw Error('Изменений нет');await push(next,f.note,f.actor);}
  },archive?(server?'Скачать отдельный HTML':'Открыть проект'):'Применить и сохранить');
  $('accept').disabled=!archive&&!changes.length;
}
function importSummary(next,changes){
  const before=new Map(DSM.plan(data()).map(r=>[r.id,r])),after=new Map(DSM.plan(next).map(r=>[r.id,r]));
  const load=r=>r?r.knownEffort+' / '+(r.capacity??'—')+(r.unknown?' · без оценки '+r.unknown:''):'—';
  const rows=[];
  for(const id of new Set([...before.keys(),...after.keys()])){
    const was=load(before.get(id)),will=load(after.get(id));
    if(was!==will)rows.push([esc(id),was,will]);
  }
  const added=changes.filter(c=>c.before===null).length,removed=changes.filter(c=>c.after===null).length;
  return '<p>Добавлено '+added+' · изменено '+(changes.length-added-removed)+' · удалено '+removed+'</p>'+(rows.length?table(['Релиз','Было · загрузка / ёмкость','Станет · загрузка / ёмкость'],rows):'');
}
async function parseInput(ext,txt,bytes,source){
  if(typeof txt==='string')txt=txt.replace(/^\uFEFF/,'');
  const opts={layer:$('importLayer')?.value||'flow',source};
  if(ext==='zip')return {kind:'spec-package',files:await Specifications.openPackage(bytes)};
  if(ext==='xlsx')return ExcelIO.read(bytes,opts);
  if(ext==='json')return Formats.parseJson(JSON.parse(txt),source);
  if(ext==='html'){const n=new DOMParser().parseFromString(txt,'text/html').querySelector('script#project-data[type="application/json"]');if(!n)throw Error('В HTML нет снимка DSM');return Formats.parseJson(JSON.parse(n.textContent));}
  if(ext==='ipynb')return Notebook.read(JSON.parse(txt));
  if(ext==='csv'||ext==='tsv')return Formats.readCsv(txt,opts);if(ext==='md')return Formats.readMd(txt);if(ext==='txt')return Formats.readText(txt,opts);
  throw Error('Формат файла не поддерживается');
}
$('file').onchange=async()=>{try{const f=$('file').files[0];if(!f)return;const k=f.name.split('.').pop().toLowerCase();proposed(await parseInput(k,['xlsx','zip'].includes(k)?'':await f.text(),['xlsx','zip'].includes(k)?await f.arrayBuffer():null,f.name),f.name);}catch(e){toast(e.message);}finally{$('file').value='';}};
$('newProject').onclick=()=>modal('Новый проект',field('title','Название','','required')+sel('template','Шаблон',[['empty','Пустой проект'],['enterprise','Архитектура предприятия · закупки и установка']],'empty')+hint(server?'Будет создан отдельный автономный HTML.':'Откроется пустой проект. Сохраните текущий JSON, чтобы вернуться к его истории.'),async f=>{
  const next=DSM.create(f.template==='enterprise'?Enterprise.model(f.title):{title:f.title,nodes:[],edges:[]});
  if(server){download('new-project.html',dynamicHtml(next),'text/html');return;}
  download('previous-project.json',JSON.stringify(doc,null,2),'application/json');doc=next;cacheKey='mazzy.dsm.1/'+doc.project+'/'+base();try{localStorage.setItem(entryKey,cacheKey);}catch{}cache();resetView();journey.set('');navigate('journey');
},'Создать');
$('save').onclick=()=>exportAs('json');
document.addEventListener('click',async e=>{const t=e.target.closest('[data-action]');if(!t)return;const action=t.dataset.action,id=t.dataset.id;
  try{
    if(action==='graphBoundary'){boundaryOpen=!boundaryOpen;pages.boundary=0;render();return;}
    if(action==='beginDelivery'){navigate('journey');await journey.handle('Requirement');return;}
    if(action==='diffPage'){t.closest('.paged-diff').outerHTML=Views.diffPage(Number(t.dataset.page));return;}
    if(action==='page'){if(Object.hasOwn(pages,id))pages[id]=Number(t.dataset.page);render();return;}
    if(action==='jumpPair'){
      const from=$('rowJump').value.trim(),to=$('colJump').value.trim();
      if(!nodeBy(from)||!nodeBy(to))throw Error('Выберите два ID из каталога');
      if(from===to){focus=from;pair=null;segment='';locatePair(from,to);render();}else showPair(from,to,'matrix');return;
    }
    if(action==='clearCatalog'){resetCatalog();render();}
    if(action==='catalogCsv'){
      const entries=visibleCatalog(),cols=registry==='nodes'?[...DSM.nodeCols,...DSM.optionalNodeCols]:registry==='structure'?['from','to','layer','reason']:DSM.edgeCols;
      download('dsm-'+registry+'-'+short(base())+'.csv',Formats.csv([cols,...entries.map(r=>cols.map(k=>r[k]&&typeof r[k]==='object'?JSON.stringify(r[k]):r[k]??''))]),'text/csv');
    }
    if(action==='changeLog'){
      const versions=doc.history.map((h,i)=>[h.rev,(i+1)+' · '+h.note]);
      modal('Выгрузить журнал изменений',sel('from','После версии',versions,versions[0][0])+sel('to','До версии включительно',versions,base()),f=>download('changes.md',Changes.changeLog(doc,f.from,f.to),'text/markdown'),'Скачать');
    }
    if(action==='tab')navigate(id);
    if(action==='workMode')navigate(lastTab[id]);
    if(action==='grid')gridInput();
    if(action==='registry'){registry=id;filter='';pages.catalog=0;render();}
    if(action==='objectRow'){registry='nodes';resetCatalog();focus=id;pair=null;navigate('catalog');}
    if(action==='pairView'&&pair)showPair(...pair,id);
    if(action==='demoCell'){layer='risk';showPair('F02','F03','matrix');}
    if(action==='demoPlan'){selected.clear();selected.add('F03');navigate('plan');}
    if(action==='document')nodeForm(null,id);
    if(action==='scenarioView'){scenarioId=id;graphMode='sequence';layer='flow';pair=null;navigate('graph');}
    if(action==='makeScenario')nodeForm(null,'scenario');
    if(action==='appendStep'){const v=$('stepChoice').value,area=$('fields').querySelector('[name=steps]');if(v)area.value=[area.value.trim(),v].filter(Boolean).join('\n');}
    if(action==='documentDownload')download(id+'.md',Specifications.document(nodeBy(id)),'text/markdown');
    if(action==='applySpec')applySpec(id);
    if(action==='specZip')download(id+'.zip',await Specifications.bundle(doc,id),'application/zip');
    if(action==='svg'){const drawing=$('content').querySelector('svg');if(drawing)download('dsm-'+graphMode+'-'+short(base())+'.svg',new XMLSerializer().serializeToString(drawing),'image/svg+xml');}
    if(action.startsWith('journey'))await journey.handle(action.slice(7),id);
    if(action.startsWith('desk'))await desk.handle(action.slice(4),id);
    if(action.startsWith('book'))await books.handle(action.slice(4),id);
    if(action==='layer'){structure=null;layer=id;pair=null;render();}
    if(action==='focus'){structure=null;focus=id;pair=null;render();}
    if(action==='structure'){
      structure=Views.structures(data()).find(s=>s.from===id&&s.to===t.dataset.to&&s.layer===t.dataset.layer)||null;
      focus=id;pair=null;render();
    }
    if(action==='structureView'&&structure){
      if(tab==='catalog'){graphMode='concept';navigate('graph');}
      else {registry='structure';filter='';navigate('catalog');}
    }
    if(action==='cell'){structure=null;if(t.dataset.layer)layer=t.dataset.layer;focus=id;pair=[id,t.dataset.to];render();}
    if(action==='node'||action==='edit')nodeForm(id);
    if(action==='edge'||action==='newEdge')edgeForm(action==='edge');
    if(action==='bulk')bulkForm();
    if(action==='open')$('file').click();
    if(action==='parse')proposed(await parseInput($('rawType').value,$('raw').value,null,'Буфер обмена'),'Буфер обмена');
    if(action==='export')await exportAs(id);
    if(action==='snapshot')modal('Именованный снимок',field('note','Название снимка','','required'),f=>push(data(),f.note));
    if(action==='restore'){const h=doc.history.find(h=>h.rev===id);modal('Восстановить версию '+short(id),hint(esc(h.note))+Views.differences(DSM.diff(data(),h.data)),()=>push(h.data,'Восстановление '+id));}
    if(action==='diff'){const h=doc.history.find(h=>h.rev===id),p=doc.history.find(x=>x.rev===h.parent);
      modal('Сравнение версий',sel('other','Сравнить выбранную версию с',doc.history.map((x,i)=>[x.rev,(i+1)+' · '+x.note]),p?.rev||id)+'<div id="difference"></div>',async()=>{},'Закрыть');
      const select=$('fields').querySelector('select'),show=()=>{$('difference').innerHTML=Views.differences(DSM.diff(doc.history.find(x=>x.rev===select.value).data,h.data));};select.onchange=show;show();}
    if(action==='context')download('agent-context.md','# '+data().title+'\n\n'+Formats.markdown(doc)+'\n\nПеред записью прочитайте актуальный JSON. Сформируйте JSON-патч с полями project, base, ops и описанием, проверьте его через preview, затем примените. При конфликте перечитайте проект и покажите разницу.\n','text/markdown');
  }catch(err){toast(err.message);}
});
document.addEventListener('keydown',e=>{
  if(!e.target.matches('.matrix .cell'))return;
  const order=matrixOrder();
  let y=order.indexOf(e.target.dataset.id),x=order.indexOf(e.target.dataset.to);
  switch(e.key){
    case 'ArrowUp': y--;break;
    case 'ArrowDown': y++;break;
    case 'ArrowLeft': x--;break;
    case 'ArrowRight': x++;break;
    case 'Home': x=0;break;
    case 'End': x=order.length-1;break;
    default:return;
  }
  e.preventDefault();
  y=Math.max(0,Math.min(y,order.length-1));x=Math.max(0,Math.min(x,order.length-1));
  const rowPage=Math.floor(y/32),colPage=Math.floor(x/32);
  if(rowPage!==pages.rows||colPage!==pages.cols){pages.rows=rowPage;pages.cols=colPage;render();}
  const row=$('content').querySelector('.matrix tbody').rows[y%32];
  row.cells[1+x%32].querySelector('.cell').focus();
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('g[role=button]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
document.addEventListener('change',e=>{const t=e.target;if(t.id.startsWith('catalog-')){catalogFilters[t.id.slice(8)]=t.value;pages.catalog=0;}else if(t.id.startsWith('history-'))historyFilters[t.id.slice(8)]=t.type==='checkbox'?t.checked:t.value;else if(t.id==='order')ordered=t.value==='group';else if(t.id==='segment'){segment=t.value;pages.rows=pages.cols=0;}else if(t.id==='focusSelect'){focus=t.value;pair=null;pages.drawing=0;if(!['neighbors','sequence'].includes(graphMode)){const scoped=Scope.graph(data(),graphMode,layer,focus,null,graphMode==='all'?getAnalysis().groups:[],0,null);pages.drawing=scoped.focusPage;}}else if(t.id==='graphMode'){graphMode=t.value;pages.drawing=0;if(graphMode==='sequence'){layer='flow';pair=null;}}else if(t.id==='scenarioSelect'){scenarioId=t.value;pages.drawing=0;pair=null;}else if(t.dataset.check){if(t.checked)selected.add(t.dataset.check);else selected.delete(t.dataset.check);}else return;render();});
document.addEventListener('input',e=>{if(e.target.id==='history-text'){historyFilters.text=e.target.value;render();$('history-text').focus();}if(e.target.id==='query'){pages.catalog=0;filter=e.target.value;render();$('query').focus();$('query').setSelectionRange(filter.length,filter.length);}});
async function sync(){const prior=base();if(!server||$('dialog').open||tab==='io'||document.activeElement?.id==='query')return;
  try{const r=await fetch('/api/head',{cache:'no-store'});if(!r.ok)return;const info=await r.json();if(info.rev!==base()||info.project&&info.project!==doc.project){const full=await fetch('/api/project',{cache:'no-store'});const update=DSM.document(await full.json());if($('dialog').open||base()!==prior)return;doc=update;if(!nodeBy(focus))resetView(false);render();toast('Получена версия агента · '+short(base()));}}catch{}}
function readLocation(){
  const [view,query]=location.hash.slice(1).split('?');
  if(!Object.hasOwn(tabs,view))return false;
  if(view==='journey'){
    const params=new URLSearchParams(query);
    const id=params.get('requirement');
    const same=!params.get('project')||params.get('project')===doc.project;
    journey.set(same?id:'');
    if(id&&(!same||nodeBy(id)?.kind!=='requirement'))toast('Требование отсутствует в открытом проекте');
  }
  navigate(view,false);return true;
}
async function start(){
  if(location.protocol==='http:'&&location.hostname==='127.0.0.1'&&location.pathname==='/'){
    try{const r=await fetch('/api/head',{cache:'no-store'});if(r.ok){const h=await r.json();if(h.rev!==base()||h.project&&h.project!==doc.project){const update=await fetch('/api/project',{cache:'no-store'});doc=DSM.document(await update.json());}server=true;}}catch{}}
  if(!server){try{const active=localStorage.getItem(entryKey);if(active?.startsWith('mazzy.dsm.1/'))cacheKey=active;const c=localStorage.getItem(cacheKey);if(c){const saved=DSM.document(JSON.parse(c));if(active||saved.project===embedded.project&&saved.history.some(h=>h.rev===DSM.head(embedded).rev))doc=saved;}}catch{cacheOK=false;}}
  resetView();if(!readLocation()){if(tab==='matrix'&&(!data().nodes.length||data().nodes.some(n=>n.kind==='requirement')))tab='journey';render();}if(server)setInterval(sync,1800);
  window.addEventListener('hashchange',readLocation);
  window.addEventListener('storage',e=>{if(!server&&e.key===cacheKey&&e.newValue){if($('dialog').open||!cacheOK){toast('Есть новая версия в другой вкладке. Сохраните свою копию в JSON.');return;}try{const incoming=DSM.document(JSON.parse(e.newValue));const switched=incoming.project!==doc.project;doc=incoming;if(switched||!nodeBy(focus))resetView(switched);render();toast('Получена версия из другой вкладки');}catch{}}});
}
start();
})();
