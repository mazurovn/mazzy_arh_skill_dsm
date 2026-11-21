#!/usr/bin/env node
// Copyright © 2026 mazzy (mazurovn). See LICENSE.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');

function signature(dir) {
  const hash = createHash('sha256');
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
      const item = path.join(relative, name);
      const file = path.join(dir, item);
      if (fs.lstatSync(file).isDirectory()) visit(item);
      else hash.update(JSON.stringify([item, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
    }
  }
  visit('');
  return hash.digest('hex');
}

function copySkill(target, upgrade, workspace) {
  const source = path.join(__dirname, 'skills', 'edit-dsm-project');
  const expected = signature(source);
  const exists=fs.existsSync(target);
  if(exists&&signature(target)===expected)return;
  if(exists&&!upgrade)throw Error('Локальная версия навыка отличается. Для обновления с резервной копией используйте --upgrade.');
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const stage=fs.mkdtempSync(path.join(path.dirname(target),'.dsm-install-'));
  let backup;
  try {
    fs.cpSync(source,stage,{recursive:true});
    if(signature(stage)!==expected)throw Error('Не удалось проверить скопированный навык');
    if(exists){
      const backups=path.join(workspace,'.dsm-backups');
      fs.mkdirSync(backups,{recursive:true});
      backup=path.join(fs.mkdtempSync(path.join(backups,'skill-')),'edit-dsm-project');
      fs.renameSync(target,backup);
    }
    try{fs.renameSync(stage,target);}catch(error){if(backup)fs.renameSync(backup,target);throw error;}
    if(backup)console.log('Предыдущая версия навыка сохранена в '+backup);
  }finally{fs.rmSync(stage,{recursive:true,force:true});}

}

function seed(source, dest) {
  try { fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

function configure(workspace, cli, project) {
  const dir = path.join(workspace,'.codex');
  fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir,'config.toml');
  const config = ['[mcp_servers.mazzy-dsm]', 'command = '+JSON.stringify(process.execPath),
    'args = '+JSON.stringify([cli,'mcp',project]), ''].join('\n');
  try { fs.writeFileSync(file,config,{flag:'wx'}); }
  catch(error) {
    if(error.code !== 'EEXIST') throw error;
    if(fs.readFileSync(file,'utf8') !== config) throw Error('В папке уже есть другая конфигурация Codex. Выберите отдельную папку с --workspace.');
  }
}

function request(cli,project,name,args) {
  const messages = [
    {id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'setup',version:'1'}}},
    {method:'notifications/initialized'},
    {id:2,method:'tools/call',params:{name,arguments:args}}
  ].map(m=>JSON.stringify({jsonrpc:'2.0',...m})).join('\n')+'\n';
  const run = spawnSync(process.execPath,[cli,'mcp',project],{input:messages,encoding:'utf8',timeout:10000,maxBuffer:32*1024*1024});
  if(run.error||run.status!==0) throw Error(run.error?.message||run.stderr);
  const response = run.stdout.trim().split('\n').map(line=>JSON.parse(line)).find(r=>r.id===2);
  if(!response?.result || response.result.isError) throw Error('Ошибка вызова '+name+': '+JSON.stringify(response));
  return JSON.parse(response.result.content[0].text);
}

async function serve(cli,project) {
  const child = spawn(process.execPath,[cli,'serve',project,'0'],{stdio:['ignore','pipe','inherit']});
  try {
    const result=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Локальный сервер не запустился');})]);
    const url = result[0].toString().trim();
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw Error('Неожиданный адрес сервера');
    return {child,url};
  } catch(error) {child.kill();throw error;}
}

async function smoke(cli,sample) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'mazzy-dsm-check-'));
  let server;
  try {
    const testFile=path.join(tmp,'demo.json');
    fs.copyFileSync(sample,testFile);
    server=await serve(cli,testFile);
    const html=await fetch(server.url,{signal:AbortSignal.timeout(10000)}).then(r=>r.text());
    assert.ok(html.includes('Мастерская DSM'));
    const current=request(cli,testFile,'dsm_read',{});
    const args={project:current.project,base:current.base,ops:[{op:'node',value:{id:'F03',release:'R2'}}]};
    const preview=request(cli,testFile,'dsm_preview',args);
    assert.deepEqual(preview.releases.map(r=>r.knownEffort),[8,10]);
    const saved=request(cli,testFile,'dsm_apply',{...args,actor:'local-check',note:'Проверка на отдельной копии'});
    const observed=await fetch(server.url+'/api/head',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
    assert.equal(observed.rev,saved.base);
    assert.equal(request(cli,testFile,'dsm_read',{}).version,2);
    return 'PASS (MCP read/preview/apply → HTTP, версия 2, R1 8/12, R2 10/10)';
  } finally {
    if(server && server.child.exitCode===null && server.child.signalCode===null){
      const stopped=once(server.child,'exit');server.child.kill();await stopped;
    }
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}

function installJupyter(workspace){
  const dir=path.join(workspace,'.dsm-python');
  const windows=process.platform==='win32';
  const python=path.join(dir,windows?'Scripts/python.exe':'bin/python');
  const packages=['notebook>=7.5,<7.6','jupyterlab>=4.5,<4.6','ipykernel>=6,<8'];
  const useUv=spawnSync('uv',['--version'],{stdio:'ignore'}).status===0;
  function run(cmd,args){
    const result=spawnSync(cmd,args,{stdio:'inherit'});
    if(result.error||result.status!==0)throw Error('Не удалось настроить Jupyter: '+(result.error?.message||cmd));
  }
  if(!fs.existsSync(python)){
    if(useUv)run('uv',['venv',dir]);
    else run(windows?'python':'python3',['-m','venv',dir]);
  }
  if(useUv)run('uv',['pip','install','--python',python,...packages]);
  else run(python,['-m','pip','install',...packages]);
}

async function main(args) {
  let workspace=path.join(os.homedir(),'mazzy-dsm-workspace'),launch=false,upgrade=false,jupyter=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--workspace' && args[i+1]) workspace=path.resolve(args[++i]);
    else if(args[i]==='--serve') launch=true;
    else if(args[i]==='--upgrade')upgrade=true;
    else if(args[i]==='--jupyter')jupyter=true;
    else if(args[i]==='--help') { console.log('node install-local.cjs [--workspace DIRECTORY] [--serve] [--upgrade] [--jupyter]');return; }
    else throw Error('Неизвестный аргумент '+args[i]);
  }
  if(Number(process.versions.node.split('.')[0])<22) throw Error('Требуется Node.js 22 или новее');
  const target=path.join(workspace,'.agents','skills','edit-dsm-project');
  const cli=path.join(target,'scripts','dsm.cjs');
  const sample=path.join(__dirname,'example','terminal-kit.dsm.json'),project=path.join(workspace,'project.json');
  fs.mkdirSync(workspace,{recursive:true});
  const lock=path.join(workspace,'.dsm-install.lock');
  const fd=fs.openSync(lock,'wx');
  try{
    copySkill(target,upgrade,workspace);
    seed(sample,project);
    configure(workspace,cli,project);
    if(jupyter)installJupyter(workspace);
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  const current=request(cli,project,'dsm_read',{});
  const check=await smoke(cli,sample);
  console.log(JSON.stringify({host:os.hostname(),platform:process.platform,workspace,project,revision:current.base,check},null,2));
  if(launch){
    const server=await serve(cli,project);
    console.log('Мастерская DSM: '+server.url+'\nОткройте рабочую папку в локальном Codex. Ctrl+C останавливает сервер.');
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.child.kill());
    await once(server.child,'exit');
  }
}
main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
