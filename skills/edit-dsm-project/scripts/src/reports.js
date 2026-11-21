/* Report rows are plain values so the UI, CLI and CSV export share results. */
const Reports = (() => {
  const definitions={
    cycles:['Циклы вызовов',['Участники','Размер']],
    reciprocal:['Взаимные вызовы',['Объект','Партнёр','Вес туда','Вес обратно']],
    isolated:['Объекты без связей DSM',['ID','Название','Тип']],
    contracts:['Вызовы с совместной проверкой',['Откуда','Куда','Вес проверки','Основание']],
    segments:['Межсегментные зависимости',['Откуда','Куда','Сегмент источника','Сегмент цели']],
    releases:['Межрелизные контракты',['Откуда','Куда','Слой','Релиз источника','Релиз цели']],
    consumers:['Наиболее используемые контракты',['ID','Прямые потребители','Сумма весов']],
    placement:['Карта размещения',['Объект','Площадка','Тип площадки']],
    unplaced:['Компоненты без размещения',['ID','Тип','Название']],
    owners:['Объекты без владельца',['ID','Тип','Название']],
    verification:['Требования без проверяющего объекта',['ID','Название']],
    unchecked:['Вызовы без совместной проверки',['Откуда','Куда','Основание вызова']],
    decisions:['ADR без предложения',['ID','Решение','Статус']],
    singleHost:['Единственная площадка сервиса',['Объект','Единственная площадка']],
    duplicates:['Совпадающие названия',['Название','Объекты','Количество']],
    backlog:['Объём бэклога по сегментам',['Сегмент','Фичи','Известная оценка','Без оценки']],
    reserve:['Резерв ёмкости релизов',['ID','Ёмкость','Известная загрузка','Остаток','Без оценки']],
    blocked:['Потребители заблокированных объектов',['Блокировка','Зависимый объект','Глубина']]
  };
  function adjacent(ids,edges){
    const map=new Map(ids.map(id=>[id,[]]));
    for(const [from,to] of edges)map.get(from).push(to);
    return map;
  }
  function components(ids,out,back){
    const visited=new Set(),order=[];
    for(const id of ids){
      if(visited.has(id))continue;
      visited.add(id);
      const stack=[[id,0]];
      while(stack.length){
        const frame=stack.at(-1),neighbors=out.get(frame[0]);
        if(frame[1]===neighbors.length){order.push(frame[0]);stack.pop();continue;}
        const next=neighbors[frame[1]++];
        if(!visited.has(next)){visited.add(next);stack.push([next,0]);}
      }
    }
    visited.clear();
    const groups=[];
    for(const id of order.reverse()){
      if(visited.has(id))continue;
      const members=[id];visited.add(id);
      for(let i=0;i<members.length;i++)for(const n of back.get(members[i]))if(!visited.has(n)){visited.add(n);members.push(n);}
      if(members.length>1)groups.push([members.sort().join(', '),members.length]);
    }
    return groups;
  }
  function run(model,key){
    if(!Object.hasOwn(definitions,key))throw Error('Неизвестный отчёт: '+key);
    const {nodes,edges}=model,by=new Map(nodes.map(n=>[n.id,n])),ids=[...by.keys()];
    const flow=edges.filter(e=>e.layer==='flow'),calls=flow.map(e=>[e.from,e.to]);
    const reverse=new Map(flow.map(e=>[JSON.stringify([e.to,e.from]),e]));
    const risk=new Map(edges.filter(e=>e.layer==='risk').map(e=>[JSON.stringify([e.from,e.to].sort()),e]));
    const check=e=>risk.get(JSON.stringify([e.from,e.to].sort()));
    const linked=new Set(edges.flatMap(e=>[e.from,e.to]));
    const typed=nodes.flatMap(n=>(n.relations||[]).map(([type,to])=>({from:n.id,type,to})));
    const targets=type=>new Set(typed.filter(r=>r.type===type).map(r=>r.to));
    const places=new Map(ids.map(id=>[id,[]]));
    for(const r of typed)if(r.type==='deployedOn')places.get(r.from).push(r.to);
    const deployable=nodes.filter(n=>['component','service'].includes(n.kind));
    const byName=new Map(),summaries=new Map();
    let rows;
    switch(key){
      case 'cycles':rows=components(ids,adjacent(ids,calls),adjacent(ids,calls.map(([a,b])=>[b,a])));break;
      case 'reciprocal':rows=flow.filter(e=>e.from<e.to&&reverse.has(JSON.stringify([e.from,e.to]))).map(e=>[e.from,e.to,e.weight,reverse.get(JSON.stringify([e.from,e.to])).weight]);break;
      case 'isolated':rows=nodes.filter(n=>!linked.has(n.id)).map(n=>[n.id,n.name,n.kind]);break;
      case 'contracts':rows=flow.filter(check).map(e=>[e.from,e.to,check(e).weight,check(e).reason]);break;
      case 'segments':rows=flow.filter(e=>by.get(e.from).segment&&by.get(e.to).segment&&by.get(e.from).segment!==by.get(e.to).segment).map(e=>[e.from,e.to,by.get(e.from).segment,by.get(e.to).segment]);break;
      case 'releases':rows=edges.filter(e=>by.get(e.from).release&&by.get(e.to).release&&by.get(e.from).release!==by.get(e.to).release).map(e=>[e.from,e.to,e.layer,by.get(e.from).release,by.get(e.to).release]);break;
      case 'consumers':
        for(const e of flow){const row=summaries.get(e.to)||[e.to,0,0];row[1]++;row[2]+=e.weight;summaries.set(e.to,row);}
        rows=[...summaries.values()].sort((a,b)=>b[1]-a[1]||b[2]-a[2]||a[0].localeCompare(b[0]));break;
      case 'placement':rows=typed.filter(r=>r.type==='deployedOn').map(r=>[r.from,r.to,by.get(r.to).kind]);break;
      case 'unplaced':rows=deployable.filter(n=>!places.get(n.id).length).map(n=>[n.id,n.kind,n.name]);break;
      case 'owners':{
        const owned=targets('owns');
        rows=nodes.filter(n=>['system','component','service','data','server','cluster'].includes(n.kind)&&!String(n.attrs?.owner??'').trim()&&!owned.has(n.id)).map(n=>[n.id,n.kind,n.name]);break;
      }
      case 'verification':{const verified=targets('verifies');rows=nodes.filter(n=>n.kind==='requirement'&&!verified.has(n.id)).map(n=>[n.id,n.name]);break;}
      case 'unchecked':rows=flow.filter(e=>!check(e)).map(e=>[e.from,e.to,e.reason]);break;
      case 'decisions':{
        const proposals=nodes.filter(n=>n.kind==='proposal');
        rows=nodes.filter(n=>n.kind==='adr'&&!proposals.some(p=>p.refs?.includes(n.id)||n.refs?.includes(p.id))).map(n=>[n.id,n.name,n.state]);break;
      }
      case 'singleHost':rows=deployable.filter(n=>places.get(n.id).length===1).map(n=>[n.id,places.get(n.id)[0]]);break;
      case 'duplicates':
        for(const n of nodes){const k=n.name.trim().toLocaleLowerCase().replace(/\s+/g,' ');if(!byName.has(k))byName.set(k,[]);byName.get(k).push(n);}
        rows=[...byName.values()].filter(g=>g.length>1).map(g=>[g[0].name,g.map(n=>n.id).join(', '),g.length]);break;
      case 'backlog':
        for(const n of nodes.filter(n=>n.kind==='feature'&&!n.release)){const s=n.segment||'—',row=summaries.get(s)||[s,0,0,0];row[1]++;row[2]+=n.effort??0;if(n.effort===null)row[3]++;summaries.set(s,row);}
        rows=[...summaries.values()];break;
      case 'reserve':
        rows=ModelForReports.plan(model).map(r=>[r.id,r.capacity,r.knownEffort,r.capacity===null?null:r.capacity-r.knownEffort,r.unknown]);break;
      case 'blocked':{
        const back=adjacent(ids,calls.map(([a,b])=>[b,a]));rows=[];
        for(const n of nodes.filter(n=>n.state==='blocked')){
          const queue=[[n.id,0]],seen=new Set([n.id]);
          for(let i=0;i<queue.length;i++)for(const id of back.get(queue[i][0]))if(!seen.has(id)){seen.add(id);const depth=queue[i][1]+1;queue.push([id,depth]);rows.push([n.id,id,depth]);}
        }break;
      }
    }
    return {key,title:definitions[key][0],columns:definitions[key][1],rows};
  }
  const ModelForReports=typeof DSM!=='undefined'?DSM:require('./model.js');
  return {definitions,run};
})();
if(typeof module!=='undefined')module.exports=Reports;
