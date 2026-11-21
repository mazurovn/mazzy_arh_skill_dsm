const FleetSource=((M,F,C)=>{
  const limit=2*1024*1024;
  const sourceKinds=['catalog','requirements','specifications','contracts'];
  const utf8=b=>new TextDecoder().decode(b).replace(/^\uFEFF/,'');
  function encode(bytes){let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(raw);}
  function decode(n){return Uint8Array.from(atob(n.attrs.content64),ch=>ch.charCodeAt(0));}
  async function ingest(doc,category,name,bytes,root,requirement){
    if(!sourceKinds.includes(category)||!bytes.length||bytes.length>limit)throw Error('Выберите непустой файл до 2 МиБ');
    const m=M.head(doc).data;
    if(requirement&&!m.nodes.some(n=>n.id===requirement&&n.kind==='requirement'&&n.refs?.includes(root)))throw Error('Выберите требование этой закупки');
    const ext=name.split('.').pop().toLowerCase();
    let input;
    if(ext==='csv'||ext==='tsv')input=F.readCsv(utf8(bytes),{source:name});
    else if(ext==='xlsx')input=await (typeof ExcelIO!=='undefined'?ExcelIO:require('./excel.js')).read(bytes,{source:name});
    else if(ext==='md'&&category==='specifications'){
      const title=utf8(bytes).split(/\r?\n/).find(s=>s.trim())?.replace(/^#+\s*/,'')||name;
      const previous=m.nodes.find(n=>n.attrs?.fleetRole==='specification'&&n.attrs?.filename===name&&n.refs?.includes(root));
      input={kind:'merge',nodes:[{id:previous?.id||C.fresh(m,'SPEC'),name:title,note:utf8(bytes),attrs:{filename:name}}],edges:[]};
    }else throw Error('Поддерживаются CSV, TSV, XLSX и Markdown для спецификаций');
    if(input.kind!=='merge')throw Error('Здесь нужен исходный каталог. Версионные проекции возвращаются через Обмен.');
    if(category==='requirements'||category==='specifications'){
      if(!input.nodes.length||input.edges.length)throw Error('Нужна таблица описаний с id и name');
      const type=category==='requirements'?'requirement':'artifact';
      const by=new Map(m.nodes.map(n=>[n.id,n]));
      input.nodes=input.nodes.map(n=>{
        const prev=by.get(n.id);if(prev&&prev.kind!==type||n.kind&&n.kind!==type)throw Error('Конфликт типа '+n.id);
        return {...n,kind:type,refs:[...new Set([...(n.refs??prev?.refs??[]),...(root?[root]:[]),...(category==='specifications'&&requirement?[requirement]:[])])],
          ...(type==='artifact'?{attrs:{...prev?.attrs,...n.attrs,fleetRole:'specification'}}:{})};
      });
    }
    let next=F.preview(doc,input);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    const roots=input.nodes.filter(n=>n.kind==='procurement').map(n=>n.id);
    const owner=root||roots[0]||'';
    const refs=[...new Set([...(owner?[owner]:[]),...input.nodes.map(n=>n.id),...input.edges.flatMap(e=>[e.from,e.to]),...(input.relations||[]).flatMap(e=>[e.from,e.to])])];
    refs.sort();
    if(!refs.length)throw Error('У источника нет связанных объектов');
    const previous=m.nodes.find(n=>n.attrs?.fleetRole==='source'&&n.attrs.category===category&&n.attrs.filename===name&&n.parent===owner);
    const id=previous?.id||C.fresh(next,'SOURCE');
    next=M.patch(next,[{op:'node',value:{id,name,kind:'artifact',parent:owner,note:'Исходный документ · '+category,refs,
      attrs:{fleetRole:'source',filename:name,category,sha256:digest,bytes:bytes.length,content64:encode(bytes)}}}]);
    return next;
  }
  async function verifyResult(input){
    if(input.kind!=='fleet-result')return input;
    const hashes=input.data.nodes.filter(n=>n.attrs?.fleetRole==='source'&&n.parent===input.lab.root).map(n=>n.attrs);
    const src=input.lab.inventory_source;
    for(const entry of src?[...hashes,src]:hashes){
      const raw=decode({attrs:entry}),sha=await crypto.subtle.digest('SHA-256',raw);
      if(raw.length!==entry.bytes||Array.from(new Uint8Array(sha),b=>b.toString(16).padStart(2,'0')).join('')!==entry.sha256)throw Error('Неверная контрольная сумма '+entry.filename);
    }
    if(src){
      const bytes=decode({attrs:src}),xlsx=typeof ExcelIO!=='undefined'?ExcelIO:require('./excel.js');
      const sheets=/\.xlsx$/i.test(src.filename)?await xlsx.read(bytes,{rawRows:true}):[F.splitCsv(utf8(bytes))];
      const rows=sheets.flatMap(([head,...body])=>body.map(row=>Object.fromEntries(head.map((k,i)=>[k,row[i]]))));
      const observations=rows.map(r=>[String(r.serial??'').trim(),r.pool,...['cpuCores','ramGiB','diskGiB'].map(k=>Number(r[k]))]);
      if(JSON.stringify(observations)!==JSON.stringify(input.lab.inventory.map(r=>[r.serial,r.pool,...r.values])))throw Error('Замеры в блокноте расходятся с исходной ведомостью');
    }
    return input;
  }
  return {ingest,decode,encode,sourceKinds,verifyResult};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Formats!=='undefined'?Formats:require('./formats.js'),typeof FleetChange!=='undefined'?FleetChange:require('./fleet-change.js'));
if(typeof module!=='undefined')module.exports=FleetSource;
