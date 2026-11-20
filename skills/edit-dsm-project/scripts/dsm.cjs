#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),R=require('./src/runtime.js'),B=require('./src/bridge.js'),M=R.Model;
const usage=[
'node dsm.cjs init PROJECT.json "Название проекта"',
'node dsm.cjs show|analyze|history PROJECT.json',
'node dsm.cjs preview|apply PROJECT.json PATCH.json',
'node dsm.cjs import-preview PROJECT.json SOURCE [flow|risk]',
'node dsm.cjs import PROJECT.json SOURCE BASE ACTOR NOTE [flow|risk]',
'node dsm.cjs diff PROJECT.json FROM TO',
'node dsm.cjs restore PROJECT.json BASE REV ACTOR NOTE',
'node dsm.cjs export PROJECT.json NEW_FILE.{md,csv,xlsx,ipynb,html,json}',
'node dsm.cjs serve PROJECT.json [port=8787]',
'node dsm.cjs mcp PROJECT.json'
].join('\n');
async function run([cmd,file,...args]){
  if(cmd==='--help'||cmd==='help'||!cmd){console.log(usage);return;}
  if(!file)throw Error(usage);
  if(cmd==='init'){const d=M.create({title:args[0]||'Новый проект',nodes:[],edges:[]});fs.writeFileSync(file,R.json(d),{flag:'wx'});return R.current(d);}
  const doc=R.readProject(file),h=M.head(doc);
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
