/* Procurement quantities are enumerated per site. Running replicas remain pinned during recovery. */
const Fleet=(()=>{
  const resources=['cpuCores','ramGiB','diskGiB'];
  const textOrder=(a,b)=>a<b?-1:a>b?1:0;
  const ids=(n,k)=>(n?.relations||[]).filter(([kind])=>kind===k).map(([,id])=>id);
  const role=n=>n?.attrs?.fleetRole;
  const fail=m=>{throw Error(m);};
  function integer(v,label,min=0){
    if(!Number.isSafeInteger(v)||v<min)fail(label+' · требуется целое число от '+min);
    return v;
  }
  const sorted=nodes=>nodes.slice().sort((a,b)=>textOrder(a.id,b.id));
  function inputs(model,id){
    const by=new Map(model.nodes.map(n=>[n.id,n])),buy=by.get(id);
    if(buy?.kind!=='procurement')fail('Выберите закупку');
    const sites=sorted(ids(buy,'uses').map(k=>by.get(k)).filter(n=>n?.kind==='installation'&&!n.attrs?.verification));
    if(!sites.length)fail(id+' · добавьте площадку или свяжите закупку с инсталляцией через uses');
    const usedClusters=new Set();
    return sites.map(site=>{
      const clusters=ids(site,'deployedOn').filter(k=>by.get(k)?.kind==='cluster');
      if(clusters.length!==1||usedClusters.has(clusters[0]))fail(site.id+' · требуется отдельный кластер площадки');
      usedClusters.add(clusters[0]);
      const pools=sorted(model.nodes.filter(n=>role(n)==='stock'&&n.parent===site.id)).map(n=>{
        const skus=ids(n,'uses').map(id=>by.get(id)).filter(n=>n?.kind==='server');
        if(skus.length!==1)fail(n.id+' · укажите один серверный профиль');
        const sku=skus[0];
        return {id:n.id,sku:sku.id,limits:resources.map(k=>integer(sku.attrs?.[k],sku.id+' / '+k,1)),
          price:integer(sku.attrs?.unitPriceRub,sku.id+' / unitPriceRub'),quantity:integer(n.attrs.quantity,n.id+' / quantity'),maxBuy:integer(n.attrs.maxBuy,n.id+' / maxBuy')};
      });
      if(!pools.length)fail(site.id+' · заполните состав парка');
      if(new Set(pools.map(p=>p.sku)).size!==pools.length)fail(site.id+' · повтор серверного профиля в парке');
      const loads=sorted(model.nodes.filter(n=>['service','component','module','system'].includes(n.kind)&&ids(n,'deployedOn').includes(site.id))).map(n=>{
        const demand=resources.map(k=>integer(n.attrs?.[k],n.id+' / '+k));
        if(!demand.some(Boolean))fail(n.id+' · пустая нагрузка');
        if(n.attrs?.antiAffinity!==undefined&&typeof n.attrs.antiAffinity!=='boolean')fail(n.id+' · antiAffinity требует true или false');
        return {id:n.id,demand,count:integer(n.attrs?.replicas,n.id+' / replicas',1),apart:n.attrs?.antiAffinity===true};
      });
      if(!loads.length)fail(site.id+' · назначьте рабочие нагрузки');
      if(loads.reduce((s,l)=>s+l.count,0)>256||pools.reduce((s,p)=>s+p.quantity+p.maxBuy,0)>96)fail(site.id+' · расчёт рассчитан на 256 реплик и 96 узлов на площадку');
      return {id:site.id,cluster:clusters[0],pools,loads};
    });
  }
  function replicas(site){
    const max=resources.map((_,i)=>Math.max(...site.pools.map(p=>p.limits[i])));
    return site.loads.map(l=>({...l,priority:Math.max(...l.demand.map((v,i)=>v/max[i]))})).sort((a,b)=>b.priority-a.priority||textOrder(a.id,b.id))
      .flatMap(l=>Array.from({length:l.count},(_,i)=>({id:l.id+'#'+(i+1),load:l.id,demand:l.demand,apart:l.apart})));
  }
  function place(hosts,items){
    const missing=[];
    for(const r of items){
      let best=null,score=Infinity;
      for(const h of hosts){
        if(r.apart&&h.replicas.some(prev=>prev.load===r.load))continue;
        const left=h.free.map((v,i)=>v-r.demand[i]);if(left.some(v=>v<0))continue;
        const waste=left.reduce((sum,v,i)=>sum+v/h.limits[i],0);
        if(waste<score){best=h;score=waste;}
      }
      if(best){best.free=best.free.map((v,i)=>v-r.demand[i]);best.replicas.push(r);}
      else missing.push(r);
    }
    return missing;
  }
  function evaluate(site,order,items=replicas(site)){
    const hosts=[];let cost=0,units=0;
    for(const p of site.pools){
      const add=integer(order[p.id]??0,'Заказ '+p.id);
      if(add>p.maxBuy)fail('Превышен доступный заказ '+p.id);
      cost=integer(cost+add*p.price,'Стоимость заказа');units+=add;
      for(let i=1;i<=p.quantity+add;i++)hosts.push({id:p.id+'#'+i,pool:p.id,sku:p.sku,limits:p.limits,free:[...p.limits],replicas:[]});
    }
    const missing=place(hosts,items);
    const failures=hosts.map(dead=>{
      const live=hosts.filter(h=>h!==dead).map(h=>({...h,free:[...h.free],replicas:[...h.replicas]}));
      const displaced=new Set([...dead.replicas,...missing].map(r=>r.id));
      const pending=place(live,items.filter(r=>displaced.has(r.id)));
      return {host:dead.id,pool:dead.pool,lost:dead.replicas.map(r=>r.id),unplaced:pending.map(r=>r.id),
        moves:live.flatMap(h=>h.replicas.filter(r=>displaced.has(r.id)).map(r=>[r.id,h.id]))};
    });
    return {site:site.id,order:{...order},units,cost,hosts,missing:missing.map(r=>r.id),failures,
      worst:Math.max(missing.length,0,...failures.map(f=>f.unplaced.length)),idle:hosts.filter(h=>!h.replicas.length).length};
  }
  function optimized(site){
    const options=site.pools.reduce((n,p)=>n*(p.maxBuy+1),1),items=replicas(site);
    const maxHosts=site.pools.reduce((n,p)=>n+p.maxBuy+p.quantity,0);
    if(options>10000||options*items.length*Math.max(1,maxHosts)**2>20000000)fail(site.id+' · сузьте пределы заказа для полного перебора');
    const best=new Map(),order={};
    function consider(key,result){
      const old=best.get(key);
      if(!old||result.cost<old.cost||result.cost===old.cost&&result.units<old.units)best.set(key,result);
    }
    function visit(i){
      if(i<site.pools.length){
        const p=site.pools[i];for(let q=0;q<=p.maxBuy;q++){order[p.id]=q;visit(i+1);}return;
      }
      const result=evaluate(site,order,items);
      if(result.missing.length)return;
      consider('normal',result);
      if(result.worst)return;
      consider('resilient',result);
      for(const sku of site.pools.map(p=>p.sku))if(site.pools.every(p=>p.sku===sku||!order[p.id]))consider('sku:'+sku,result);
      if(!result.units)consider('existing',result);
    }
    visit(0);return {best,options};
  }
  function summary(key,label,sites){
    const valid=sites.every(Boolean);
    return {key,label,available:valid,sites,units:valid?sites.reduce((s,x)=>s+x.units,0):null,cost:valid?integer(sites.reduce((s,x)=>s+x.cost,0),'Суммарная стоимость'):null,
      idle:valid?sites.reduce((s,x)=>s+x.idle,0):null,worst:valid?Math.max(...sites.map(x=>x.worst)):null,
      missing:valid?sites.reduce((s,x)=>s+x.missing.length,0):null};
  }
  const cache=new WeakMap();
  function analyze(model,id){
    if(!cache.has(model))cache.set(model,new Map());const known=cache.get(model);if(known.has(id))return known.get(id);
    const sites=inputs(model,id),search=sites.map(optimized);
    const choices=[summary('asis','AS-IS · текущий парк',sites.map(s=>evaluate(s,{})))];
    const types=[...new Set(sites.flatMap(s=>s.pools.map(p=>p.sku)))].sort();
    for(const [key,label] of [['normal','Минимум для штатной работы'],['resilient','Минимум с резервом N−1'],...types.map(t=>['sku:'+t,'Закупать только '+t+' · N−1'])]){
      choices.push(summary(key,label,search.map(s=>s.best.get(key)||(key.startsWith('sku:')?s.best.get('existing'):null)||null)));
    }
    const result={id,sites,choices,examined:search.reduce((s,x)=>s+x.options,0)};known.set(id,result);return result;
  }
  function tree(candidate,budget){
    const checks=[['Доступен состав в пределах заказа',candidate.available],['Все реплики размещены',candidate.missing===0],
      ['Каждый одиночный отказ выдержан',candidate.worst===0],['В пределах бюджета',budget==null||candidate.cost<=budget]];
    const stops=['Пересмотреть доступные типы и пределы закупки','Добавить ёмкость или изменить размещение','Увеличить резерв площадки','Пересогласовать бюджет'];
    return {checks:checks.map(([question,pass],i)=>({question,pass,no:stops[i]})),outcome:stops[checks.findIndex(x=>!x[1])]||'Предложить к согласованию'};
  }
  return {resources,role,ids,inputs,replicas,evaluate,analyze,summary,tree};
})();
if(typeof module!=='undefined')module.exports=Fleet;
