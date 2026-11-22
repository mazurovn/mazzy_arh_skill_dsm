const fs=require('node:fs');
const path=require('node:path');
const Model=require('./model.js'),AnalysisRun=require('./analysis.js'),Fmt=require('./formats.js'),Xlsx=require('./excel.js'),Book=require('./notebook.js');
const textFile=p=>fs.readFileSync(p,'utf8');
const json=x=>JSON.stringify(x,null,2)+'\n';
function readProject(file){return Model.document(JSON.parse(textFile(file)));}
function exclusive(file,writer){
  const lock=file+'.lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Файл занят другой записью: '+lock);throw e;}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:require('node:os').hostname(),at:new Date().toISOString()}));return writer();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function update(file,project,base,note,actor,fn){
  file=fs.realpathSync(file);
  return exclusive(file,()=>{
    const prev=readProject(file);
    if(prev.project!==project||Model.head(prev).rev!==base)throw Error('Конфликт базы: сначала прочитайте актуальный проект');
    const doc=Model.commit(prev,fn(prev),base,note,actor);
    const tmp=file+'.'+Model.uid()+'.tmp';let fd;
    try{fd=fs.openSync(tmp,'wx',fs.statSync(file).mode);fs.writeFileSync(fd,json(doc));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
    finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    return doc;
  });
}
function html(doc){
  const src=f=>textFile(path.join(__dirname,f));
  const files=['vendor/jszip.js','vendor/sax.js','model.js','analysis.js','formats.js','excel.js','notebook-files.js','notebook-profiles.js','installation-notebook.js','machine-notebook.js','fleet-analysis.py','fleet-notebook.js','notebook.js','sysl.js','specifications.js','enterprise.js','reports.js','registers.js','changes.js','views.js','scope.js','delivery.js','installations.js','fleet.js','fleet-change.js','fleet-source.js','fleet-panel.js','machine.js','vibration.js','machine-panel.js','installation-panel.js','delivery-panel.js','review-panel.js','notebook-panel.js','ui.js'];
  const notices=['LICENSE.txt','vendor/JSZip-LICENSE.txt','vendor/SAX-LICENSE.txt','vendor/PAKO-LICENSE.txt','vendor/BUNDLED-NOTICES.txt'].map(src).join('\n\n');
  return src('shell.html').replace('</head>',()=>'<script type="text/plain" id="licenses">'+notices.replace(/<\/script/gi,'&lt;/script')+'</script></head>').replace('/*__CSS__*/',()=>src('style.css')).replace('__PROJECT__',()=>JSON.stringify(doc).replaceAll('<','\\u003c')).replace('<!--__SCRIPTS__-->',()=>files.map(f=>'<script>\n'+(f==='fleet-analysis.py'?'const FleetPythonSource='+JSON.stringify(src(f))+';':src(f)).replace(/<\/script/gi,'<\\/script')+'\n</script>').join('\n'));
}
async function readInput(file,layer='flow'){
  const k=path.extname(file).toLowerCase(),src=path.basename(file);
  if(layer==='result'&&k!=='.ipynb')throw Error('Результат Python можно вернуть из .ipynb');
  if(k==='.zip')return {kind:'spec-package',files:await require('./specifications.js').openPackage(fs.readFileSync(file))};
  if(k==='.xlsx')return Xlsx.read(fs.readFileSync(file),{layer,source:src});
  const s=textFile(file).replace(/^\uFEFF/,'');
  if(k==='.json')return Fmt.parseJson(JSON.parse(s),src);
  if(k==='.md')return Fmt.readMd(s);
  if(k==='.csv'||k==='.tsv')return Fmt.readCsv(s,{layer,source:src});
  if(k==='.txt')return Fmt.readText(s);
  if(k==='.ipynb')return layer==='result'?await require('./fleet-source.js').verifyResult(Book.result(JSON.parse(s))):Book.read(JSON.parse(s));
  if(k==='.html'){const match=s.match(/<script type="application\/json" id="project-data">([\s\S]*?)<\/script>/);if(match)return Fmt.parseJson(JSON.parse(match[1]));}
  throw Error('Неизвестный формат '+k);
}
async function exportBytes(doc,k){
  switch(k){case 'sysl':return require('./sysl.js').write(Model.head(doc).data);case 'html':return html(doc);case 'md':return Fmt.markdown(doc);case 'csv':return Fmt.emitCsv(doc);case 'xlsx':return Xlsx.write(doc);case 'ipynb':return json(Book.write(doc));case 'json':return json(doc);default:throw Error('Неизвестный формат экспорта');}
}
function current(doc){const h=Model.head(doc);return {project:doc.project,base:h.rev,version:doc.history.length,actor:h.actor,note:h.note,data:h.data};}
function analyze(doc){const d=Model.head(doc).data;return {flow:AnalysisRun.calculate(d,'flow'),risk:AnalysisRun.calculate(d,'risk'),releases:Model.plan(d),requirements:require('./specifications.js').coverage(d).map(r=>({id:r.requirement.id,implementations:r.implementations.map(n=>n.id),deviations:r.deviations.map(n=>n.id)}))};}
function preview(doc,input){const after=Fmt.preview(doc,input);return {project:doc.project,base:Model.head(doc).rev,changes:Model.diff(Model.head(doc).data,after),releases:Model.plan(after)};}
module.exports={Model,Fmt,readProject,readInput,update,exportBytes,html,json,current,analyze,preview};
