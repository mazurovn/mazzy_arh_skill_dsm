function deliveryPanel({model,doc,esc,button,field,sel,table,modal,push,download,render,navigate,inspect,toast,notebook}){
  let selected='',requestId='',proposalId='',filters={stage:'',owner:'',overdue:false};
  const action=(name,label,id='',extra='')=>button('journey'+name,label,'data-id="'+esc(id)+'" '+extra);
  const text=(name,label,initial='')=>'<label class="field">'+label+'<textarea name="'+name+'" required>'+esc(initial)+'</textarea></label>';
  const select=(id,label,choices,current)=>'<label class="filter-control">'+label+'<select id="'+id+'">'+choices.map(([k,v])=>'<option value="'+esc(k)+'" '+(k===current?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
  const choose=ns=>ns.map(n=>[n.id,n.id+' · '+n.name]);
  const area=(html)=>'<div class="row">'+html+'</div>';
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  function set(id){selected=id||'';requestId='';proposalId='';}
  function selectRoute(id){
    set(id);navigate('journey',false);
    const hash='#journey?requirement='+encodeURIComponent(id)+'&project='+encodeURIComponent(doc().project);
    if(location.hash!==hash)window.history.pushState(null,'',hash);
  }
  function current(){return Delivery.chain(model(),selected,requestId,proposalId);}
  const buttons={intake:['Request','Создать запрос'],review:['Review','Разобрать запрос'],deferred:['Review','Повторить разбор'],declined:['Review','Пересмотреть запрос'],
    propose:['Proposal','Подготовить предложение'],decision:['Decision','Записать решение ADR'],plan:['Task','Запланировать работу'],
    work:['Works','К работам релиза'],apply:['Apply','Применить изменение'],verify:['Observe','Подтвердить внедрение'],
    deviation:['Observe','Повторная проверка'],done:['Observe','Проверить в другой среде']};
  function view(){
    const m=model(),requirements=m.nodes.filter(n=>n.kind==='requirement');
    if(!selected&&requirements.length===1)selected=requirements[0].id;
    const rows=Delivery.portfolio(m,filters,today());
    const owners=[...new Set(requirements.map(n=>n.attrs?.owner).filter(Boolean))].sort();
    const head='<div class="cardhead"><div><h2>Маршрут изменения</h2><p class="hint">От потребности до проверки в рабочей среде</p></div>'+action('Requirement','Новое требование','','class="primary"')+'</div>';
    const filtersBar='<div class="journey-filters">'+select('journeyStage','Этап',[['','Все этапы'],...Object.entries(Delivery.stages)],filters.stage)+
      select('journeyOwner','Ответственный',[['','Все ответственные'],...owners.map(o=>[o,o])],filters.owner)+
      '<label><input id="journeyLate" type="checkbox" '+(filters.overdue?'checked':'')+'> Просроченные</label>'+action('Csv','CSV очереди')+'</div>';
    const queue='<details class="card journey-queue" '+(!selected?'open':'')+'><summary>Очередь требований · '+rows.length+' / '+requirements.length+'</summary>'+filtersBar+
      (rows.length?table(['Требование','Следующий этап','Ответственный','Срок'],rows.map(r=>[action('Select',esc(r.id)+' · '+esc(r.name),r.id),esc(Delivery.stages[r.stage]),esc(r.owner||'—'),esc(r.due||'—')+(r.overdue?' · просрочено':'')])):'<p>Подходящих требований нет.</p>')+'</details>';
    const req=Delivery.index(m).by.get(selected);
    if(req?.kind!=='requirement')return '<div class="stack"><section class="card">'+head+'<p>Создайте требование или выберите его в очереди.</p></section>'+queue+'</div>';
    const ch=current(),r=ch.requirement,p=ch.proposal;
    const objectButton=n=>action('Card',esc(n.id)+' · '+esc(n.name),n.id);
    const stages=['Требование','Запрос','Предложение','Решение','Работы','Применение','Внедрение'];
    const evidence=[r,ch.request,p,ch.decisions[0],ch.tasks.length&&ch.tasks.every(t=>t.state==='done'),p?.state==='done',ch.stage==='done'];
    const destinations=['Требование','Запрос','Предложение','Архитектурные решения','Работы релиза','Изменённый объект','Проверки внедрения'];
    const progress='<ol class="journey-steps">'+stages.map((s,i)=>'<li class="'+(evidence[i]?'passed':'')+'">'+(evidence[i]?action('Step','✓ '+s,destinations[i]):esc(s))+'</li>').join('')+'</ol>';
    const stage=ch.stage==='plan'&&!m.nodes.some(n=>n.kind==='release')?['Release','Создать первый релиз']:buttons[ch.stage];
    const actions=area(action(stage[0],stage[1],'','class="primary"')+(p&&p.state!=='done'&&ch.stage!=='plan'&&ch.stage!=='decision'?action('Task','Добавить работу'):'')+
      ((ch.stage==='plan'||ch.stage==='work')&&stage[0]!=='Release'?action('Release','Новый релиз'):'')+ (ch.stage==='deviation'?action('Correction','Корректирующий запрос'):'')+(p?.state==='done'&&Delivery.index(m).by.get(p.attrs?.appliedObject)?.kind==='installation'?action('Notebook','Проверить в Jupyter'):'')+action('Trace','Отчёт .md')+action('Link','Ссылка на требование'));
    const pick=(arr,chosen,id,title)=>arr.length>1?select(id,title,choose(arr),chosen?.id):'';
    const line=(label,body)=>body?'<div class="trace-line" data-trace="'+label+'"><h4 tabindex="-1">'+label+'</h4>'+body+'</div>':'';
    const items=(arr)=>arr.map(objectButton).join(' ');
    const tasks=ch.tasks.map(t=>'<div class="file-item"><div>'+objectButton(t)+'<small>'+esc([t.attrs?.owner,t.effort==null?'без оценки':t.effort+' ед.',...(t.relations||[]).filter(x=>x[0]==='dependsOn').map(x=>'после '+x[1])].filter(Boolean).join(' · '))+'</small>'+(t.release?objectButton(Delivery.index(m).by.get(t.release)):'')+'</div>'+
      (p?.state==='done'?'<span>Готово</span>':action('TaskState',t.state==='done'?'Вернуть в работу':'Завершить работу',t.id))+'</div>').join('');
    const observation=ch.observations.map(n=>'<div class="file-item"><div>'+objectButton(n)+'<small>'+esc(n.attrs.environment)+' · '+esc(n.attrs.owner)+' · '+esc(n.attrs.observedAt?.slice(0,10)||'')+'</small><p>'+esc(n.note)+'</p></div>'+esc(n.attrs.verification==='passed'?'Подтверждено':'Расхождение')+'</div>').join('');
    return '<div class="stack"><section class="card">'+head+progress+'<div class="cardhead"><div><small>'+esc(r.id)+' · '+esc(r.attrs?.owner||'Ответственный не указан')+'</small><h3>'+esc(r.name)+'</h3></div><strong>'+esc(Delivery.stages[ch.stage])+'</strong></div><p>'+esc(r.note)+'</p><p><b>Условие приёмки</b> · '+esc(r.attrs?.when||'—')+' → '+esc(r.attrs?.then||'—')+'</p>'+actions+'</section>'+
      '<section class="card"><h3>Связанные работы и артефакты</h3>'+line('Требование',objectButton(r))+line('Запрос',pick(ch.requests,ch.request,'journeyRequest','Запрос')+(ch.request?objectButton(ch.request):''))+
      line('Предложение',pick(ch.proposals,p,'journeyProposal','Предложение')+(p?objectButton(p):''))+line('Архитектурные решения',items(ch.decisions))+line('Работы релиза',tasks)+
      line('Изменённый объект',p?.attrs?.appliedObject&&Delivery.index(m).by.has(p.attrs.appliedObject)?objectButton(Delivery.index(m).by.get(p.attrs.appliedObject)):'')+
      line('Проверки внедрения',observation)+line('Открытые отклонения',items(ch.deviations))+'</section>'+queue+'</div>';
  }
  function bind(){
    const on=(id,fn)=>{const el=document.getElementById(id);if(el)el.onchange=()=>{fn(el);render();document.querySelector('.journey-queue').open=true;};};
    on('journeyStage',el=>filters.stage=el.value);on('journeyOwner',el=>filters.owner=el.value);on('journeyLate',el=>filters.overdue=el.checked);
    on('journeyRequest',el=>{requestId=el.value;proposalId='';});on('journeyProposal',el=>proposalId=el.value);
  }
  async function transfer(id){
    const m=model(),n=Delivery.index(m).by.get(id),releases=DSM.plan(m);
    if(n?.kind!=='changeTask')throw Error('Выберите работу релиза');
    if(Delivery.index(m).by.get(n.parent)?.state==='done')throw Error('Предложение уже применено');
    modal('Перенести работу '+id,sel('release','Назначить релиз',releases.map(r=>[r.id,r.name]),n.release)+field('actor','Автор',n.attrs?.owner,'required'),f=>{
      if(f.release===n.release)throw Error('Выберите другой релиз');
      const version=DSM.head(doc()).rev,after=DSM.patch(model(),[{op:'node',value:{id,release:f.release}}]);
      const future=new Map(DSM.plan(after).map(r=>[r.id,r]));
      const rows=releases.filter(r=>[n.release,f.release].includes(r.id)).map(r=>[esc(r.id),r.knownEffort,future.get(r.id).knownEffort,r.capacity??'—']);
      modal('Изменение загрузки релизов',table(['Релиз','Было','Станет','Ёмкость'],rows),()=>push(after,'Перенос работы '+id+' в '+f.release,f.actor,version),'Подтвердить перенос');
      return false;
    },'Предпросмотр');
  }
  async function handle(name,id){
    const m=model(),next=prefix=>Delivery.nextId(m,prefix);
    if(name==='Notebook'){const ch=current();return notebook(ch.proposal.attrs.appliedObject,{requirement:ch.requirement.id,proposal:ch.proposal.id});}
    if(name==='Step'){[...document.querySelectorAll('[data-trace]')].find(el=>el.dataset.trace===id)?.querySelector('h4')?.focus();return;}
    if(name==='Transfer'){await transfer(id);return;}
    if(name==='Select'){selectRoute(id);return;}
    if(name==='Card'){inspect(id);return;}
    if(name==='Csv'){
      const list=Delivery.portfolio(m,filters,today()).map(r=>[r.id,r.name,Delivery.stages[r.stage],r.owner,r.due,r.overdue?'Да':'']);
      download('requirements.csv',Formats.csv([['ID','Требование','Этап','Ответственный','Срок','Просрочено'],...list]),'text/csv');return;
    }
    if(name==='Requirement'){
      modal('Новое требование',field('id','ID',next('REQ'),'required')+field('name','Название','','required')+text('need','Потребность')+
        text('when','При каком условии')+text('then','Проверяемый результат')+field('owner','Ответственный','','required')+field('due','Срок','','type="date"'),async f=>{
        await push(Delivery.requirement(model(),f),'Регистрация требования · '+f.id,f.owner);selectRoute(f.id);
      });return;
    }
    const ch=current(),r=ch.requirement,p=ch.proposal,owner=r.attrs?.owner||'';
    if(name==='Request'||name==='Correction')modal('Запрос по требованию '+r.id,field('id','ID',next('CR'),'required')+field('name','Название',r.name,'required')+
      field('requester','Инициатор',owner,'required')+text('problem','Проблема',r.note)+text('outcome','Ожидаемый результат',r.attrs?.then)+text('acceptance','Как проверить',[r.attrs?.when,r.attrs?.then].filter(Boolean).join(' → '))+
      sel('priority','Приоритет',[['normal','Обычный'],['high','Высокий'],['critical','Критический'],['low','Низкий']],'normal'),async f=>{
      await push(Changes.request(model(),{...f,owner,refs:[r.id,...(name==='Correction'?ch.deviations.map(n=>n.id):[])]}),'Запрос · '+f.id,f.requester);requestId=f.id;render();
    });
    if(name==='Review')modal('Разбор '+ch.request.id,sel('outcome','Решение',[['accepted','Принять'],['deferred','Отложить'],['declined','Отклонить']],'accepted')+
      field('actor','Рецензент',owner,'required')+text('reason','Обоснование'),f=>push(Changes.review(model(),ch.request.id,f.outcome,f.actor,f.reason),'Разбор · '+f.reason,f.actor));
    if(name==='Proposal')modal('Предложение OpenSpec',field('id','ID предложения',next('change'),'required')+field('actor','Автор',owner,'required'),
      f=>push(Changes.promote(model(),ch.request.id,f.id),'OpenSpec propose · '+f.id,f.actor));
    if(name==='Decision')modal('Архитектурное решение',field('id','ID',next('ADR'),'required')+field('name','Название решения',r.name,'required')+
      text('choice','Выбранный вариант')+text('effects','Последствия')+field('actor','Автор',owner,'required'),f=>push(Delivery.decision(model(),ch,f),'ADR · '+f.id,f.actor));
    if(name==='Release')modal('Новый релиз',field('id','ID',next('REL'),'required')+field('name','Название','','required')+field('capacity','Ёмкость','','type="number" min="0" step="any" required')+
      field('actor','Ответственный',owner,'required'),f=>push(DSM.patch(model(),[{op:'node',value:{id:Delivery.fresh(model(),f.id),name:f.name,kind:'release',capacity:Number(f.capacity)}}]),'План релиза · '+f.id,f.actor));
    if(name==='Task'){
      const releases=DSM.plan(m);
      if(!releases.length){await handle('Release');return;}
      modal('Работа релиза',field('id','ID',next('WORK'),'required')+field('name','Работа','','required')+field('owner','Исполнитель',owner,'required')+
        sel('release','Релиз',releases.map(n=>[n.id,n.id+' · '+n.name]),releases[0].id)+field('effort','Оценка','','type="number" step="any" min="0"')+
        '<p id="journeyCapacity" aria-live="polite"></p>'+sel('after','После работы',[['','Без предшественника'],...choose(ch.tasks)],''),f=>push(Delivery.task(model(),ch,f),'План работ · '+f.id,f.owner));
      const form=document.getElementById('form'),show=()=>{
        const rel=releases.find(x=>x.id===form.elements.release.value),raw=form.elements.effort.value;
        document.getElementById('journeyCapacity').textContent='Загрузка '+rel.knownEffort+' → '+(rel.knownEffort+Number(raw))+' / '+(rel.capacity??'ёмкость неизвестна')+' · без оценки '+(rel.unknown+(raw===''?1:0))+(rel.capacity!==null&&rel.knownEffort+Number(raw)>rel.capacity?' · перегрузка на '+(rel.knownEffort+Number(raw)-rel.capacity):'');
      };form.elements.release.onchange=show;form.elements.effort.oninput=show;show();
    }
    if(name==='Works'){document.querySelector('[data-action=journeyTaskState]')?.focus();return;}
    if(name==='TaskState'){
      const task=Delivery.index(model()).by.get(id);
      modal('Состояние работы '+id,field('actor','Кто меняет статус',task.attrs?.owner||owner,'required')+text('reason','Основание',task.state==='done'?'Требуется доработка':'Работа выполнена'),
        f=>push(Delivery.taskState(model(),id),'Работа '+id+' · '+f.reason,f.actor));
    }
    if(name==='Apply'){
      const targets=m.nodes.filter(n=>!['requirement','proposal','request','changeTask','adr'].includes(n.kind));
      modal('Применение изменения',field('target','ID существующего или нового объекта','','required list="deliveryTargets"')+
        '<datalist id="deliveryTargets">'+targets.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.name)+'</option>').join('')+'</datalist>'+
        field('targetName','Название при создании компонента')+field('attribute','Имя атрибута','','required')+
        sel('type','Тип значения',[['text','Текст'],['number','Число'],['boolean','Логическое']],'text')+field('value','Новое значение','','required')+
        field('actor','Кто применяет',owner,'required')+text('note','Причина изменения',r.name),f=>{
          const before=DSM.head(doc()).rev,after=Delivery.apply(model(),ch,f);
          modal('Проверить применение',Views.differences(DSM.diff(model(),after)),()=>push(after,f.note,f.actor,before),'Применить и сохранить');return false;
        },'Предпросмотр');
    }
    if(name==='Observe')modal('Проверка внедрения',field('environment','Среда или площадка',ch.observations.at(-1)?.attrs.environment||'','required')+
      (!p.attrs?.appliedObject?field('target','ID проверяемого объекта','','required'):'')+sel('outcome','Итог',[['passed','Подтверждено'],['failed','Обнаружено расхождение']],'passed')+
      text('evidence','Фактический результат и основание')+field('actor','Проверил',owner,'required'),f=>push(Delivery.observe(model(),ch,f),'Проверка внедрения · '+r.id+' · '+f.environment,f.actor));
    if(name==='Trace')download(r.id+'-trace.md',Delivery.trace(ch),'text/markdown');
    if(name==='Link'){
      const url=new URL(location.href);url.hash='journey?requirement='+encodeURIComponent(r.id)+'&project='+encodeURIComponent(doc().project);
      modal('Ссылка на требование',field('link','Открыть в этой копии проекта',url.href,'readonly'),()=>{},'Закрыть');
      document.querySelector('#fields input').select();
    }
  }
  return {view,bind,handle,set,selectRoute};
}
