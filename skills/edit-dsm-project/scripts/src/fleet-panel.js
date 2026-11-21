function fleetPanel({doc,esc,b,option,sel,field,table,modal,push,render,download,navigate,toast,notebook,matrix,graph}){
  let root='',step='sources',key='resilient',group='site',layer='flow',budget=null,plan='';
  const stages={sources:'Источники',stock:'Текущий парк',options:'Варианты и резерв',decision:'ADR и релиз',report:'Отчёт'};
  const categories={catalog:'Каталог',requirements:'Требования',specifications:'Спецификации',contracts:'Связи DSM'};
  const money=v=>v==null?'—':v.toLocaleString('ru-RU')+' ₽';
  const model=()=>DSM.head(doc()).data;
  const node=id=>model().nodes.find(n=>n.id===id);
  const idAttr=id=>'data-id="'+esc(id)+'"';
  const act=(name,label,id='')=>b('fleet'+name,label,idAttr(id));
  const card=id=>b('objectRow',esc(id),'class="tiny" '+idAttr(id));
  const ids=values=>values.map(card).join(' ')||'—';
  const linkRows=()=>FleetChange.linked(model(),root);
  const section=(title,body)=>'<section class="card"><h2>'+title+'</h2>'+body+'</section>';
  const bar=items=>'<div class="tools">'+items.join('')+'</div>';
  const choices=nodes=>nodes.map(n=>[n.id,n.name+' · '+n.id]);
  const select=(id,title,options,current)=>'<label class="field">'+title+'<select id="'+id+'">'+options.map(([v,l])=>option(v,l,current)).join('')+'</select></label>';
  const number=(k,label,val,min=0)=>field(k,label,val,'type="number" min="'+min+'" step="1" required');
  const txt=(k,label)=>'<label class="field">'+label+'<textarea name="'+k+'" required></textarea></label>';
  function current(){const roots=model().nodes.filter(n=>n.kind==='procurement');if(!roots.some(n=>n.id===root))root=roots[0]?.id||'';return roots;}
  function owner(n){
    const m=model(),roots=m.nodes.filter(x=>x.kind==='procurement');
    for(const r of roots.sort((a,b)=>(b.id===root)-(a.id===root))){
      const sites=Fleet.ids(r,'uses'),scope=new Set([r.id,...sites]);
      if(scope.has(n.id)||scope.has(n.parent)||(n.refs||[]).some(id=>scope.has(id))||Fleet.ids(n,'deployedOn').some(id=>scope.has(id)))return r.id;
      const rows=m.nodes.filter(x=>sites.includes(x.parent)&&Fleet.role(x)==='stock');
      if(rows.some(x=>Fleet.ids(x,'uses').includes(n.id))||m.nodes.some(x=>sites.includes(x.id)&&Fleet.ids(x,'deployedOn').includes(n.id))||m.nodes.some(x=>x.id===n.parent&&x.parent===r.id))return r.id;
    }return '';
  }
  function sources(){
    const records=linkRows().filter(n=>Fleet.role(n)==='source');
    const requirements=linkRows().filter(n=>n.kind==='requirement');
    return section('Загрузить исходные данные',bar([select('fleetCategory','Содержимое файла',Object.entries(categories),'catalog'),
      select('fleetRequirement','Связать спецификацию с требованием',[['','Из файла'],...choices(requirements)],''),
      '<label class="field">Файл CSV, TSV, Excel или Markdown<input id="fleetFile" type="file" accept=".csv,.tsv,.xlsx,.md"></label>'])+
      table(['Документ','Тип','Байт','SHA-256','Исходные записи',''],records.map(n=>[card(n.id)+' '+esc(n.name),esc(categories[n.attrs.category]),n.attrs.bytes,'<code title="'+esc(n.attrs.sha256)+'">'+esc(n.attrs.sha256.slice(0,12))+'</code>',ids(n.refs||[]),act('Download','Скачать оригинал',n.id)])))+
      section('Требования и спецификации',table(['ID','Описание','Основание','Связано с'],linkRows().filter(n=>n.kind==='requirement'||Fleet.role(n)==='specification').map(n=>[card(n.id),esc(n.name),esc(n.note),ids(n.refs||[])])));
  }
  function entryTools(){
    return bar([act('Site','Добавить площадку'),act('Pool','Добавить тип в парк'),act('Load','Добавить нагрузку'),act('Release','Добавить релиз')]);
  }
  function enter(name){
    const m=model(),buy=node(root),sites=Fleet.ids(buy,'uses').map(node).filter(n=>n?.kind==='installation');
    const stockSite=sel('site','Инсталляция',choices(sites),sites[0]?.id);
    const row=value=>({op:'node',value}),fresh=k=>FleetChange.fresh(m,k);
    const title={Site:'Новая площадка',Pool:'Строка парка',Load:'Новая нагрузка',Release:'Новый релиз'}[name];
    if(!buy||['Pool','Load'].includes(name)&&!sites.length)throw Error('Сначала создайте закупку и площадку');
    const forms={
      Site:field('id','ID площадки',fresh('DC'),'required')+field('name','Название ЦОД','','required'),
      Pool:stockSite+sel('sku','Серверный профиль',[['','Новый профиль'],...choices(m.nodes.filter(n=>n.kind==='server'))],'')+
        field('id','ID нового профиля',fresh('SKU'))+field('name','Название нового профиля','Сервер')+
        number('cpuCores','Ядра CPU нового профиля',8,1)+number('ramGiB','RAM, ГиБ',32,1)+number('diskGiB','Диск, ГиБ',400,1)+
        number('unitPriceRub','Цена нового профиля, ₽',0)+number('quantity','В наличии',0)+number('maxBuy','Лимит закупки',1),
      Load:stockSite+field('id','ID нагрузки',fresh('SVC'),'required')+field('name','Название','','required')+
        number('replicas','Число реплик',1,1)+number('cpuCores','Ядра на реплику',1)+number('ramGiB','RAM, ГиБ',1)+number('diskGiB','Диск, ГиБ',1)+sel('apart','Размещение копий',[['yes','На разных узлах'],['no','Совместное размещение']],'yes'),
      Release:field('id','ID релиза',fresh('REL'),'required')+field('name','Название релиза','','required')};
    modal(title,forms[name],async f=>{
      if((name!=='Pool'||!f.sku)&&node(f.id))throw Error('Этот ID уже используется');
      let ops=[];
      const limits=Object.fromEntries(Fleet.resources.map(k=>[k,Number(f[k])]));
      if(name==='Site'){
        const cluster=fresh('CL'),installation=fresh('INST');
        ops=[row({id:f.id,kind:'domain',name:f.name}),row({id:cluster,kind:'cluster',name:'Контур · '+f.name,parent:f.id}),
          row({id:installation,kind:'installation',parent:cluster,name:'Инсталляция · '+f.name,relations:[['deployedOn',cluster]]}),
          row({id:root,relations:[...(buy.relations||[]),['uses',installation]]})];
        if(new Set([root,f.id,cluster,installation]).size!==4)throw Error('Выберите отдельный ID площадки');
      }else if(name==='Pool'){
        const sku=f.sku||f.id;
        if(m.nodes.some(n=>n.parent===f.site&&Fleet.role(n)==='stock'&&Fleet.ids(n,'uses').includes(sku)))throw Error('Этот тип уже есть в парке площадки');
        if(!f.sku)ops.push(row({id:sku,name:f.name,kind:'server',attrs:{...limits,unitPriceRub:Number(f.unitPriceRub)}}));
        const id=FleetChange.fresh({nodes:[...m.nodes,...ops.map(o=>o.value)]},'STOCK');
        ops.push(row({id,name:f.site+' / '+sku,kind:'artifact',parent:f.site,attrs:{fleetRole:'stock',quantity:Number(f.quantity),maxBuy:Number(f.maxBuy)},relations:[['uses',sku]]}));
      }else if(name==='Load'){
        if(!Object.values(limits).some(v=>v>0))throw Error('Укажите нагрузку хотя бы на один ресурс');
        ops=[row({id:f.id,name:f.name,kind:'service',attrs:{...limits,replicas:Number(f.replicas),antiAffinity:f.apart==='yes'},relations:[['deployedOn',f.site]]})];
      }else ops=[row({id:f.id,name:f.name,kind:'release',refs:[root]})];
      await push(DSM.patch(m,ops),title+' · '+(f.name||f.site));
    });
  }
  function stock(a){
    return section('Состав парка',entryTools()+table(['Площадка','Строка','Профиль','CPU / RAM / диск','Цена','В наличии','Можно купить',''],a.sites.flatMap(s=>s.pools.map(p=>[card(s.id),card(p.id),card(p.sku),p.limits.join(' / '),money(p.price),p.quantity,p.maxBuy,act('Edit','Править количество',p.id)+b('edit','Профиль',idAttr(p.sku))]))))+
      section('Нагрузки',table(['Установка','Компонент','Реплики','CPU / RAM / диск на реплику','Разносить копии'],a.sites.flatMap(s=>s.loads.map(l=>[card(s.id),card(l.id),l.count,l.demand.join(' / '),l.apart?'Да':'Нет']))))+
      section('Группировка парка',select('fleetGroup','Группировать',[['site','По ЦОД'],['sku','По типу сервера'],['cluster','По инфраструктурному кластеру']],group)+
      table(['Группа','Площадки','Строки парка','Количество'],FleetChange.groupRows(a.sites,group).map(g=>[card(g.key),ids(g.sites),ids(g.stock),g.quantity])))+architecture(a);
  }
  function architecture(a){
    const loads=new Set(a.sites.flatMap(s=>s.loads.map(l=>l.id))),edges=model().edges.filter(e=>loads.has(e.from)&&loads.has(e.to)&&e.layer===layer);
    const partition=FleetChange.cluster(model(),a,layer);
    return section('Архитектура и DSM',bar(['technical','infra','software'].map(k=>act('Graph',Views.modes[k],k)))+
      select('fleetLayer','Слой', [['flow','Вызовы'],['risk','Совместные проверки']],layer)+table(['Источник','Цель','Вес','Основание','Ячейка'],edges.map(e=>[card(e.from),card(e.to),e.weight,esc(e.reason),b('fleetPair','В DSM',idAttr(e.from)+' data-to="'+esc(e.to)+'"')]))+
      table(['Кластер DSM','Компоненты'],partition.groups.map((g,i)=>[i+1,ids(g)]))+act('Cluster','Записать кластеры'));
  }
  function comparison(a){return table(['Вариант','Купить','Стоимость','Свободные узлы','Дефицит штатно','Дефицит при отказе¹'],a.choices.map(c=>[esc(c.label),c.units??'—',c.available?money(c.cost):'Недоступен',c.idle??'—',c.missing??'—',c.worst??'—']))+'<p class="hint">¹ Максимум неразмещённых реплик при одном отказе в пределах ЦОД.</p>';}
  function failures(c){
    if(!c.available)return '<p>В пределах заданных ограничений решение отсутствует.</p>';
    return table(['Площадка','Узел','Реплики штатно','После отказа узла','Останутся без узла'],c.sites.flatMap(s=>s.hosts.map((h,i)=>[card(s.site),esc(h.id),esc(h.replicas.map(r=>r.id).join(', ')||'—'),
      esc(s.failures[i].moves.map(([r,to])=>r+' → '+to).join(', ')||'—'),esc(s.failures[i].unplaced.join(', ')||'—')])));
  }
  function tree(c,cap){
    const t=Fleet.tree(c,cap),stop=t.checks.findIndex(x=>!x.pass);
    const diagram='<ol class="fleet-tree" aria-label="Путь решения">'+t.checks.map((x,i)=>'<li data-reached="'+(stop<0||i<=stop)+'"><strong>'+esc(x.question)+'</strong><span>'+(stop>=0&&i>stop?'Проверка пропущена':!x.pass&&i===stop?'Нет → '+esc(x.no):'Да → '+(i===t.checks.length-1?'согласование':'дальше'))+'</span></li>').join('')+'</ol>';
    return diagram+table(['Условие','Проверка','Действие при нарушении'],t.checks.map(x=>[esc(x.question),x.pass?'Да':'Нет',esc(x.no)]))+'<p><strong>'+esc(t.outcome)+'</strong></p>';}
  function options(a,c){return section('Сравнение AS-IS и TO-BE',comparison(a)+select('fleetOption','Исследовать вариант',a.choices.map(x=>[x.key,x.label]),key)+
    bar([act('Budget',budget==null?'Задать бюджет':'Бюджет '+money(budget)),act('Notebook','Рассчитать в Jupyter'),act('Save','Сохранить вариант в релиз')]))+
    section('Дерево решения',tree(c,budget))+section('Потеря каждого узла',failures(c));}
  function evidence(){
    const records=linkRows().filter(n=>Fleet.role(n)==='simulation');
    if(!records.length)return '';
    return section('Проверки в Jupyter',table(['Проверка','Расчётная база','Дефицит N−1','Ведомость','Измерено / в профиле','Основания',''],records.map(n=>[
      card(n.id),esc(n.attrs.base.slice(0,8)),n.attrs.worst,esc(n.attrs.inventoryFile||'Моделирование'),n.attrs.measured==null?'—':n.attrs.measured+' / '+n.attrs.qualified,ids((n.refs||[]).filter(k=>['adr','requirement','release','proposal'].includes(node(k)?.kind))),b('replayEvidence','Повторить в Jupyter',idAttr(n.id))])));
  }
  function decisions(){
    const plans=FleetChange.variants(model(),root),n=plans.find(n=>n.id===plan)||plans.at(-1);
    if(!n)return section('Решения по закупке','<p>Выберите конфигурацию и сохраните её в релиз.</p>'+act('Step',stages.options,'options'));
    plan=n.id;const proposal=model().nodes.find(p=>Fleet.role(p)==='fleetProposal'&&p.refs?.includes(n.id));const c=FleetChange.historical(doc(),n).choice,adr=(n.refs||[]).map(node).find(n=>n?.kind==='adr');
    return section('Зафиксированный вариант',select('fleetPlan','Вариант',choices(plans),plan)+table(['Вариант','Стадия','Релиз','База','Цена','Бюджет'],[[card(n.id),esc(n.attrs.stage),card(n.release),esc(n.attrs.base.slice(0,8)),money(c.cost),money(n.attrs.budget)]])+
      '<p>'+esc(n.note)+'</p>'+table(['ЦОД','Позиция заказа','Количество'],c.sites.flatMap(s=>Object.entries(s.order).filter(([,v])=>v).map(([id,q])=>[card(s.site),card(id),q])))+tree(c,n.attrs.budget)+
      (adr?table(['ADR','Ответственный','Контекст','Альтернативы','Решение','Последствия','Основания'],[[card(adr.id),...['owner','context','alternatives','rationale','consequences'].map(k=>esc(adr.attrs[k])),ids(adr.refs)]]):'')+
      bar([act('BaselineBook','Рассчитать исходную ревизию',n.id),...(proposal?[card(proposal.id),...(adr?[b('specZip','Скачать OpenSpec',idAttr(proposal.id))]:[])]:[]),...(n.attrs.stage==='draft'?[act('Approve','Оформить ADR')]:[]),...(n.attrs.stage==='approved'?[act('Implement','Внедрить заказ')]:[]),b('tab','История проекта',idAttr('history'))]));
  }
  function report(a,c){
    const sources=linkRows().filter(n=>Fleet.role(n)==='source'),decisionsList=FleetChange.variants(model(),root);
    return section('Отчёт о закупке',bar([act('Print','Печать / PDF'),act('Notebook','Таблицы и графики в Jupyter')]))+
      '<article id="fleetReport" class="card"><h2>'+esc(node(root).name)+'</h2><p>'+esc(root)+' · версия '+esc(DSM.head(doc()).rev)+' · '+esc(c.label)+'</p><h3>Стоимость и резерв</h3>'+comparison(a)+
      '<h3>Размещение и восстановление</h3>'+failures(c)+'<h3 class="fleet-report-policy">Критерии выбора</h3>'+tree(c,budget)+
      '<h3>Релизы и решения</h3>'+table(['Вариант','Релиз','Стадия','Согласованные основания'],decisionsList.map(n=>[card(n.id),card(n.release),esc(n.attrs.stage),ids(n.refs||[])]))+
      table(['ADR','Контекст','Основание выбора','Последствия'],linkRows().filter(n=>n.kind==='adr').map(n=>[card(n.id),esc(n.attrs?.context??''),esc(n.attrs?.rationale??n.note),esc(n.attrs?.consequences??'')]))+
      '<h3>Источники расчёта</h3>'+table(['Файл','SHA-256'],sources.map(n=>[esc(n.name),'<code>'+esc(n.attrs.sha256)+'</code>']))+'</article>';
  }
  function view(){
    const roots=current();
    let out=section('Закупка по ЦОД',bar([select('fleetRoot','Закупка',choices(roots),root),act('New','Создать закупку')])+
      '<nav class="fleet-steps" aria-label="Этапы закупки">'+Object.entries(stages).map(([k,v])=>b('fleetStep',v,idAttr(k)+' aria-pressed="'+(step===k)+'"')).join('')+'</nav>');
    if(step==='sources'||!root)return '<div class="stack">'+out+sources()+(root?section('Ручной ввод',entryTools()):'')+'</div>';
    try{const a=Fleet.analyze(model(),root),c=a.choices.find(x=>x.key===key)||a.choices[0];
      out+=step==='stock'?stock(a):step==='options'?options(a,c):step==='decision'?decisions()+evidence():report(a,c);
    }catch(e){out+=section('Исходные данные','<p>'+esc(e.message)+'</p>'+entryTools()+bar([act('Step','Загрузить каталог','sources'),b('tab','Открыть каталог',idAttr('catalog'))]));}
    return '<div class="stack">'+out+'</div>';
  }
  function preview(next,note,base=DSM.head(doc()).rev){
    const diff=DSM.diff(model(),next);
    if(!diff.length){toast('Данные совпадают с текущей версией');return;}
    modal(note,Views.differences(diff),()=>push(next,note,'Закупки',base),'Применить изменения');
  }
  function bind(){
    const on=(id,fn)=>{const el=document.getElementById(id);if(el)el.onchange=e=>{fn(e.target.value);render();};};
    on('fleetRoot',v=>{root=v;plan='';});on('fleetLayer',v=>{layer=v;});on('fleetOption',v=>{key=v;});on('fleetPlan',v=>{plan=v;});on('fleetGroup',v=>{group=v;});
    const file=document.getElementById('fleetFile');if(file)file.onchange=async()=>{
      const f=file.files[0];if(!f)return;const snap=doc(),base=DSM.head(snap).rev;
      try{const next=await FleetSource.ingest(snap,document.getElementById('fleetCategory').value,f.name,new Uint8Array(await f.arrayBuffer()),root,document.getElementById('fleetRequirement').value);
        preview(next,'Загрузка · '+f.name,base);}catch(e){toast(e.message);}finally{file.value='';}
    };
  }
  function handle(name,id,target){
    if(name==='Open'){root=id;step='stock';navigate('fleet');return;}
    if(name==='Step'){step=id;render();return;}
    if(name==='Graph'){graph(id,root);return;}
    if(name==='Pair'){matrix({from:id,to:target.dataset.to,layer});return;}
    if(name==='Download'){const n=node(id);download(n.attrs.filename,FleetSource.decode(n));return;}
    if(name==='Print'){document.body.classList.add('fleet-print');try{window.print();}finally{document.body.classList.remove('fleet-print');}return;}
    if(name==='New'){modal('Новая закупка',field('id','ID',FleetChange.fresh(model(),'BUY'),'required')+field('name','Название','','required'),async f=>{
      if(node(f.id))throw Error('Этот ID уже занят');await push(DSM.patch(model(),[{op:'node',value:{...f,kind:'procurement'}}]),'Создана закупка '+f.id);root=f.id;step='sources';render();
    });return;}
    if(['Site','Pool','Load','Release'].includes(name)){enter(name);return;}
    if(name==='Budget'){modal('Ограничение стоимости',field('rub','Бюджет, ₽ · пустое поле снимает ограничение',budget??'','type="number" min="0" step="1"'),f=>{budget=f.rub===''?null:Number(f.rub);render();},'Пересчитать');return;}
    if(name==='Edit'){
      const n=node(id);modal('Состав парка · '+n.id,number('quantity','В наличии',n.attrs.quantity)+number('maxBuy','Доступно к закупке',n.attrs.maxBuy),f=>push(DSM.patch(model(),[{op:'node',value:{id,attrs:{...n.attrs,quantity:Number(f.quantity),maxBuy:Number(f.maxBuy)}}}]),'Обновлён парк '+id));return;
    }
    if(name==='Cluster'){preview(FleetChange.saveClusters(model(),root,layer),'Разбиение DSM · '+layer);return;}
    if(name==='BaselineBook'){
      const n=node(id),snap=FleetChange.historical(doc(),n);
      notebook(root,{option:'manual',order:Object.assign({},...snap.choice.sites.map(s=>s.order)),budget:n.attrs.budget,base:snap.base.rev});return;
    }
    if(name==='Notebook'){notebook(root,{option:key,budget});return;}
    if(name==='Save'){
      const c=Fleet.analyze(model(),root).choices.find(x=>x.key===key),releases=model().nodes.filter(n=>n.kind==='release');
      if(!releases.length)throw Error('Добавьте релиз в каталоге');if(!c.available)throw Error('Выберите доступный вариант');
      modal('Целевое состояние',field('name','Название',c.label,'required')+sel('release','Релиз',choices(releases),releases[0].id)+txt('note','Описание целевого состояния'),
        async f=>{await push(FleetChange.freeze(doc(),root,c,f.name,f.release,budget,f.note),'Зафиксирован вариант · '+f.name);step='decision';plan='';render();});return;
    }
    if(name==='Approve'){
      const req=linkRows().filter(n=>n.kind==='requirement'),spec=linkRows().filter(n=>Fleet.role(n)==='specification');
      modal('Архитектурное решение',sel('requirement','Требование',choices(req),'')+sel('specification','Спецификация',choices(spec),'')+
        [['owner','Ответственный'],['context','Контекст'],['alternatives','Сравнение альтернатив'],['rationale','Обоснование выбора'],['consequences','Последствия']].map(([k,l])=>txt(k,l)).join(''),
        f=>push(FleetChange.approve(doc(),plan,f),'Принят ADR · '+plan,f.owner));return;
    }
    if(name==='Implement')preview(FleetChange.implement(doc(),plan),'Внедрение · '+plan);
  }
  return {view,bind,handle,owner};
}
