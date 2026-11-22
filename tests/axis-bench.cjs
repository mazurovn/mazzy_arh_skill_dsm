const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const lib='../skills/edit-dsm-project/scripts/src/';
const A=require(lib+'axis-bench.js'),C=require(lib+'axis-controller.js'),S=require(lib+'axis-server.cjs'),M=require(lib+'model.js'),machine=require(lib+'machine.js');
const doc=M.document(require('../example/cnc/machine.dsm.json')),h=M.head(doc),c=A.config(h.data,'CNC');
function execute(axis,atMs,program=c.program,settings=c.settings){
  const fault={axis,atMs},run=C.execute({program,settings,limits:c.limits,fault},machine.simulate);
  return {run,fault,metrics:A.metrics(run,settings,fault)};
}
test('independent receiver accepts only the project revision and exact NC text',async()=>{
  const body={project:doc.project,base:h.rev,root:'CNC',fault:{axis:'X',atMs:null},sha256:crypto.createHash('sha256').update(c.program).digest('hex')};
  const run=await S.execute(doc,body);assert.equal(run.engine,'node-sil');assert.equal(run.sha256,body.sha256);
  await assert.rejects(S.execute(doc,{...body,base:doc.history[0].rev}),/Конфликт/);
  await assert.rejects(S.execute(doc,{...body,sha256:'other'}),/сумма/);
});
test('three encoders, held setpoints, unattained injection, missed deadline and stationary axis',()=>{
  const normal=execute('none',null);assert.equal(normal.metrics.verdict,'passed');
  assert.deepEqual(normal.run.rows.at(-1).slice(2,5),machine.simulate(c.program,c.limits).moves.at(-1).to);
  for(const axis of ['X','Y','Z']){
    const {metrics,run}=execute(axis,null);
    assert.equal(metrics.verdict,'passed');assert.equal(metrics.hold,2);assert.equal(run.axis,axis);
    assert.equal(run.rows.at(-1)[8],'HOLD');
    assert.deepEqual(run.rows.at(-1).slice(2,5),run.rows.at(-3).slice(2,5));
  }
  assert.equal(execute('X',999999).metrics.verdict,'inconclusive');
  assert.equal(execute('Z',20,'G21\nG90\nG1 X20 F400').metrics.verdict,'inconclusive');
  assert.equal(execute('Y',null,c.program,{...c.settings,maxResponseMs:1}).metrics.verdict,'failed');
  assert.throws(()=>execute('V',20),/ось/);assert.throws(()=>execute('Z',-1),/Время/);
});
test('evidence survives ADR or criteria changes with its original configuration',()=>{
  const {run,fault,metrics}=execute('X',null);run.sha256='a'.repeat(64);
  const next=A.add(doc,'CNC',h.rev,fault,run),node=next.nodes.at(-1);
  const decision=next.nodes.find(n=>n.id===c.adr);
  const changed=M.patch(next,[{op:'node',value:{id:decision.id,note:'Обновлённая редакция'}}]);
  assert.equal(A.current(next,'CNC',node),true);assert.equal(A.current(changed,'CNC',node),false);
  assert.equal(A.read(node).config.decision,c.decision);
  const updated=M.commit(doc,next,h.rev,'Протокол','Стенд'),input={runId:node.id,project:doc.project,base:M.head(updated).rev,sha256:run.sha256,values:[metrics.peaks,metrics.delay,metrics.hold,metrics.verdict]};
  assert.ok(A.record(updated,input).nodes.at(-1).refs.includes(c.adr));
  assert.throws(()=>A.record(updated,{...input,values:[]}),/расходится/);
  assert.throws(()=>A.record(updated,{...input,base:h.rev}),/Конфликт/);
});
test('architecture package preserves alternative and imports rationale as a structured ADR field',async()=>{
  const spec=require(lib+'specifications.js'),files=await spec.openPackage(await spec.bundle(doc,c.proposal));
  const file=Object.keys(files).find(key=>key.startsWith('docs/adr/')&&key.endsWith('.md'));
  files[file]=files[file].replace(c.rationale,'Выбор проверен системным инженером');
  const result=spec.importPackage(doc,files).data;
  const adr=result.nodes.find(n=>n.id===c.adr);
  assert.equal(adr.attrs.rationale,'Выбор проверен системным инженером');
  assert.equal(adr.attrs.alternative,c.alternative);assert.equal(adr.note,c.decision);
});
