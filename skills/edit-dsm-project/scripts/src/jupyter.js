'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {randomUUID, randomBytes} = require('node:crypto');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const Notebook = require('./notebook.js');
const Files = require('./notebook-files.js');
const limit = 16 * 1024 * 1024;

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function sessions(projectFile) {
  const workspace = path.dirname(projectFile);
  const live = new Map();
  function stop(id) {
    const session = live.get(id);
    if (session) session.child.kill();
    live.delete(id);
  }
  const library=path.join(workspace,'.dsm-notebooks');
  function fileFor(id,name){
    if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Неверный ID блокнота');
    const folder=path.join(library,id),file=path.join(folder,name);
    if(fs.realpathSync(folder)!==path.join(fs.realpathSync(library),id)||!fs.lstatSync(file).isFile())throw Error('Файл блокнота недоступен');
    return file;
  }
  function load(id){
    const file=fileFor(id,'architecture.ipynb');
    if(fs.statSync(file).size>limit)throw Error('Блокнот превышает 16 МиБ');
    return Files.validate(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  function info(id){
    const file=fileFor(id,'architecture.ipynb'),stat=fs.statSync(file);
    const meta=fs.existsSync(path.join(path.dirname(file),'session.json'))
      ?JSON.parse(fs.readFileSync(fileFor(id,'session.json'),'utf8'))
      :{project:load(id).metadata.dsm?.project,name:'architecture.ipynb'};
    return {id,project:meta.project,name:meta.name,updated:stat.mtime.toISOString(),bytes:stat.size,active:live.has(id)};
  }
  function list(project){
    if(!fs.existsSync(library))return [];
    const all=[];
    for(const item of fs.readdirSync(library,{withFileTypes:true})){
      if(!item.isDirectory())continue;
      try{const entry=info(item.name);if(entry.project===project)all.push(entry);}catch{/* Incomplete or unrelated directory. */}
    }
    return all.sort((a,b)=>b.updated.localeCompare(a.updated));
  }
  function saved(project,id){
    if(info(id).project!==project)throw Error('Блокнот другого проекта');
    return load(id);
  }
  async function start(doc, origin, options={}) {
    if([options.book,options.saved,options.profile].filter(v=>v!==undefined).length>1)throw Error('Выберите один источник блокнота');
    const book=options.book!==undefined?Files.validate(options.book):options.saved?saved(doc.project,options.saved):Notebook.write(doc,options.profile);
    const bytes=JSON.stringify(book);
    if(Buffer.byteLength(bytes)>limit)throw Error('Блокнот превышает 16 МиБ');
    const name=String(options.saved?info(options.saved).name:options.name||'architecture.ipynb').slice(0,180);
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    const envPython = path.join(workspace, '.dsm-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.DSM_JUPYTER_PYTHON || (fs.existsSync(envPython) ? envPython : 'python3');
    const folder = path.join(workspace, '.dsm-notebooks', id);
    fs.mkdirSync(folder, {recursive:true, mode:0o700});
    const filename = path.join(folder, 'architecture.ipynb');
    fs.writeFileSync(filename, bytes, {mode:0o600});
    fs.writeFileSync(path.join(folder,'session.json'),JSON.stringify({project:doc.project,name}),{mode:0o600});
    const port = await freePort(), address = 'http://127.0.0.1:'+port;
    const settings = {headers:{'Content-Security-Policy':"frame-ancestors "+origin}};
    const child = spawn(python, ['-m','notebook','--no-browser','--ServerApp.ip=127.0.0.1',
      '--ServerApp.port='+port,'--ServerApp.port_retries=0','--ServerApp.root_dir='+folder,
      '--ServerApp.terminals_enabled=False','--ServerApp.tornado_settings='+JSON.stringify(settings)],
    {cwd:folder, env:{...process.env, JUPYTER_TOKEN:token}, stdio:'ignore'});
    let failure;
    child.once('error', err => { failure=err; live.delete(id); });
    child.once('exit', () => live.delete(id));
    live.set(id, {child, filename});
    try {
      for (let i=0; i<200; i++) {
        if (failure || child.exitCode !== null || child.signalCode !== null) break;
        try {
          const r = await fetch(address+'/api/status', {headers:{Authorization:'token '+token},signal:AbortSignal.timeout(500)});
          if (r.ok) return {id, name, base:book.metadata.dsm?.base, file:filename, url:address+'/notebooks/architecture.ipynb?token='+token};
        } catch { /* The server is still starting. */ }
        await delay(200);
      }
      throw Error('Jupyter не запустился. Установите notebook и ipykernel в .dsm-python рядом с проектом или задайте DSM_JUPYTER_PYTHON.');
    } catch (error) { stop(id); throw error; }
  }
  function read(id) {
    const session = live.get(id);
    if (!session) throw Error('Сессия Jupyter закрыта. Сохранённый .ipynb можно загрузить через Обмен.');
    return Notebook.read(load(id));
  }
  return {start, list, saved, read, stop, close:()=>{for (const id of live.keys()) stop(id);}};
}
module.exports = sessions;
