const Formats = ((M,A)=>{
  const nodeCols=[...M.nodeCols,...M.optionalNodeCols];
  const allCols=['record',...nodeCols,...M.edgeCols,'project','base'];
  const row=(o,cols)=>cols.map(k=>o[k]!==null&&typeof o[k]==='object'?JSON.stringify(o[k]):o[k]??'');
  function object(cols,cells){
    if(cells.length>cols.length) throw Error('Лишние столбцы в строке: '+cells.join(', '));
    return Object.fromEntries(cols.map((k,i)=>[k,cells[i]??'']));
  }
  const meta=doc=>({project:doc.project,base:M.head(doc).rev,title:M.head(doc).data.title});
  function tables(doc){
    const d=M.head(doc).data,m=meta(doc);
    return {Project:[['project','base','title'],[m.project,m.base,m.title]],
      Nodes:[nodeCols,...d.nodes.map(n=>row(n,nodeCols))],Edges:[M.edgeCols,...d.edges.map(e=>row(e,M.edgeCols))]};
  }
  function pick(o,cols){return Object.fromEntries(cols.filter(k=>k in o).map(k=>[k,o[k]]));}
  function getNode(o){
    const n=pick(o,nodeCols);
    for(const k of M.optionalNodeCols){if(n[k])n[k]=JSON.parse(n[k]);else delete n[k];}
    for(const k of ['effort','capacity'])if(k in n)n[k]=n[k]===''?null:Number(n[k]);
    if(!n.kind)delete n.kind;if(!n.state)delete n.state;return M.node(n);
  }
  function getEdge(o){return M.edge({...pick(o,M.edgeCols),weight:Number(o.weight)});}
  function readTables(t){
    for(const [k,cols] of [['Project',['project','base','title']],['Nodes',M.nodeCols],['Edges',M.edgeCols]]){
      if(!t[k]?.length||!cols.every(c=>t[k][0].includes(c))||new Set(t[k][0]).size!==t[k][0].length)throw Error('Проверьте заголовки таблицы '+k);
    }
    if(t.Project.length!==2)throw Error('Таблица Project должна содержать одну запись');
    const m=object(t.Project[0],t.Project[1]);
    return {kind:'projection',project:m.project,base:m.base,data:M.validate({title:m.title,nodes:t.Nodes.slice(1).map(r=>getNode(object(t.Nodes[0],r))),edges:t.Edges.slice(1).map(r=>getEdge(object(t.Edges[0],r)))})};
  }
  function csv(rows){return '\uFEFF'+rows.map(cells=>cells.map(c=>'"'+String(c??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
  function splitCsv(text){
    text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0].replace(/"(?:[^"]|"")*"/g,'');
    const sep=[',',';','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
    const rows=[];let r=[],s='',quoted=false,closed=false;
    function end(){r.push(s);s='';closed=false;}
    for(let i=0;i<text.length;i++){const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){s+='"';i++;}else{quoted=false;closed=true;}}else s+=c;continue;}
      if(c===sep){end();continue;}
      if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;end();if(r.some(x=>x!==''))rows.push(r);r=[];continue;}
      if(closed)throw Error('Символ после закрывающей кавычки CSV');
      if(c==='"'){if(s)throw Error('Кавычка внутри поля CSV');quoted=true;}else s+=c;
    }
    if(quoted)throw Error('Незакрытая кавычка CSV');end();if(r.some(x=>x!==''))rows.push(r);return rows;
  }
  function emitCsv(doc){const d=M.head(doc).data,m=meta(doc);return csv([allCols,row({record:'project',name:d.title,...m},allCols),...d.nodes.map(n=>row({record:'node',...n},allCols)),...d.edges.map(e=>row({record:'edge',...e},allCols))]);}
  const aliases={'код':'id','code':'id','название':'name','имя':'name','тип':'kind','состояние':'state','от':'from','к':'to','вес':'weight','обоснование':'reason','основание':'reason','релиз':'release','сегмент':'segment','оценка':'effort','ёмкость':'capacity','слой':'layer','родитель':'parent'};
  function readCsv(txt,options={}){
    const [header,...rows]=splitCsv(txt);if(!header)throw Error('Пустой CSV');
    const cols=header.map(v=>v.trim().startsWith('attr.')?v.trim():aliases[v.trim().toLowerCase()]??v.trim().toLowerCase());
    if(cols[0]===''||cols[0]==='matrix'){
      const ids=header.slice(1),layer=options.layer||'flow', edges=[],by=new Map(rows.map(r=>[r[0],r.slice(1)]));
      if(new Set(ids).size!==ids.length||rows.length!==ids.length||ids.some(id=>!by.has(id)))throw Error('Матрица должна быть квадратной с одинаковым набором ID');
      for(const [i,id] of ids.entries()){const cells=by.get(id);if(cells.length!==ids.length)throw Error('Размер строки DSM: '+id);
        for(const [j,to] of ids.entries()){const w=Number(cells[j]||0);if(!Number.isSafeInteger(w)||w<0||i===j&&w!==0)throw Error('Неверная ячейка '+id+' / '+to);
          if(layer==='risk'&&w!==Number(by.get(to)[i]||0))throw Error('Асимметричная матрица проверок');
          if(w&&(layer==='flow'||i<j))edges.push({layer,from:id,to,weight:w,reason:'Исходная матрица '+(options.source||'CSV')+', ячейка '+id+' / '+to});}}
      return {kind:'merge',nodes:ids.map(id=>({id,name:id})),edges,placeholders:true};
    }
    if(new Set(cols).size!==cols.length)throw Error('Повтор заголовка CSV');
    const data=rows.map(r=>object(cols,r));
    if(cols.includes('record')){
      const heads=data.filter(r=>r.record==='project');if(heads.length!==1||data.some(r=>!['project','node','edge'].includes(r.record)))throw Error('Проверьте типы записей CSV');
      const h=heads[0];return {kind:'projection',project:h.project,base:h.base,data:M.validate({title:h.name,nodes:data.filter(r=>r.record==='node').map(getNode),edges:data.filter(r=>r.record==='edge').map(getEdge)})};
    }
    if(cols.includes('from')&&cols.includes('to')){
      const relations=[],edges=[];
      for(const r of data){
        const kind=r.relation||r.layer||options.layer||'flow';
        if(!r.relation&&['flow','risk'].includes(kind)){
          edges.push(getEdge({...r,weight:r.weight??1,layer:kind}));continue;
        }
        if(![...M.relationKinds,'parent','ref','release'].includes(kind))throw Error('Неизвестный тип связи '+kind+' · '+r.from+' → '+r.to);
        relations.push({from:r.from,to:r.to,relation:kind});
      }
      return {kind:'merge',nodes:[],edges,...(relations.length?{relations}:{})};
    }
    if(cols.includes('id')&&cols.includes('name')){
      const attributes=[];
      const nodes=data.map(r=>{
        const clean=pick(getNode(r),cols);
        for(const col of cols.filter(c=>c.startsWith('attr.')&&r[c]!=='')){
          const key=col.slice(5),s=r[col];
          if(!key.trim()||['__proto__','prototype','constructor'].includes(key))throw Error('Недопустимое имя атрибута '+col);
          const v=/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)?Number(s):s==='true'?true:s==='false'?false:s;
          attributes.push({id:r.id,key,value:v});
        }
        return clean;
      });
      return {kind:'merge',nodes,edges:[],...(attributes.length?{attributes}:{})};
    }
    throw Error('Нужны столбцы id,name или from,to,reason, либо квадратная матрица DSM');
  }
  const escMD=v=>String(v??'').replaceAll('&','&amp;').replaceAll('|','&#124;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replace(/^ +| +$/g,x=>'&#32;'.repeat(x.length));
  const unMD=v=>v.trim().replace(/&#(124|13|10|32);/g,(_,n)=>String.fromCharCode(+n)).replaceAll('&amp;','&');
  function mdTable(rows){const line=r=>'| '+r.map(escMD).join(' | ')+' |';return [line(rows[0]),line(rows[0].map(()=>'---')),...rows.slice(1).map(line)].join('\n');}
  function markdown(doc){const t=tables(doc);return '# '+M.head(doc).data.title.replace(/[\r\n]/g,' ')+'\n\nСтрока DSM вызывает столбец. В слое risk каждая пара совместной проверки записана один раз. Оценки и ёмкость релиза задаются в одной единице. Пустая оценка означает, что объём работы пока неизвестен.\n\n'+Object.entries(t).map(([k,rows])=>'## '+k+'\n\n'+mdTable(rows)).join('\n\n')+'\n';}
  function readMd(text){
    const t={};let active=null;
    for(const line of text.split(/\r?\n/)){
      if(line.startsWith('## ')){active=line.slice(3).trim();if(['Project','Nodes','Edges'].includes(active)){if(t[active])throw Error('Повтор раздела '+active);t[active]=[];}else active=null;continue;}
      if(active&&line.trim().startsWith('|')){const cells=line.trim().replace(/^\||\|$/g,'').split('|').map(unMD);
        if(!cells.every(c=>/^:?-{3,}:?$/.test(c)))t[active].push(cells);}
    }
    return readTables(t);
  }
  function readText(text,options={}){
    const nodes=new Map(),edges=[],lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
    for(const [i,raw] of lines.entries()){
      const s=raw.trim();if(!s||s.startsWith('#'))continue;
      const link=s.match(/^(\S+)\s*(->|→|~)\s*([^\s:]+)\s*(?:\[(\d+)\])?\s*:\s*(.+)$/);
      if(link){edges.push(getEdge({from:link[1],to:link[3],layer:link[2]==='~'?'risk':'flow',weight:link[4]||1,reason:link[5]}));continue;}
      const named=s.match(/^([^\s:]+)\s*:\s*(.+)$/);
      if(named && M.idOK(named[1])){if(nodes.has(named[1]))throw Error('Повтор ID в строке '+(i+1));nodes.set(named[1],{id:named[1],name:named[2]});continue;}
      throw Error('Строка '+(i+1)+' требует разбора: '+s+'. Формат: ID : название или A -> B : основание.');
    }
    if(!nodes.size&&!edges.length)throw Error('Пустой текст');return {kind:'merge',nodes:[...nodes.values()],edges};
  }
  function preview(doc,input){
    if(input.kind==='machine-receipt')return (typeof Machine!=='undefined'?Machine:require('./machine.js')).receipt(doc,input);
    if(input.kind==='fleet-result')return (typeof FleetChange!=='undefined'?FleetChange:require('./fleet-change.js')).fromBook(doc,input);
    if(input.kind==='installation-receipt')return (typeof Installations!=='undefined'?Installations:require('./installations.js')).receipt(doc,input);
    if(input.kind==='spec-package')return (typeof Specifications!=='undefined'?Specifications:require('./specifications.js')).importPackage(doc,input.files).data;
    if(input.kind==='archive')return M.head(M.document(input.doc)).data;
    if(input.kind==='projection'){
      if(input.project!==doc.project||input.base!==M.head(doc).rev)throw Error('Другая база проекции. Откройте соответствующий JSON или экспортируйте актуальную версию.');
      return input.data;
    }
    const now=M.head(doc).data;
    if(input.kind==='patch'){if(input.project!==doc.project||input.base!==M.head(doc).rev)throw Error('Конфликт базы патча');return M.patch(now,input.ops);}
    if(input.kind==='replacement')return M.validate(input.data);
    if(new Set(input.nodes.map(n=>n.id)).size!==input.nodes.length)throw Error('Повтор ID во входных строках');
    if(new Set(input.edges.map(M.ek)).size!==input.edges.length)throw Error('Повтор связи во входных строках');
    const known=new Set(now.nodes.map(n=>n.id));
    const updates=new Map(input.nodes.filter(n=>!(input.placeholders===true||input.placeholderIds?.includes(n.id))||!known.has(n.id)).map(n=>[n.id,{...n}]));
    const originals=new Map(now.nodes.map(n=>[n.id,n]));
    function entry(id){
      if(!updates.has(id)){if(!known.has(id))throw Error('Неизвестный объект '+id);updates.set(id,{id});}
      return updates.get(id);
    }
    for(const {id,key,value} of input.attributes||[]){
      const n=entry(id);n.attrs={...(n.attrs||originals.get(id)?.attrs),[key]:value};
    }
    for(const {from,to,relation} of input.relations||[]){
      if(relation==='parent'){entry(to).parent=from;continue;}
      if(relation==='release'){entry(from).release=to;continue;}
      if(relation==='ref'){
        const n=entry(from),refs=n.refs||originals.get(from)?.refs||[];
        if(!refs.includes(to))n.refs=[...refs,to];
        continue;
      }
      const n=entry(from),links=n.relations||originals.get(from)?.relations||[];
      if(!links.some(([k,id])=>k===relation&&id===to))n.relations=[...links,[relation,to]];
    }
    const ops=[...[...updates.values()].map(value=>({op:'node',value})),...input.edges.map(value=>({op:'edge',value}))];
    return ops.length?M.patch(now,ops):now;
  }
  function parseJson(s,title){if(s.schema==='dsm-project/1')return {kind:'archive',doc:M.document(s)};
    if(s.ops)return {kind:'patch',project:s.project,base:s.base,ops:s.ops};
    if(s.flow&&s.risk)return {kind:'replacement',data:M.legacy(s,title)};
    return {kind:'replacement',data:M.validate(s)};}
  return {tables,readTables,emitCsv,readCsv,csv,splitCsv,markdown,readMd,readText,preview,parseJson,meta};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Analysis!=='undefined'?Analysis:require('./analysis.js'));
if(typeof module!=='undefined')module.exports=Formats;
