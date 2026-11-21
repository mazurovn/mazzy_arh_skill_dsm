'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {randomUUID, randomBytes} = require('node:crypto');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const Notebook = require('./notebook.js');

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
  async function start(doc, origin) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    const envPython = path.join(workspace, '.dsm-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.DSM_JUPYTER_PYTHON || (fs.existsSync(envPython) ? envPython : 'python3');
    const folder = path.join(workspace, '.dsm-notebooks', id);
    fs.mkdirSync(folder, {recursive:true, mode:0o700});
    const filename = path.join(folder, 'architecture.ipynb');
    fs.writeFileSync(filename, JSON.stringify(Notebook.write(doc), null, 2), {mode:0o600});
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
          if (r.ok) return {id, file:filename, url:address+'/notebooks/architecture.ipynb?token='+token};
        } catch { /* The server is still starting. */ }
        await delay(200);
      }
      throw Error('Jupyter не запустился. Установите notebook и ipykernel в .dsm-python рядом с проектом или задайте DSM_JUPYTER_PYTHON.');
    } catch (error) { stop(id); throw error; }
  }
  function read(id) {
    const session = live.get(id);
    if (!session) throw Error('Сессия Jupyter закрыта. Сохранённый .ipynb можно загрузить через Обмен.');
    return Notebook.read(JSON.parse(fs.readFileSync(session.filename,'utf8')));
  }
  return {start, read, stop, close:()=>{for (const id of live.keys()) stop(id);}};
}
module.exports = sessions;
