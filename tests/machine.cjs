const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),src=path.join(root,'skills/edit-dsm-project/scripts/src');
const M=require(src+'/model.js'),Machine=require(src+'/machine.js'),V=require(src+'/vibration.js');
const Book=require(src+'/notebook.js'),Analysis=require(src+'/analysis.js'),Bridge=require(src+'/bridge.js');
const doc=M.document(require('../example/cnc/machine.dsm.json')),h=M.head(doc),model=h.data;
function seconds(duration){return M.patch(model,[{op:'node',value:{id:'REQ-CAP',attrs:{...model.nodes.find(n=>n.id==='REQ-CAP').attrs,durationSeconds:duration}}}]);}
test('recording duration selects the smallest feasible part, including no match',()=>{
  for(const [s,bytes,choice] of [[10,3270752,'NOR4'],[20,6541504,'NOR8'],[21,6868624,null]]){
    const x=Machine.calculate(seconds(s),'CNC');assert.equal(x.selected,choice);
    assert.equal(x.bytes,bytes);
  }
  const data=seconds(20),r=Machine.calculate(data,'CNC');assert.equal(r.options[1].margin,169382);
  const n=data.nodes.find(n=>n.id==='ACC');n.attrs.quantity=1;assert.equal(Machine.calculate(data,'CNC').bytes,3270752);
  assert.throws(()=>Machine.calculate(model,'absent'),/изделие/);
  assert.deepEqual(Bridge.invoke(path.join(root,'example/cnc/machine.dsm.json'),'dsm_analyze',{machine:'CNC'}),Machine.calculate(model,'CNC'));
});
test('Python result must match all numeric inputs and the current version',()=>{
  const r=Machine.calculate(model,'CNC'),values=[r.bytes,r.selected,r.streams.map(s=>[s.id,s.count,s.samples,s.blocks,s.total]),r.options.map(o=>[o.id,o.usable,o.margin])];
  const input={project:doc.project,base:h.rev,root:'CNC',values};
  const next=Machine.receipt(doc,input);assert.ok(next.nodes.at(-1).refs.includes('ACC'));
  assert.throws(()=>Machine.receipt(doc,{...input,base:doc.history[0].rev}),/Конфликт/);
  assert.throws(()=>Machine.receipt(doc,{...input,values:[r.bytes+1,...values.slice(1)]}),/расходится/);
  const book=Book.write(doc,'machine','CNC');assert.throws(()=>Book.result(book),/Выполните/);
  const cell=book.cells.at(-1);cell.outputs=[{output_type:'display_data',metadata:{},data:{'application/vnd.mazzy.machine+json':input}}];
  assert.deepEqual(Book.result(book),{...input,kind:'machine-receipt'});
  cell.outputs.push(cell.outputs[0]);assert.throws(()=>Book.result(book),/Выполните/);
});
test('program preview checks axis travel, declared modes and feed',()=>{
  const limits=Machine.envelope(model,'CNC'),source=model.nodes.find(n=>n.id==='JOB-1').note;
  assert.ok(Machine.simulate(source,limits).moves.length>2);
  assert.deepEqual(Machine.simulate('g21\ng90\ng01x3y4f100 ; diagonal',limits).moves[0].to,[3,4,0]);
  for(const program of ['G1 X3','G21\nG90\nG1 X3','G21\nG90\nG0 X9999','G21\nG90\nG2 X4','G21\nG90\nG1 X3 F0','G21\nG90\nG0 X1 X2']){
    assert.throws(()=>Machine.simulate(program,limits),/Строка/);
  }
});
test('function allocations, pilot tasks and both DSM use shared IDs',()=>{
  const scope=Machine.architecture(model,'CNC');assert.equal(scope.nodes.length,17);
  for(const layer of ['flow','risk']){
    const a=Analysis.calculate(scope,layer);assert.ok(a.cost_before>a.cost_after);assert.equal(a.order.length,17);
    assert.ok(scope.edges.some(e=>e.from==='VIEW'&&e.to==='REC'&&e.layer===layer));
  }
  const chain=require(src+'/delivery.js').chain(model,'REQ-CAP');
  assert.equal(chain.stage,'work');assert.equal(chain.decisions[0].id,'ADR-FILE');
  assert.deepEqual(chain.tasks.map(t=>t.release),['REL-PILOT','REL-PILOT','REL-PILOT']);
});
test('C99 firmware interoperates with the client and detects short capture, gaps and corruption',t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dsm-vib-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const bin=path.join(tmp,'replay'),dir=path.join(root,'example/cnc/firmware');
  execFileSync('cc',['-std=c99','-Wall','-Wextra','-Werror','-pedantic',dir+'/vib1.c',dir+'/replay.c','-o',bin]);
  const wire=execFileSync(bin,['10'],{maxBuffer:8*1024*1024}),js=V.generate(model,'CNC',Machine);
  assert.deepEqual(wire,Buffer.from(js));
  const valid=V.inspect(model,'CNC',wire,Machine);assert.ok(valid.complete);assert.equal(valid.bytes,3270752);
  assert.deepEqual(valid.wave.slice(0,3),[-512,-509,-506]);assert.deepEqual(valid.streams.map(s=>s.samples),[267000,267000]);
  const block=32+256*3*2,tail=32+267000%256*6;
  assert.equal(V.inspect(model,'CNC',wire.subarray(0,-tail),Machine).complete,false);
  assert.throws(()=>V.inspect(model,'CNC',wire.subarray(block),Machine),/последовательность/);
  assert.throws(()=>V.inspect(model,'CNC',wire.subarray(0,-1),Machine),/размер/);
  wire[40]^=1;assert.throws(()=>V.inspect(model,'CNC',wire,Machine),/CRC/);
});
