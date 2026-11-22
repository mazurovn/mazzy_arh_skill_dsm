#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),R=require('./src/runtime.js'),B=require('./src/bridge.js'),M=R.Model;
const usage=[
'node dsm.cjs init PROJECT.json "Название проекта"',
'node dsm.cjs show|analyze|history PROJECT.json',
'node dsm.cjs preview|apply PROJECT.json PATCH.json',
'node dsm.cjs import-preview PROJECT.json SOURCE [flow|risk|result]',
'node dsm.cjs import PROJECT.json SOURCE BASE ACTOR NOTE [flow|risk|result]',
'node dsm.cjs diff PROJECT.json FROM TO',
'node dsm.cjs restore PROJECT.json BASE REV ACTOR NOTE',
'node dsm.cjs export PROJECT.json NEW_FILE.{md,csv,xlsx,ipynb,html,json,sysl}',
'node dsm.cjs notebook PROJECT.json NEW.ipynb [full|requirements|placement|readiness|installation|fleet|machine] [INSTALLATION_ID]',
'node dsm.cjs notebook-info FILE.ipynb',
'node dsm.cjs report PROJECT.json [REPORT_KEY]',
'node dsm.cjs installation PROJECT.json INSTALLATION_ID',
'node dsm.cjs fleet PROJECT.json PROCUREMENT_ID',
'node dsm.cjs machine PROJECT.json PRODUCT_ID',
'node dsm.cjs source-preview PROJECT.json CATEGORY FILE PROCUREMENT_ID',
'node dsm.cjs source-import PROJECT.json CATEGORY FILE PROCUREMENT_ID BASE ACTOR NOTE',
'node dsm.cjs journey PROJECT.json REQUIREMENT_ID [--markdown]',
'node dsm.cjs spec-check PROJECT.json PROPOSAL_ID',
'node dsm.cjs spec-export PROJECT.json PROPOSAL_ID NEW.zip',
'node dsm.cjs change-log PROJECT.json FROM_REV TO_REV',
'node dsm.cjs serve PROJECT.json [port=8787]',
'node dsm.cjs mcp PROJECT.json',
'node dsm.cjs connect PROJECT.json [json|toml]',
'node dsm.cjs agent PROJECT.json PROMPT [--source NOTES.txt] [--patch-out PATCH.json] [--apply]'
].join('\n');
async function run([cmd,file,...args]){
  if(cmd==='--help'||cmd==='help'||!cmd){console.log(usage);return;}
  if(!file)throw Error(usage);
  if(cmd==='init'){const d=M.create({title:args[0]||'Новый проект',nodes:[],edges:[]});fs.writeFileSync(file,R.json(d),{flag:'wx'});return R.current(d);}
  if(cmd==='notebook-info'){
    const files=require('./src/notebook-files.js'),book=files.validate(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
    return {format:book.nbformat,kernel:book.metadata.kernelspec,base:book.metadata.dsm?.base,cells:files.overview(book).map(c=>({index:c.i+1,type:c.type,title:c.title,outputs:c.outputs.length}))};
  }
  const doc=R.readProject(file),h=M.head(doc);
  if(cmd==='source-preview'||cmd==='source-import'){
    const [category,source,root,base,actor,note]=args;
    const next=await require('./src/fleet-source.js').ingest(doc,category,path.basename(source),fs.readFileSync(source),root);
    if(cmd==='source-preview')return {project:doc.project,base:h.rev,changes:M.diff(h.data,next)};
    if(base!==h.rev)throw Error('Другая база документа');
    return R.current(R.update(file,doc.project,base,note,actor,()=>next));
  }
  if(cmd==='machine')return require('./src/machine.js').calculate(h.data,args[0]);
  if(cmd==='fleet')return require('./src/fleet.js').analyze(h.data,args[0]);
  if(cmd==='installation')return require('./src/installations.js').calculate(h.data,args[0]);
  if(cmd==='journey'){const delivery=require('./src/delivery.js'),chain=delivery.chain(h.data,args[0]);if(args[1]==='--markdown'){process.stdout.write(delivery.trace(chain));return;}return chain;}
  if(cmd==='report'){const reports=require('./src/reports.js');return args[0]?reports.run(h.data,args[0]):reports.definitions;}
  if(cmd==='notebook'){
    if(!args[0])throw Error('Укажите выходной .ipynb');
    fs.writeFileSync(args[0],R.json(require('./src/notebook.js').write(doc,args[1],args[2])),{flag:'wx'});return {file:args[0],base:h.rev};
  }
  if(cmd==='spec-check')return require('./src/specifications.js').readiness(h.data,args[0]);
  if(cmd==='spec-export'){
    if(!args[1])throw Error('Укажите ID предложения и выходной ZIP');
    fs.writeFileSync(args[1],await require('./src/specifications.js').bundle(doc,args[0]),{flag:'wx'});return {file:args[1],base:h.rev};
  }
  if(cmd==='change-log'){process.stdout.write(require('./src/changes.js').changeLog(doc,args[0],args[1]));return;}

  if(cmd==='connect'){
    const config={command:process.execPath,args:[__filename,'mcp',fs.realpathSync(file)]};
    if(!args[0]||args[0]==='json')return {mcpServers:{'mazzy-dsm':config}};
    if(args[0]==='toml'){console.log('[mcp_servers.mazzy-dsm]\ncommand = '+JSON.stringify(config.command)+'\nargs = '+JSON.stringify(config.args));return;}
    throw Error('Формат подключения: json или toml');
  }
  if(cmd==='agent')return require('./src/agent.js').command(file,args);
  if(cmd==='show')return R.current(doc);
  if(cmd==='history')return B.invoke(file,'dsm_history');
  if(cmd==='analyze')return R.analyze(doc);
  if(cmd==='diff')return B.invoke(file,'dsm_diff',{from:args[0],to:args[1]});
  if(cmd==='restore')return B.invoke(file,'dsm_restore',{project:doc.project,base:args[0],revision:args[1],actor:args[2],note:args[3]});
  if(cmd==='preview'||cmd==='apply'){const input=JSON.parse(fs.readFileSync(args[0],'utf8'));
    return B.invoke(file,cmd==='apply'?'dsm_apply':'dsm_preview',input);}
  if(cmd==='import-preview'||cmd==='import'){const apply=cmd==='import',input=await R.readInput(args[0],(apply?args[4]:args[1])||'flow');
    if(input.kind==='archive')throw Error('JSON с историей уже является проектом. Используйте его как PROJECT.json. Для переноса модели выгрузите текущее состояние.');
    if(!apply)return R.preview(doc,input);
    return R.current(R.update(file,doc.project,args[1],args[3],args[2],p=>R.Fmt.preview(p,input)));}
  if(cmd==='export'){if(!args[0])throw Error('Требуется новый файл результата');const dest=args[0],ext=path.extname(dest).slice(1).toLowerCase();
    fs.writeFileSync(dest,await R.exportBytes(doc,ext),{flag:'wx'});return {file:dest,project:doc.project,base:h.rev};}
  if(cmd==='serve'){const port=Number(args[0]??8787);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Неверный порт');B.serve(path.resolve(file),port);return;}
  if(cmd==='mcp'){B.mcp(path.resolve(file));return;}
  throw Error(usage);
}
run(process.argv.slice(2)).then(v=>{if(v!==undefined)process.stdout.write(R.json(v));}).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
