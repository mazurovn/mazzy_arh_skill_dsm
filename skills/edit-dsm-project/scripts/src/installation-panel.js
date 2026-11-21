function installationPanel({model,esc,b,field,sel,option,table,modal,push,render,download,notebook,graph}){
  let selected='';
  const card=id=>b('objectRow',esc(id),'class="tiny" data-id="'+esc(id)+'"');
  const action=(key,label,id='')=>b('sizing'+key,label,'data-id="'+esc(id)+'"');
  const integer=(k,label,v,min=0)=>field(k,label,v,'type="number" step="1" min="'+min+'" required');
  const head=(title,controls='')=>'<div class="cardhead"><h2>'+title+'</h2><div class="tools">'+controls+'</div></div>';
  function current(){const rows=Installations.plans(model());return rows.find(n=>n.id===selected)||rows[0];}
  function cover(){
    const rows=Installations.coverage(model());
    if(!rows.length)return '';
    const links=ids=>ids.map(card).join(' ')||'—';
    return '<section class="card">'+head('Покрытие функций')+table(['Функция','Требования','Реализация','Размещение','Проверки','Покрытие'],rows.map(r=>[
      card(r.id),links(r.requirements),links(r.units),r.routes.map(([unit,inst])=>card(unit)+' → '+card(inst)).join('<br>')||'—',links(r.evidence),r.covered?'Есть реализация и размещение':'Есть пробелы']))+'</section>';
  }
  function view(){
    const m=model(),inst=current(),plans=Installations.plans(m);
    const actions=action('New','Новая инсталляция')+(inst?action('Edit','Параметры')+action('Load','Назначить нагрузку'):'');
    let body='<section class="card">'+head('Расчёт инсталляций',actions);
    if(!inst)return body+'<p>Создайте инсталляцию или загрузите каталог, нагрузки и связи размещения из Excel.</p>'+b('tab','Импорт из Excel','data-id="io"')+'</section>'+cover();
    body+='<div class="tools"><label>Инсталляция <select id="sizingInstall">'+plans.map(n=>option(n.id,n.name+' · '+n.id,inst.id)).join('')+'</select></label>'+card(inst.id)+'</div>';
    let p;
    try{p=Installations.calculate(m,inst.id);}catch(e){return body+'<p class="callout">'+esc(e.message)+'</p></section>'+cover();}
    const fmt=n=>n.toLocaleString('ru-RU');
    body+='<div class="sizing-metrics">'+[[p.bins.length,'Рабочих узлов'],[p.spare,'В резерве'],[p.required,'Всего узлов'],[p.existing,'Уже доступно'],[p.purchase,'К закупке'],[p.budget===null?'—':fmt(p.budget),'Стоимость, ₽']].map(([v,l])=>'<div><strong>'+v+'</strong><span>'+l+'</span></div>').join('')+'</div>'+
      '<p>Площадка '+card(p.cluster)+' · профиль узла '+card(p.host)+' · '+p.limits.join(' / ')+' (ядра / ГиБ RAM / ГиБ диска)</p>'+
      '<div class="tools">'+action('Notebook','Расчёт и приёмка в Jupyter',inst.id)+action('Export','Скачать размещение CSV')+'</div></section>';
    const demand=p.workloads.map(w=>[card(w.id),w.replicas,...w.demand,w.apart?'Раздельно':'Вместе допустимо',action('Load','Изменить нагрузку',w.id)]);
    body+='<section class="card">'+head('Нагрузка на реплику')+table(['Объект','Реплики',...Installations.titles,'Размещение',''],demand)+'</section>'+
      '<section class="card">'+head('Размещение по рабочим узлам')+table(['Узел','Назначенные реплики',...Installations.titles],p.bins.map((bin,i)=>[i+1,Object.entries(bin.members).map(([k,n])=>card(k)+' × '+n).join(' · '),...bin.used]))+
      '<div class="sizing-bars">'+Installations.titles.map((label,i)=>{const cap=p.limits[i]*p.bins.length;return '<label>'+label+'<meter min="0" max="'+cap+'" value="'+p.totals[i]+'"></meter>'+p.totals[i]+' / '+cap+'</label>';}).join('')+'</div></section>';
    return '<div class="stack">'+body+cover()+'<section class="card">'+head('Архитектурные представления')+'<div class="tools">'+['technical','infra','software'].map(k=>action('Graph',Views.modes[k],k)).join('')+'</div></section></div>';
  }
  function handle(key,id){
    const m=model(),by=Delivery.index(m).by,n=current();
    if(key==='Graph')return graph(id,n?.id);
    if(key==='Notebook')return notebook(id);
    if(key==='Export'){
      const p=Installations.calculate(m,n.id);
      return download(p.id+'-placement.csv',Formats.csv([['Инсталляция','Узел','Нагрузки',...Installations.titles],...p.bins.map((b,i)=>[p.id,i+1,JSON.stringify(b.members),...b.used])]),'text/csv');
    }
    if(key==='New'||key==='Edit'){
      const edit=key==='Edit'?n:null,links=edit?.relations||[];
      const target=(rel,kind)=>links.find(([k,t])=>k===rel&&by.get(t)?.kind===kind)?.[1];
      const oldHost=by.get(target('uses','server')),oldCluster=target('deployedOn','cluster');
      const hostId=oldHost?.id||m.nodes.find(n=>n.kind==='server')?.id||Delivery.nextId(m,'HOST');
      const host=by.get(hostId);
      const inputs=field('id','ID инсталляции',edit?.id||Delivery.nextId(m,'INST'),edit?'readonly':'required')+field('name','Название',edit?.name||'','required')+
        field('environment','Среда',edit?.attrs?.environment||'','required')+field('cluster','ID кластера',oldCluster||m.nodes.find(n=>n.kind==='cluster')?.id||Delivery.nextId(m,'CL'),'required')+
        field('host','ID типа сервера',hostId,'required')+Installations.keys.map((k,i)=>integer(k,'Ёмкость узла · '+Installations.titles[i],host?.attrs?.[k]??'',1)).join('')+
        field('unitPriceRub','Цена одного узла, ₽',host?.attrs?.unitPriceRub??'','type="number" min="0" step="1"')+
        integer('spareHosts','Резервных узлов',edit?.attrs?.spareHosts??1)+integer('existingHosts','Доступных узлов этого типа',edit?.attrs?.existingHosts??0);
      return modal(edit?'Параметры инсталляции':'Новая инсталляция',inputs,async f=>{
        if(!edit)Delivery.fresh(m,f.id);
        if(new Set([f.cluster,f.host,f.id]).size!==3)throw Error('Нужны разные ID инсталляции, сервера и кластера');
        const prev=by.get(f.host),cluster=by.get(f.cluster);
        if(prev&&prev.kind!=='server'||cluster&&cluster.kind!=='cluster')throw Error('Проверьте типы сервера и кластера');
        const attrs={...prev?.attrs,...Object.fromEntries(Installations.keys.map(k=>[k,Number(f[k])]))};
        if(f.unitPriceRub!=='')attrs.unitPriceRub=Number(f.unitPriceRub);else delete attrs.unitPriceRub;
        const relations=links.filter(([k,t])=>!(k==='uses'&&by.get(t)?.kind==='server'||k==='deployedOn'&&by.get(t)?.kind==='cluster'));
        const cards=[...(!cluster?[{id:f.cluster,name:f.cluster,kind:'cluster'}]:[]),{id:f.host,name:prev?.name||f.host,kind:'server',attrs},
          {id:f.id,name:f.name,kind:'installation',relations:[...relations,['uses',f.host],['deployedOn',f.cluster]],attrs:{...edit?.attrs,environment:f.environment,spareHosts:Number(f.spareHosts),existingHosts:Number(f.existingHosts)}}];
        const after=DSM.patch(m,cards.map(value=>({op:'node',value})));
        modal('Проверить параметры',Views.differences(DSM.diff(m,after)),async()=>{
          if(model()!==m)throw Error('Обновите параметры после изменения проекта');
          await push(after,'Параметры инсталляции '+f.id);selected=f.id;render();
        },'Применить и сохранить');return false;
      });
    }
    if(key==='Load'){
      const w=by.get(id),attrs=w?.attrs||{};
      return modal('Рабочая нагрузка',field('id','ID существующего или нового компонента',id,'required')+field('name','Название для нового объекта',w?.name||'')+
        integer('replicas','Реплик',attrs.replicas??1,1)+Installations.keys.map((k,i)=>integer(k,'На реплику · '+Installations.titles[i],attrs[k]??'')).join('')+
        sel('apart','Реплики одной нагрузки',[['no','Совместное размещение'],['yes','На разных узлах']],attrs.antiAffinity?'yes':'no'),async f=>{
          const prev=by.get(f.id);
          if(prev&&!Installations.loads.includes(prev.kind))throw Error('Выберите программный компонент, модуль, систему или сервис');
          if(!prev&&!f.name.trim())throw Error('Укажите название нового компонента');
          const relations=(prev?.relations||[]).slice();if(!relations.some(([k,t])=>k==='deployedOn'&&t===n.id))relations.push(['deployedOn',n.id]);
          const after=DSM.patch(m,[{op:'node',value:{id:f.id,name:prev?.name||f.name,kind:prev?.kind||'component',relations,attrs:{...prev?.attrs,replicas:Number(f.replicas),antiAffinity:f.apart==='yes',...Object.fromEntries(Installations.keys.map(k=>[k,Number(f[k])]))}}}]);
          Installations.calculate(after,n.id);await push(after,'Размещение '+f.id+' в '+n.id);
        });
    }
  }
  return {view,handle,select:id=>{selected=id;}};
}
