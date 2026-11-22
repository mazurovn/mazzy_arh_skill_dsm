'use strict';
const {execFile}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const axis=require('./axis-bench.js');
async function execute(doc,body){
  if(body.project!==doc.project||body.base!==doc.history.at(-1).rev)throw Error('Конфликт версии задания');
  const c=axis.config(doc.history.at(-1).data,body.root),expected=crypto.createHash('sha256').update(c.program).digest('hex');
  if(body.sha256!==expected)throw Error('Контрольная сумма задания отличается от сохранённой версии');
  const packet={program:c.program,limits:c.limits,settings:c.settings,fault:body.fault};
  const run=await new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,[path.join(__dirname,'axis-process.cjs')],{timeout:10000,maxBuffer:4*1024*1024},(err,out,stderr)=>{
      if(err)return reject(Error(stderr.trim()||'Контроллер не ответил'));
      try{resolve(JSON.parse(out));}catch{reject(Error('Контроллер вернул нечитаемый ответ'));}
    });
    child.stdin.on('error',reject);child.stdin.end(JSON.stringify(packet));
  });
  if(run.sha256!==expected||run.protocol!=='axis-sil/1')throw Error('Контроллер не подтвердил отправленный файл');
  return run;
}
module.exports={execute};
