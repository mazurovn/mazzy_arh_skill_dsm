/* Browser projections share the selected model identities with the DSM. */
const Views = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const types = {product:'Продукт',module:'Модуль',component:'Компонент',release:'Релиз',feature:'Фича',actor:'Участник',capability:'Способность',process:'Процесс',system:'Система',service:'Сервис',data:'Данные',artifact:'Артефакт',scenario:'Сценарий',proposal:'OpenSpec proposal',adr:'ADR',requirement:'Требование',deviation:'Отклонение',organization:'Организация',project:'Проект',installation:'Установка',procurement:'Закупка',server:'Сервер',cluster:'Кластер',domain:'Домен',dataArea:'Предметная область данных',request:'Запрос на изменение',changeTask:'Задача изменения'};
  const relations={realizes:'Реализует',deployedOn:'Размещён на',dependsOn:'Зависит от',uses:'Использует',owns:'Отвечает за',produces:'Создаёт',verifies:'Проверяет'};
  const modes = {neighbors:'Окружение объекта',all:'Граф кластеров',tree:'Иерархия состава',component:'Компонентная диаграмма',concept:'Концептуальная диаграмма',sequence:'Диаграмма последовательности'};
  const fieldNames = {id:'ID',name:'Название',title:'Проект',kind:'Тип',state:'Статус',parent:'Родитель',release:'Релиз',segment:'Сегмент',bundle:'Пакет',effort:'Оценка',capacity:'Ёмкость',note:'Текст',layer:'Слой',from:'Откуда',to:'Куда',weight:'Вес',reason:'Основание',refs:'Ссылки',steps:'Шаги',attrs:'Атрибуты',relations:'Типизированные связи'};
  const clip = (s, limit) => s.length>limit ? s.slice(0,limit-1)+'…' : s;
  const direction = layer => layer==='risk'?' ↔ ':' → ';
  function group(nodes, key) {
    const buckets = new Map();
    for(const node of nodes){const label=key(node);if(!buckets.has(label))buckets.set(label,[]);buckets.get(label).push(node.id);}
    return Array.from(buckets, ([label,ids])=>({label,ids}));
  }
  function markers() {
    return '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#37816b"/></marker></defs>';
  }
  function svg(width,height,body) {
    return '<div class="graphbox"><svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" aria-label="Архитектурная диаграмма" style="min-width:'+width+'px" font-family="Arial, sans-serif">'+markers()+body+'</svg></div>';
  }
  function nodeBox(n,x,y,active,component=false) {
    const title=esc(n.id+' · '+n.name);
    return '<g role="button" tabindex="0" aria-label="'+title+'" data-action="focus" data-id="'+esc(n.id)+'" transform="translate('+x+','+y+')"><title>'+title+'</title><rect width="148" height="45" rx="6" fill="'+(active?'#12563f':'#f0f6f3')+'" stroke="#8eb9a7"/>'+
      (component?'<path d="M131 8h10v10h-10z M128 10h5v2h-5z M128 15h5v2h-5z" fill="white" stroke="#69917e"/>':'')+
      '<text x="9" y="17" font-size="12" font-weight="bold" fill="'+(active?'white':'#183d30')+'">'+esc(clip(n.id,19))+'</text><text x="9" y="34" font-size="10" fill="'+(active?'#d9f6e6':'#39594a')+'">'+esc(clip(n.name,23))+'</text></g>';
  }
  function link(e,path,active,label='') {
    const selectable=['flow','risk'].includes(e.layer);
    const title=esc(e.from+direction(e.layer)+e.to+' · '+e.reason);
    const action=selectable?'cell':'structure';
    return '<g role="button" tabindex="0" aria-label="'+title+'" data-action="'+action+'" data-id="'+esc(e.from)+'" data-to="'+esc(e.to)+'" data-layer="'+e.layer+'"><title>'+title+'</title>'+
      '<path d="'+path+'" fill="none" stroke="transparent" stroke-width="14"/><path d="'+path+'" fill="none" stroke="'+(active?'#a55412':selectable?'#49937c':'#758894')+'" stroke-width="'+(active?3:2)+'" '+(e.layer==='risk'?'stroke-dasharray="5 3"':'marker-end="url(#arrow)"')+'/>'+label+'</g>';
  }
  function sequence(model, steps, focus, pair) {
    const by=new Map(model.nodes.map(n=>[n.id,n]));
    const edges=new Map(model.edges.filter(e=>e.layer==='flow').map(e=>[DSM.ek(e),e]));
    if(!steps.length)return '<p class="empty">Добавьте сценарий и укажите вызовы в порядке выполнения.</p>';
    const ids=[...new Set(steps.flat())], width=ids.length*205+45, height=steps.length*66+110;
    const pos=new Map(ids.map((id,i)=>[id,105+i*205]));
    const lanes=ids.map(id=>'<path d="M'+pos.get(id)+' 62V'+(height-12)+'" stroke="#9fb6aa" stroke-dasharray="5 4"/>'+nodeBox(by.get(id),pos.get(id)-74,14,id===focus));
    const messages=steps.map(([from,to],i)=>{
      const e=edges.get(DSM.ek({layer:'flow',from,to})), x=pos.get(from), u=pos.get(to), y=101+66*i;
      const label='<text x="'+((x+u)/2)+'" y="'+(y-9)+'" text-anchor="middle" font-size="12" fill="#193e31">'+esc((i+1)+'. '+clip(e.reason,Math.max(19,Math.floor(Math.abs(x-u)/8))))+'</text>';
      return link(e,'M'+x+' '+y+'H'+u,pair?.[0]===from&&pair?.[1]===to,label);
    });
    return svg(width,height,lanes.concat(messages).join(''));
  }
  function structures(model) {
    return model.nodes.flatMap(n=>[
      ...(n.parent?[{layer:'parent',from:n.parent,to:n.id,reason:'Входит в состав'}]:[]),
      ...(n.refs||[]).map(to=>({layer:'ref',from:n.id,to,reason:'Ссылка артефакта'})),
      ...(n.relations||[]).map(([kind,to])=>({layer:kind,from:n.id,to,reason:relations[kind]}))
    ]);
  }
  function diagram(model, mode, layer, focus, pair, clusters, selectedStructure) {
    const by=new Map(model.nodes.map(n=>[n.id,n]));
    let nodes=model.nodes, edges=model.edges.filter(e=>e.layer===layer), columns;
    if(mode==='tree'){
      edges=nodes.filter(n=>n.parent).map(n=>({layer:'parent',from:n.parent,to:n.id,reason:'Входит в состав'}));
      const depth=n=>{let d=0;while(n.parent){d++;n=by.get(n.parent);}return d;};
      columns=group(nodes,depth).sort((a,b)=>a.label-b.label).map(c=>({...c,label:'Уровень '+(c.label+1)}));
    }else if(mode==='component'){
      nodes=nodes.filter(n=>['module','component','system','service','product'].includes(n.kind));
      const ids=new Set(nodes.map(n=>n.id));edges=edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
      columns=group(nodes,n=>types[n.kind]);
    }else if(mode==='concept'){
      edges=structures(model);
      columns=group(nodes,n=>n.segment||types[n.kind]);
    }else if(mode==='neighbors'){
      edges=edges.filter(e=>e.from===focus||e.to===focus);
      const sources=new Set(edges.map(e=>e.from)), targets=new Set(edges.map(e=>e.to));
      nodes=nodes.filter(n=>n.id===focus||sources.has(n.id)||targets.has(n.id));
      const labels=layer==='flow'?['Вызывают объект','Объект','Получатели']:['Связанные объекты','Объект'];
      columns=labels.map((label,i)=>({label,ids:nodes.filter(n=>(n.id===focus?1:layer==='risk'||sources.has(n.id)?0:2)===i).map(n=>n.id)}));
    }else columns=clusters.map((ids,i)=>({ids,label:'Кластер '+(i+1)}));
    columns=columns.filter(c=>c.ids.length);
    if(!columns.length)return '<p class="empty">Для этого представления пока нет объектов.</p>';
    const positions=new Map(),height=90+Math.max(...columns.map(c=>c.ids.length))*73;
    const labels=columns.map((c,j)=>{
      const x=22+216*j;
      c.ids.forEach((id,i)=>positions.set(id,[x,51+i*73]));
      return '<text x="'+x+'" y="26" font-size="12" font-weight="bold" fill="#4f6c60">'+esc(clip(String(c.label),24))+'</text>';
    });
    const paths=edges.map(e=>{
      const [x,y]=positions.get(e.from),[u,v]=positions.get(e.to),same=x===u;
      const a=x+(u>=x?148:0),z=u+(same||u<x?148:0),mid=same?a+43:(a+z)/2;
      const mx=(a+6*mid+z)/8,my=(y+v)/2+22;
      const handle=['flow','risk'].includes(e.layer)?'<circle cx="'+mx+'" cy="'+my+'" r="9" fill="white" stroke="#73a18b"/><text x="'+mx+'" y="'+(my+3)+'" text-anchor="middle" font-size="9" fill="#234c3a">'+e.weight+'</text>':'';
      return link(e,'M'+a+' '+(y+22)+' C'+mid+' '+(y+22)+' '+mid+' '+(v+22)+' '+z+' '+(v+22),
        (pair&&['risk','flow'].includes(e.layer)&&DSM.ek(e)===DSM.ek({layer,from:pair[0],to:pair[1]}))||(selectedStructure?.from===e.from&&selectedStructure.to===e.to&&selectedStructure.layer===e.layer),handle);
    });
    return svg(columns.length*216+16,height,labels.concat(paths,nodes.map(n=>nodeBox(n,...positions.get(n.id),n.id===focus,mode==='component'))).join(''));
  }
  const display=v=>v===null||v===undefined||v===''?'—':typeof v==='object'?JSON.stringify(v):String(v);
  function deltaMatrix(changes) {
    const cells=new Map(),ids=new Set();
    for(const c of changes.filter(c=>c.type==='edges'&&c.key!=='(порядок)')){
      const edge=c.after||c.before;
      for(const [from,to] of edge.layer==='risk'?[[edge.from,edge.to],[edge.to,edge.from]]:[[edge.from,edge.to]]){
        ids.add(from);ids.add(to);const key=JSON.stringify([from,to]);
        const label=(edge.layer==='risk'?'Проверка':'Вызов')+' · '+(c.before?.weight??0)+' → '+(c.after?.weight??0);
        const reason=[c.before?.reason,c.after?.reason].filter(Boolean).join(' → ');
        cells.set(key,(cells.get(key)||'')+'<div title="'+esc(reason)+'">'+esc(label)+'</div>');
      }
    }
    const order=[...ids];if(!order.length)return '';
    return '<h3>Изменённые ячейки DSM</h3><div class="wrap"><table class="table"><thead><tr><th></th>'+order.map(id=>'<th>'+esc(id)+'</th>').join('')+'</tr></thead><tbody>'+order.map(from=>'<tr><th>'+esc(from)+'</th>'+order.map(to=>'<td>'+(cells.get(JSON.stringify([from,to]))||'·')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function differences(changes) {
    if(!changes.length)return '<p>Модели совпадают.</p>';
    const rows=changes.flatMap(c=>{
      const item=c.after??c.before;
      const label=item?.from?item.from+direction(item.layer)+item.to:c.key;
      const fields=typeof item==='object'&&!Array.isArray(item)?[...new Set([...Object.keys(c.before||{}),...Object.keys(c.after||{})])]:[];
      const status=c.before===null?'Добавлено':c.after===null?'Удалено':'Изменено';
      return fields.length?fields.filter(k=>JSON.stringify(c.before?.[k])!==JSON.stringify(c.after?.[k])).map(k=>[label,status,fieldNames[k]||k,display(c.before?.[k]),display(c.after?.[k])]):[[label,status,'Значение',display(c.before),display(c.after)]];
    });
    return '<div class="wrap diff-table"><table class="table"><thead><tr>'+['Объект','Действие','Поле','Было','Стало'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
      '<details class="delta"><summary>Схема изменений</summary>'+deltaMatrix(changes)+rows.map(([id,,field,before,after])=>'<div class="delta-row"><b>'+esc(id)+' · '+esc(field)+'</b><span>'+esc(before)+'</span><i aria-label="переход">→</i><strong>'+esc(after)+'</strong></div>').join('')+'</details>';
  }
  return {types,relations,modes,structures,diagram,sequence,differences};
})();
