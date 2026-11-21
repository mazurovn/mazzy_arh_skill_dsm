const ExcelIO=((F,A,M,Zip,Sax)=>{
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg='http://schemas.openxmlformats.org/package/2006/relationships';
  const xml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll('\r','&#13;');
  function col(i){let s='';while(i>=0){s=String.fromCharCode(65+i%26)+s;i=Math.floor(i/26)-1;}return s;}
  function sheet(rows){return '<worksheet xmlns="'+NS+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>'+rows.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((x,j)=>{
    const ref=col(j)+(i+1);
    return typeof x==='number'?'<c r="'+ref+'"><v>'+x+'</v></c>':'<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(x)+'</t></is></c>';
  }).join('')+'</row>').join('')+'</sheetData></worksheet>';}
  async function write(doc){
    const t=F.tables(doc),d=M.head(doc).data,ids=d.nodes.map(n=>n.id);
    for(const k of ['flow','risk'])t[k==='flow'?'DSM_Flow':'DSM_Risk']=[['ID',...ids],...A.matrix(d,k).map((r,i)=>[ids[i],...r])];
    const names=Object.keys(t),z=new Zip();
    z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+names.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>');
    z.file('_rels/.rels','<Relationships xmlns="'+pkg+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml','<workbook xmlns="'+NS+'" xmlns:r="'+rel+'"><sheets>'+names.map((n,i)=>'<sheet name="'+n+'" sheetId="'+(i+1)+'" r:id="r'+i+'"/>').join('')+'</sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="'+pkg+'">'+names.map((n,i)=>'<Relationship Id="r'+i+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>');
    names.forEach((n,i)=>z.file('xl/worksheets/sheet'+(i+1)+'.xml',sheet(t[n])));
    return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  function walk(s,callbacks){
    const p=Sax.parser(true);p.ondoctype=()=>{throw Error('DTD в XLSX не поддерживается');};
    p.onopentag=t=>callbacks.start?.(t.name.split(':').pop(),t.attributes);
    p.ontext=p.oncdata=t=>callbacks.text?.(t);p.onclosetag=t=>callbacks.end?.(t.split(':').pop());p.write(s).close();
  }
  async function read(bytes,options={}){
    const z=await Zip.loadAsync(bytes);let expanded=0;
    for(const entry of Object.values(z.files))expanded+=entry._data?.uncompressedSize||0;
    if(expanded>64*1024*1024)throw Error('Книга превышает 64 МиБ в распакованном виде');
    const get=async(path)=>{const f=z.file(path);if(!f)throw Error('XLSX: отсутствует '+path);return f.async('string');};
    const paths=new Map(),sheets=[],strings=[];
    walk(await get('xl/_rels/workbook.xml.rels'),{start(tag,a){if(tag==='Relationship')paths.set(a.Id,a.Target.startsWith('/')?a.Target.slice(1):'xl/'+a.Target.replace(/^\.\//,''));}});
    walk(await get('xl/workbook.xml'),{start(tag,a){if(tag==='sheet')sheets.push([a.name,paths.get(a['r:id'])]);}});
    if(z.file('xl/sharedStrings.xml')){
      let value='',inText=false;walk(await get('xl/sharedStrings.xml'),{start(t){if(t==='si')value='';if(t==='t')inText=true;},text(s){if(inText)value+=s;},end(t){if(t==='t')inText=false;if(t==='si')strings.push(value);}});
    }
    const full=['Project','Nodes','Edges'].every(k=>sheets.some(([name])=>name===k));
    const tables={};
    for(const [name,path] of sheets){
      if(full&&!['Project','Nodes','Edges'].includes(name))continue;
      let rows=[],r=[],cell=null,tag='',val='',inline='';
      walk(await get(path),{start(t,a){if(t==='row')r=[];if(t==='c'){cell=a;val='';inline='';}
        if(cell&&t==='f')throw Error('Формула в редактируемой таблице '+name+' / '+cell.r+'. Сохраните вычисленное значение.');
        tag=t;},text(s){if(cell&&tag==='v')val+=s;if(cell&&tag==='t')inline+=s;},
        end(t){if(t==='c'){const letters=(cell.r||'').match(/^[A-Z]+/i)?.[0];
          const ix=letters?[...letters.toUpperCase()].reduce((s,c)=>26*s+c.charCodeAt(0)-64,0)-1:r.length;
          if(ix>16383)throw Error('Неверная координата XLSX');
          r[ix]=cell.t==='s'?strings[Number(val)]:cell.t==='inlineStr'?inline:cell.t==='b'?(val==='1'?'true':'false'):val;cell=null;}
          if(t==='row'&&r.some(x=>x!==''&&x!==undefined))rows.push(Array.from(r,v=>v??''));tag='';}});
      tables[name]=rows;
    }
    if(options.rawRows)return Object.values(tables);
    if(full)return F.readTables(tables);
    const nodes=[],edges=[],attributes=[],relations=[],placeholders=new Map();for(const [name,rows] of Object.entries(tables)){
      if(!rows.length)continue;
      const layer=({DSM_Risk:'risk',DSM_Flow:'flow'})[name]||options.layer;
      if(['DSM_Risk','DSM_Flow'].includes(name)&&rows[0][0]==='ID')rows[0][0]='matrix';
      const imported=F.readCsv(F.csv(rows),{...options,layer,source:name});
      if(imported.kind!=='merge')throw Error('Для полного проекта нужны Project, Nodes и Edges');
      if(imported.placeholders)for(const n of imported.nodes)placeholders.set(n.id,n);
      else nodes.push(...imported.nodes);
      edges.push(...imported.edges);
      attributes.push(...(imported.attributes||[]));relations.push(...(imported.relations||[]));
    }
    for(const n of nodes)placeholders.delete(n.id);
    nodes.push(...placeholders.values());
    if(!nodes.length&&!edges.length&&!relations.length)throw Error('Книга пуста');
    return {kind:'merge',nodes,edges,...(placeholders.size?{placeholderIds:[...placeholders.keys()]}:{}),...(attributes.length?{attributes}:{}),...(relations.length?{relations}:{})};
  }
  return {write,read};
})(typeof Formats!=='undefined'?Formats:require('./formats.js'),typeof Analysis!=='undefined'?Analysis:require('./analysis.js'),typeof DSM!=='undefined'?DSM:require('./model.js'),typeof JSZip!=='undefined'?JSZip:require('./vendor/jszip.js'),typeof sax!=='undefined'?sax:require('./vendor/sax.js'));
if(typeof module!=='undefined')module.exports=ExcelIO;
