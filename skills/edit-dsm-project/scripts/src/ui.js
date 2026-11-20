(() => {
'use strict';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const embedded=DSM.document(JSON.parse($('project-data').textContent));
const original='<!doctype html>\n'+document.documentElement.outerHTML;
const tabs={matrix:'Матрица',graph:'Граф и схема',catalog:'Каталог',plan:'Релизы и фичи',history:'Версии',io:'Обмен'};
const kinds={product:'Продукт',module:'Модуль',component:'Компонент',release:'Релиз',feature:'Фича'};
const states={idea:'Идея',planned:'Запланировано',active:'В работе',review:'Проверка',blocked:'Заблокировано',done:'Готово',unspecified:'Не задано'};
let doc=embedded,server=false,cacheKey='mazzy.dsm.1/'+embedded.project+'/'+DSM.head(embedded).rev,cacheOK=true;
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
const nodeBy=id=>data().nodes.find(n=>n.id===id);
function toast(s){$('toast').textContent=s;const v=++counter;setTimeout(()=>{if(v===counter)$('toast').textContent='';},6000);}
function download(name,content,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function dynamicHtml(value){return original.replace(/(<script type="application\/json" id="project-data">)[\s\S]*?(<\/script>)/,(_,a,z)=>a+JSON.stringify(value).replaceAll('<','\\u003c')+z);}
function getAnalysis(){const key=base()+layer;if(!analysisCache.has(key)){analysisCache.clear();analysisCache.set(key,Analysis.calculate(data(),layer));}return analysisCache.get(key);}
function resetView(){pair=null;selected.clear();focus=(data().nodes.find(n=>n.kind==='feature')||data().nodes[0])?.id||'';segment='';filter='';}
function cache(){
  if(server)return;
  try{localStorage.setItem(cacheKey,JSON.stringify(doc));cacheOK=true;}catch{cacheOK=false;toast('Кэш браузера недоступен. Сохраните проект в JSON.');}
}
async function push(next,note,actor='Редактор',expected=dialogBase||base()){
  if(expected!==base())throw Error('Проект изменился с момента открытия формы. Скопируйте правку, закройте форму и сравните версии.');
  if(server){
    const r=await fetch('/api/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:doc.project,base:expected,note,actor,data:next})});
    const res=await r.json();if(!r.ok)throw Error(res.error);doc=DSM.document(res);
  }else{
    const saveLocal=()=>{let stored=null;try{stored=localStorage.getItem(cacheKey);}catch{}
      if(stored&&DSM.head(JSON.parse(stored)).rev!==expected)throw Error('Другая вкладка уже сохранила изменения. Обновите страницу и сравните версии.');
      doc=DSM.commit(doc,next,expected,note,actor);cache();};
    if(navigator.locks)await navigator.locks.request(cacheKey,saveLocal);else saveLocal();
  }
  render();toast('Версия сохранена · '+short(base()));
}
function modal(title,html,onSubmit,label='Сохранить версию'){dialogBase=base();$('dlgTitle').textContent=title;$('fields').innerHTML=html;$('formError').textContent='';$('accept').textContent=label;submit=onSubmit;$('dialog').showModal();}
function close(){submit=null;dialogBase=null;$('dialog').close();}
$('cancel').onclick=$('close').onclick=close;$('dialog').addEventListener('close',()=>{submit=null;dialogBase=null;});
$('form').onsubmit=async e=>{e.preventDefault();$('accept').disabled=true;try{await submit(Object.fromEntries(new FormData(e.target)));close();}catch(err){$('formError').textContent=err.message;}finally{$('accept').disabled=false;}};
function shell(content){
  $('title').textContent=data().title;$('summary').textContent=(data().nodes.some(n=>n.kind==='product'&&n.note.startsWith('Вымышленный терминальный помощник в духе Qwen Code.'))?'Учебный пример в духе Qwen Code · ':'')+data().nodes.length+' объектов · '+data().edges.filter(x=>x.layer==='flow').length+' вызовов · '+data().edges.filter(x=>x.layer==='risk').length+' пар совместной проверки';
  $('mode').textContent=server?'Связь с локальным агентом':cacheOK?'Локальный проект':'Требуется выгрузка JSON';
  $('revision').textContent='Версия '+doc.history.length+' · '+short(base());
  $('nav').innerHTML=Object.entries(tabs).map(([k,v])=>b('tab',v,'class="'+(k===tab?'on':'')+'" data-id="'+k+'"')).join('');
  $('content').innerHTML=content;
}
function layerControl(){return '<div class="toggle">'+[['flow','Вызовы'],['risk','Совместные проверки']].map(([k,v])=>b('layer',v,'data-id="'+k+'" class="'+(k===layer?'on':'')+'"')).join('')+'</div>';}
function inspector(){
  const n=nodeBy(focus);if(!n)return '<aside class="card"><h3>Первый объект</h3>'+b('node','Добавить объект')+'</aside>';
  const e=pair&&data().edges.find(x=>DSM.ek(x)===DSM.ek({layer,from:pair[0],to:pair[1]}));
  const impact=Analysis.impact(data(),n.id),a=getAnalysis();
  let box='<div class="eyebrow">ИНСПЕКТОР</div><h2>'+esc(n.name)+'</h2><p><span class="tag">'+esc(n.id)+'</span> '+esc(kinds[n.kind])+'</p>';
  if(pair){box+='<div class="callout"><b>'+esc(pair.join(layer==='flow'?' → ':' ↔ '))+'</b><br>'+esc(e?.reason||'В этой ячейке связь ещё не описана.')+'</div>'+b('edge',e?'Изменить связь':'Создать связь');}
  else {box+=hint(esc(n.note)||'Выберите ячейку матрицы, чтобы увидеть основание связи.')+b('edit','Изменить объект','data-id="'+esc(n.id)+'"');}
  return '<aside><div class="card">'+box+'</div><div class="card"><h3>Влияние изменения</h3>'+hint('Транзитивные потребители контракта '+esc(n.id))+toolbar(impact.dependents.map(idButton))+(impact.dependents.length?'':hint('Потребителей нет.'))+'<div class="pair"><span>Прямые совместные проверки</span><b>'+impact.checks.length+'</b></div></div><div class="card"><h3>Разбиение по связям</h3>'+hint('Группы с положительным приростом модулярности Q.')+a.groups.map((g,i)=>'<div class="cluster"><b>Группа '+(i+1)+'</b> · '+esc(g.join(' · '))+'</div>').join('')+'</div></aside>';
}
function matrix(){
  const d=data(),a=getAnalysis(),order=(ordered?a.order:d.nodes.map(n=>n.id)).filter(id=>!segment||nodeBy(id).segment===segment);
  const values=Analysis.matrix(d,layer,order),segments=[...new Set(d.nodes.map(n=>n.segment).filter(Boolean))];
  const head='<thead><tr><th></th>'+order.map(id=>'<th title="'+esc(nodeBy(id).name)+'">'+esc(id)+'</th>').join('')+'</tr></thead>';
  const body=order.map((from,i)=>'<tr><th class="label">'+b('focus',esc(from),'title="'+esc(nodeBy(from).name)+'" data-id="'+esc(from)+'"')+'</th>'+order.map((to,j)=>{
    const w=values[i][j],active=pair&&pair[0]===from&&pair[1]===to;
    return '<td>'+b(i===j?'focus':'cell',i===j?'·':w||'','aria-label="'+esc(from+' / '+to+' / '+w)+'" title="'+esc(from+' / '+to+' · '+w)+'" data-id="'+esc(from)+'" data-to="'+esc(to)+'" class="cell '+(i===j?'diag':'w'+Math.min(3,w))+(active?' active':'')+'"')+'</td>';
  }).join('')+'</tr>').join('');
  return '<div class="board"><article class="card"><div class="cardhead"><div><h2>Матрица зависимостей</h2>'+hint(layer==='flow'?'Строка вызывает столбец. Нажмите ячейку для правки.':'Вес совместной проверки показан по обе стороны диагонали.')+'</div></div>'+layerControl()+'<div class="tools"><select id="order" aria-label="Порядок матрицы">'+option('initial','Исходный порядок',ordered?'':'initial')+option('group','По кластерам',ordered?'group':'')+'</select><select id="segment" aria-label="Сегмент">'+option('','Все сегменты',segment)+segments.map(s=>option(s,s,segment)).join('')+'</select></div><div class="wrap"><table class="matrix">'+head+'<tbody>'+body+'</tbody></table></div><div class="legend">'+[['#edf2ef','Нет связи'],['#a9ddbd','Вес 1'],['#58ac87','Вес 2'],['#106849','Вес 3+']].map(([c,t])=>'<span><i style="background:'+c+'"></i>'+t+'</span>').join('')+'</div><div class="metricline"><span>Длина L <b>'+a.cost_before+' → '+a.cost_after+'</b></span><span>Межгрупповые связи <b>'+a.cross_links+'</b></span><span>Q <b>'+a.modularity.toFixed(3)+'</b></span></div>'+hint('Показатели рассчитаны для полного слоя. Фильтр сегмента меняет область просмотра.')+'</article>'+inspector()+'</div>';
}
function graph(){
  const d=data(),n=nodeBy(focus),hier=graphMode==='tree';let edges=hier?d.nodes.filter(x=>x.parent).map(x=>({from:x.parent,to:x.id,reason:'Входит в состав',weight:1})):d.edges.filter(e=>e.layer===layer&&(graphMode==='all'||e.from===focus||e.to===focus));
  const used=new Set(edges.flatMap(e=>[e.from,e.to]));if(focus)used.add(focus);
  const ids=(graphMode==='neighbors'?d.nodes.filter(x=>used.has(x.id)):d.nodes).map(n=>n.id);
  let groups=[];
  if(hier){for(const id of ids){let p=nodeBy(id),level=0;while(p.parent){p=nodeBy(p.parent);level++;}(groups[level]??=[]).push(id);}}
  else if(graphMode==='neighbors'){groups=layer==='flow'?[ids.filter(id=>id!==focus&&edges.some(e=>e.from===id)),[focus].filter(Boolean),ids.filter(id=>id!==focus&&!edges.some(e=>e.from===id))]:[[focus].filter(Boolean),ids.filter(id=>id!==focus)];}
  else groups=getAnalysis().groups;
  groups=groups.filter(g=>g?.length);
  const colwidth=166,maxRows=Math.max(1,...groups.map(g=>g.length)),height=maxRows*63+44,width=Math.max(425,groups.length*colwidth+40),positions=new Map();
  groups.forEach((g,j)=>g.forEach((id,i)=>positions.set(id,[30+j*colwidth,20+(maxRows-g.length)*30+i*63])));
  const paths=edges.map(e=>{const [x,y]=positions.get(e.from),[u,v]=positions.get(e.to);
    const same=x===u, right=u>x, x1=x+(same?122:right?122:0),x2=u+(same?122:right?0:122);
    const path=same?'M '+x1+' '+(y+16)+' C '+(x1+26)+' '+(y+16)+' '+(x2+26)+' '+(v+16)+' '+x2+' '+(v+16):'M '+x1+' '+(y+16)+' C '+((x1+x2)/2)+' '+(y+16)+' '+((x1+x2)/2)+' '+(v+16)+' '+x2+' '+(v+16);
    return '<path d="'+path+'" fill="none" stroke="'+(hier?'#8f9d91':'#6aab91')+'" stroke-width="'+Math.min(3,e.weight)+'" '+(layer==='flow'||hier?'marker-end="url(#arrow)"':'')+'><title>'+esc(e.from+' → '+e.to+' · '+e.reason)+'</title></path>';
  }).join('');
  const boxes=ids.map(id=>{const [x,y]=positions.get(id),active=id===focus,nd=nodeBy(id);return '<g role="button" tabindex="0" data-action="focus" data-id="'+esc(id)+'" transform="translate('+x+','+y+')"><title>'+esc(nd.name)+'</title><rect width="122" height="35" rx="6" fill="'+(active?'#145c45':'#e8f3ed')+'" stroke="#8eb9a7"/><text x="8" y="14" font-size="11" font-weight="bold" fill="'+(active?'white':'#114c37')+'">'+esc(id)+'</text><text x="8" y="27" font-size="9" fill="'+(active?'#d8f5e6':'#34594b')+'">'+esc(nd.name.length>19?nd.name.slice(0,18)+'…':nd.name)+'</text></g>';}).join('');
  return '<div class="board"><article class="card"><h2>Граф и схема состава</h2>'+hint(hier?'Стрелка ведёт от родителя к дочернему элементу.':'Выберите объект, чтобы изучить его окружение.')+'<div class="tools"><select id="graphMode" aria-label="Вид графа">'+[['neighbors','Окружение объекта'],['all','Полный граф'],['tree','Иерархия состава']].map(x=>option(...x,graphMode)).join('')+'</select>'+(!hier?layerControl():'')+'</div><select id="focusSelect" aria-label="Фокус графа">'+d.nodes.map(n=>option(n.id,n.id+' · '+n.name,focus)).join('')+'</select><div class="graphbox"><svg viewBox="0 0 '+width+' '+height+'" aria-label="Схема зависимостей"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#499374"/></marker></defs>'+paths+boxes+'</svg></div></article>'+inspector()+'</div>';
}
function catalog(){
  const rows=data().nodes.filter(n=>(n.id+' '+n.name+' '+n.segment).toLowerCase().includes(filter.toLowerCase())).map(n=>[idButton(n.id),esc(n.name),kinds[n.kind],states[n.state],esc(n.parent||'—'),esc(n.release||'—'),esc(n.segment||'—'),b('edit','Изменить','class="tiny" data-id="'+esc(n.id)+'"')]);
  return '<div class="card"><div class="cardhead"><div><h2>Каталог объектов</h2>'+hint('Иерархию задаёт родитель объекта. Сегмент объединяет объекты разных типов.')+'</div>'+b('node','+ Объект','class="primary"')+'</div><div class="tools"><input id="query" placeholder="ID, название, сегмент" aria-label="Поиск" value="'+esc(filter)+'">'+b('newEdge','+ Связь')+'</div>'+table(['ID','Объект','Тип','Статус','Родитель','Релиз','Сегмент',''],rows)+'</div>';
}
function plan(){
  const releases=DSM.plan(data()),features=data().nodes.filter(n=>n.kind==='feature');
  const cards=releases.map(r=>'<div class="card"><span class="tag">'+esc(r.id)+'</span><h3>'+esc(r.name)+'</h3><div class="big">'+r.knownEffort+' / '+(r.capacity??'—')+'</div><div class="progress '+(r.capacity!==null&&r.knownEffort>r.capacity?'over':'')+'"><i style="width:'+Math.min(100,r.capacity?r.knownEffort/r.capacity*100:r.knownEffort?100:0)+'%"></i></div><div class="pair"><span>Без оценки</span><b>'+r.unknown+'</b></div><div class="pair"><span>Внешние вызовы / проверки</span><b>'+r.outgoing+' / '+r.crossChecks+'</b></div>'+ (r.capacity!==null&&r.knownEffort>r.capacity?'<span class="warn">Перегрузка на '+(r.knownEffort-r.capacity)+'</span>':'')+'</div>').join('');
  return '<div class="cols">'+cards+'</div><div class="card" style="margin-top:15px"><div class="cardhead"><div><h2>Планирование фич</h2>'+hint('Отметьте фичи для общего пакета, сегмента, релиза или перехода состояния. Оценки заданы в условных единицах.')+'</div>'+b('bulk','Изменить выбранные ('+selected.size+')',selected.size?'class="primary"':'disabled')+'</div>'+table(['Выбор','ID','Фича','Статус','Оценка','Релиз','Пакет'],features.map(n=>['<input type="checkbox" aria-label="Выбрать '+esc(n.id)+'" data-check="'+esc(n.id)+'" '+(selected.has(n.id)?'checked':'')+'>',esc(n.id),esc(n.name),states[n.state],n.effort??'—',esc(n.release||'Бэклог'),esc(n.bundle||'—')]))+b('node','+ Объект')+'</div>';
}
function describe(change){const v=change.after||change.before||{},type=change.before===null?'Добавлено':change.after===null?'Удалено':'Изменено';let fields='';
  if(change.before&&change.after&&typeof change.before==='object'&&!Array.isArray(change.before))fields=Object.keys(change.after).filter(k=>change.after[k]!==change.before[k]).map(k=>k+' '+(change.before[k]??'—')+' → '+(change.after[k]??'—')).join(', ');
  return type+' · '+(v.name||v.from&&v.from+' / '+v.to||change.key)+(fields?' · '+fields:'');}
function history(){return '<div class="card"><div class="cardhead"><div><h2>Версии проекта</h2>'+hint('Восстановление записывает новый снимок. У каждой версии есть автор, родитель и полный каталог.')+'</div>'+b('snapshot','+ Именованный снимок')+'</div>'+table(['Версия','Сохранено','Автор','Изменение',''],doc.history.map((h,i)=>[i+1+' · <code>'+short(h.rev)+'</code>',esc(new Date(h.at).toLocaleString('ru-RU')),esc(h.actor),esc(h.note),toolbar([b('diff','Сравнить','class="tiny" data-id="'+h.rev+'"'),...(h.rev!==base()?[b('restore','Восстановить','class="tiny" data-id="'+h.rev+'"')]:[])])]).reverse())+'</div>';}
function io(){return '<div class="cols"><div class="card"><h2>Загрузить данные</h2>'+hint('Откройте проект JSON или HTML с историей. Для обновления текущей версии выберите Markdown, CSV, Excel, блокнот или JSON-патч.')+b('open','Выбрать файл','class="primary"')+'<h3 style="margin-top:22px">Вставить исходный текст</h3>'+hint('Каталог: ID : название. Вызов: A -> B : основание. Совместная проверка: A ~ B [3] : основание. CSV принимает также заголовки на русском.')+'<textarea id="raw" aria-label="Исходный текст" placeholder="CLI : Интерфейс командной строки&#10;CFG : Настройки&#10;CLI -> CFG : Загрузить профиль"></textarea><div class="tools"><select id="rawType" aria-label="Формат текста"><option value="txt">Текстовый список</option><option value="csv">CSV</option><option value="md">Markdown</option><option value="json">JSON или патч</option></select>'+b('parse','Проверить импорт')+'</div><label class="field">Слой для CSV-матрицы или реестра без столбца layer<select id="importLayer">'+option('flow','Вызовы',layer)+option('risk','Совместные проверки',layer)+'</select></label></div><div class="card"><h2>Выгрузить версию</h2>'+hint('JSON и автономный HTML включают всю историю. В табличных представлениях записаны ID проекта и исходная ревизия. Отредактированную таблицу можно вернуть в ту же ревизию.')+'<div class="row export">'+['json','html','md','csv','xlsx','ipynb'].map(k=>b('export',k.toUpperCase(),'data-id="'+k+'"')).join('')+'</div><h3 style="margin-top:24px">Передать агенту</h3>'+hint('Передайте сохранённый JSON в чат или откройте его локальным CLI. Агент читает текущую версию и возвращает патч с тем же base.')+'<pre>'+esc(JSON.stringify({project:doc.project,base:base(),ops:[{op:'title',value:data().title}]},null,2))+'</pre>'+b('context','Скачать задание агенту')+'</div></div>';}
function render(){shell(({matrix,graph,catalog,plan,history,io})[tab]());}
function nodeForm(id=null){
  const n=id?nodeBy(id):{id:'',name:'',kind:'feature',state:'idea'},nodes=data().nodes,choices=nodes.filter(x=>x.id!==id).map(x=>[x.id,x.id+' · '+x.name]);
  modal(id?'Изменить объект':'Новый объект','<div class="fields2">'+field('id','Постоянный ID',n.id,id?'readonly':'required')+field('name','Название',n.name,'required')+sel('kind','Тип',Object.entries(kinds),n.kind)+sel('state','Состояние',Object.entries(states),n.state)+sel('parent','Родитель',[['','Нет'],...choices],n.parent||'')+sel('release','Релиз',[['','Бэклог'],...nodes.filter(x=>x.kind==='release'&&x.id!==id).map(x=>[x.id,x.name])],n.release||'')+field('segment','Сегмент',n.segment)+field('bundle','Пакет фич',n.bundle)+field('effort','Оценка работы',n.effort,'type="number" min="0" step="any"')+field('capacity','Ёмкость релиза',n.capacity,'type="number" min="0" step="any"')+'</div>'+field('note','Описание',n.note),async f=>{
    if(!id&&nodeBy(f.id))throw Error('Такой ID уже существует');
    for(const k of ['effort','capacity'])f[k]=f[k]===''?null:Number(f[k]);
    await push(DSM.patch(data(),[{op:'node',value:f}]),(id?'Изменение ':'Добавление ')+f.id);focus=f.id;pair=null;render();
  });
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
  const payload=k==='xlsx'?await ExcelIO.write(doc):k==='html'?dynamicHtml(doc):k==='md'?Formats.markdown(doc):k==='csv'?Formats.emitCsv(doc):JSON.stringify(k==='ipynb'?Notebook.write(doc):doc,null,2);
  download(stem+'.'+k,payload,types[k]);}
function proposed(input){
  const archive=input.kind==='archive';const next=Formats.preview(doc,input);
  const changes=DSM.diff(data(),next);
  const title=archive?'Открыть проект с историей':'Проверить изменения';
  const body=hint(esc(next.title)+' · '+next.nodes.length+' объектов · '+next.edges.length+' связей')+(archive?hint('Откроется отдельная копия проекта с '+input.doc.history.length+' верс.'):hint('Список изменений относительно текущей версии.'))+'<pre>'+esc(changes.map(describe).join('\n')||'Содержимое совпадает')+'</pre>';
  modal(title,body,async()=>{
    if(archive){
      if(server){download('project.html',dynamicHtml(input.doc),'text/html');toast('Скачан автономный редактор с выбранным проектом');return;}
      doc=input.doc;cacheKey='mazzy.dsm.1/'+doc.project+'/'+base();try{localStorage.setItem(entryKey,cacheKey);}catch{}cache();resetView();tab='matrix';render();toast('Проект открыт');
    }else{if(!changes.length)throw Error('Изменений нет');await push(next,'Импорт данных');}
  },archive?(server?'Скачать отдельный HTML':'Открыть проект'):'Применить и сохранить');
}
async function parseInput(ext,txt,bytes,source){
  const opts={layer:$('importLayer')?.value||'flow',source};
  if(ext==='xlsx')return ExcelIO.read(bytes,opts);
  if(ext==='json')return Formats.parseJson(JSON.parse(txt),source);
  if(ext==='html'){const n=new DOMParser().parseFromString(txt,'text/html').querySelector('script#project-data[type="application/json"]');if(!n)throw Error('В HTML нет снимка DSM');return Formats.parseJson(JSON.parse(n.textContent));}
  if(ext==='ipynb')return Notebook.read(JSON.parse(txt));
  if(ext==='csv'||ext==='tsv')return Formats.readCsv(txt,opts);if(ext==='md')return Formats.readMd(txt);if(ext==='txt')return Formats.readText(txt,opts);
  throw Error('Формат файла не поддерживается');
}
$('file').onchange=async()=>{try{const f=$('file').files[0];if(!f)return;const k=f.name.split('.').pop().toLowerCase();proposed(await parseInput(k,k==='xlsx'?'':await f.text(),k==='xlsx'?await f.arrayBuffer():null,f.name));}catch(e){toast(e.message);}finally{$('file').value='';}};
$('newProject').onclick=()=>modal('Новый проект',field('title','Название','','required')+hint(server?'Будет создан отдельный автономный HTML.':'Откроется пустой проект. Сохраните текущий JSON, чтобы вернуться к его истории.'),async f=>{
  const next=DSM.create({title:f.title,nodes:[],edges:[]});
  if(server){download('new-project.html',dynamicHtml(next),'text/html');return;}
  download('previous-project.json',JSON.stringify(doc,null,2),'application/json');doc=next;cacheKey='mazzy.dsm.1/'+doc.project+'/'+base();try{localStorage.setItem(entryKey,cacheKey);}catch{}cache();resetView();tab='catalog';render();
},'Создать');
$('save').onclick=()=>exportAs('json');
document.addEventListener('click',async e=>{const t=e.target.closest('[data-action]');if(!t)return;const action=t.dataset.action,id=t.dataset.id;
  try{
    if(action==='tab'){tab=id;render();}
    if(action==='layer'){layer=id;pair=null;render();}
    if(action==='focus'){focus=id;pair=null;if(tab==='catalog')tab='graph';render();}
    if(action==='cell'){focus=id;pair=[id,t.dataset.to];render();}
    if(action==='node'||action==='edit')nodeForm(id);
    if(action==='edge'||action==='newEdge')edgeForm(action==='edge');
    if(action==='bulk')bulkForm();
    if(action==='open')$('file').click();
    if(action==='parse')proposed(await parseInput($('rawType').value,$('raw').value,null,'Буфер обмена'));
    if(action==='export')await exportAs(id);
    if(action==='snapshot')modal('Именованный снимок',field('note','Название снимка','','required'),f=>push(data(),f.note));
    if(action==='restore'){const h=doc.history.find(h=>h.rev===id);modal('Восстановить версию '+short(id),hint(esc(h.note))+'<pre>'+esc(DSM.diff(data(),h.data).map(describe).join('\n'))+'</pre>',()=>push(h.data,'Восстановление '+id));}
    if(action==='diff'){const h=doc.history.find(h=>h.rev===id),p=doc.history.find(x=>x.rev===h.parent);
      modal('Сравнение версий',sel('other','Сравнить выбранную версию с',doc.history.map((x,i)=>[x.rev,(i+1)+' · '+x.note]),p?.rev||id)+'<pre id="difference"></pre>',async()=>{},'Закрыть');
      const select=$('fields').querySelector('select'),show=()=>{$('difference').textContent=DSM.diff(doc.history.find(x=>x.rev===select.value).data,h.data).map(describe).join('\n')||'Модели совпадают';};select.onchange=show;show();}
    if(action==='context')download('agent-context.md','# '+data().title+'\n\n'+Formats.markdown(doc)+'\n\nПеред записью прочитайте актуальный JSON. Сформируйте JSON-патч с полями project, base, ops и описанием, проверьте его через preview, затем примените. При конфликте перечитайте проект и покажите разницу.\n','text/markdown');
  }catch(err){toast(err.message);}
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('g[role=button]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
document.addEventListener('change',e=>{const t=e.target;if(t.id==='order')ordered=t.value==='group';else if(t.id==='segment')segment=t.value;else if(t.id==='focusSelect'){focus=t.value;pair=null;}else if(t.id==='graphMode')graphMode=t.value;else if(t.dataset.check){if(t.checked)selected.add(t.dataset.check);else selected.delete(t.dataset.check);}else return;render();});
document.addEventListener('input',e=>{if(e.target.id==='query'){filter=e.target.value;render();$('query').focus();$('query').setSelectionRange(filter.length,filter.length);}});
async function sync(){if(!server||$('dialog').open||tab==='io'||document.activeElement?.id==='query')return;
  try{const r=await fetch('/api/head',{cache:'no-store'});if(!r.ok)return;const info=await r.json();if(info.rev!==base()){const full=await fetch('/api/project',{cache:'no-store'});doc=DSM.document(await full.json());if(!nodeBy(focus))resetView();render();toast('Получена версия агента · '+short(base()));}}catch{}}
async function start(){
  if(location.protocol==='http:'&&location.hostname==='127.0.0.1'&&location.pathname==='/'){
    try{const r=await fetch('/api/project',{cache:'no-store'});if(r.ok){doc=DSM.document(await r.json());server=true;}}catch{}}
  if(!server){try{const active=localStorage.getItem(entryKey);if(active?.startsWith('mazzy.dsm.1/'))cacheKey=active;const c=localStorage.getItem(cacheKey);if(c){const saved=DSM.document(JSON.parse(c));if(active||saved.project===embedded.project&&saved.history.some(h=>h.rev===DSM.head(embedded).rev))doc=saved;}}catch{cacheOK=false;}}
  resetView();render();if(server)setInterval(sync,1800);
  window.addEventListener('storage',e=>{if(!server&&e.key===cacheKey&&e.newValue){if($('dialog').open){toast('Есть новая версия в другой вкладке');return;}try{doc=DSM.document(JSON.parse(e.newValue));resetView();render();toast('Получена версия из другой вкладки');}catch{}}});
}
start();
})();
