'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const machine=require('./machine.js'),controller=require('./axis-controller.js');
try{
  const packet=JSON.parse(fs.readFileSync(0,'utf8'));
  const sha256=crypto.createHash('sha256').update(packet.program,'utf8').digest('hex');
  const run=controller.execute(packet,machine.simulate);
  process.stdout.write(JSON.stringify({...run,sha256,engine:'node-sil'}));
}catch(e){process.stderr.write(e.message);process.exitCode=1;}
