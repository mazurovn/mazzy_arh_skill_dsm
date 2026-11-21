'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const src=path.resolve(__dirname,'../skills/edit-dsm-project/scripts/src');
const load=name=>require(path.join(src,name+'.js'));
const R=load('runtime'),M=R.Model,N=load('notebook'),Files=load('notebook-files');
const S=load('specifications'),C=load('changes'),Reports=load('reports'),Registers=load('registers');
const doc=R.readProject(path.join(__dirname,'../example/enterprise-architecture.dsm.json'));
const data=M.head(doc).data;
const cell=(id,type,source)=>({id,cell_type:type,source,metadata:{},...(type==='code'?{outputs:[],execution_count:null}:{})});
const plain=()=>({nbformat:4,nbformat_minor:5,metadata:{language_info:{name:'python'}},cells:[cell('input','markdown',['# Notes\n','notes']),cell('user','code','print(6 * 7)')]});
const branch=(model,note)=>M.commit(doc,model,M.head(doc).rev,note,'QA');

test('book formats, line endings and section-specific diagnosis',()=>{
  const book=N.write(doc);book.cells[1].source=book.cells[1].source.replaceAll('\n','\r\n').split(/(?<=\n)/);
  assert.deepEqual(N.read(book).data,data);
  const broken=(update,pattern)=>{const b=plain();update(b);assert.throws(()=>Files.validate(b),pattern);};
  broken(b=>b.nbformat=3,/nbformat 4/);
  broken(b=>b.cells[1].id='input',/Ячейка 2.*ID/);
  broken(b=>b.cells[0].source=[5],/Ячейка 1.*источник/);
  broken(b=>b.cells[0].metadata.tags='string',/тегов/);
  broken(b=>b.cells[1].outputs=undefined,/outputs/);
  broken(b=>b.cells[1].execution_count=-1,/счётчик/);
  broken(b=>b.cells[1].outputs=[{}],/тип результата/);
  broken(b=>b.cells[1].id=22,/ID/);
  broken(b=>b.cells[1].outputs=[{output_type:'stream',text:{}}],/поток/);
  broken(b=>b.cells[1].outputs=[{output_type:'error',traceback:42}],/traceback/);
  broken(b=>b.cells[1].outputs=[{output_type:'display_data',data:{'text/plain':7}}],/MIME/);
  broken(b=>b.cells[0].cell_type='invalid',/тип/);
  const old=plain();old.nbformat_minor=4;for(const c of old.cells)delete c.id;
  assert.equal(Files.attach(old,N.write(doc)).cells[0].id,undefined);
  const wrong=M.copy(book);wrong.cells[1].cell_type='markdown';assert.throws(()=>N.read(wrong),/ячейкой кода/);
  delete book.metadata.dsm.base;assert.throws(()=>N.read(book),/project или base/);
});
test('portable notebook operations preserve originals, outputs and cell identities',()=>{
  const b=plain();const c=b.cells[1];
  c.outputs=[{output_type:'stream',name:'stdout',text:['4','2']},{output_type:'error',ename:'ValueError',evalue:'bad',traceback:['\x1b[31mtrace\x1b[0m']},{output_type:'display_data',data:{'text/html':'<h1>standalone</h1>'},metadata:{}}];
  c.execution_count=7;c.metadata.execution={start:1};b.metadata.widgets={};
  const bound=Files.attach(b,N.write(doc));assert.equal(bound.metadata.kernelspec.name,'python3');assert.equal(b.metadata.kernelspec,undefined);assert.equal(bound.cells.length,4);assert.equal(new Set(bound.cells.map(c=>c.id)).size,4);
  assert.equal(Files.overview(b)[1].outputs[0],'42');assert.match(Files.asMarkdown(b),/ValueError\nbad\ntrace/);assert.doesNotMatch(Files.asMarkdown(b),/<h1>|\x1b/);
  assert.match(Files.asPython(b),/# # Notes/);assert.match(Files.asPython(b),/print\(6 \* 7\)/);
  const clean=Files.clean(bound);assert.equal(clean.cells[2].outputs.length,0);assert.equal(clean.cells[2].execution_count,null);assert.equal(clean.metadata.widgets,undefined);assert.equal(b.cells[1].outputs.length,3);
  assert.throws(()=>Files.attach(bound,N.write(doc)),/уже содержит/);
  b.metadata.language_info.name='julia';assert.throws(()=>Files.asPython(b),/Python/);assert.throws(()=>Files.attach(b,N.write(doc)),/Python/);
  assert.throws(()=>N.result(bound),/dsm-result/);
  const result=bound.cells.at(-1);result.outputs.push({output_type:'display_data',data:{'application/vnd.mazzy.dsm+json':{...bound.metadata.dsm,data:{...data,title:'Computed'}}},metadata:{}});
  assert.equal(N.result(bound).data.title,'Computed');assert.equal(N.read(bound).data.title,data.title);
  result.outputs[0].data['application/vnd.mazzy.dsm+json'].base='old';assert.throws(()=>N.result(bound),/другой базе/);
});
for(const key of ['full','requirements','placement','readiness']){
  test('generated notebook accepts its original project base · '+key,()=>{
    const b=N.write(doc,key);Files.validate(b);assert.deepEqual(R.Fmt.preview(doc,N.read(b)),data);
    if(key!=='full')assert.equal(b.metadata.dsm.profile,key);
    assert.throws(()=>R.Fmt.preview(branch({...data,title:'next'},'Next'),N.read(b)),/баз/);
  });
}
const req={id:'CR-9',name:'Increase memory',problem:'Observed limit',outcome:'Add memory',acceptance:'Verify capacity',priority:'high',owner:'Ops',requester:'Alice',refs:['REQ-1','S1']};
test('request triage, promotion, task and decision audit trail',()=>{
  const input=C.request(data,req);
  assert.throws(()=>C.promote(input,req.id,'prop'),/примите/);
  assert.throws(()=>C.review(input,req.id,'accepted','Alice',''),/Обоснование/);
  assert.throws(()=>C.request(input,req),/занят/);
  const deferred=C.review(input,req.id,'deferred','Bob','Wait');assert.equal(deferred.nodes.at(-1).state,'blocked');
  assert.equal(C.review(input,req.id,'declined','Bob','Out of scope').nodes.at(-1).state,'done');
  const accepted=C.review(input,req.id,'accepted','Bob','Proceed');
  const promoted=C.promote(accepted,req.id,'add-memory');assert.throws(()=>C.promote(promoted,req.id,'second'),/существует/);
  const tasks=C.task(promoted,'add-memory','TASK-9','Install','Ops');assert.throws(()=>C.completeProposal(tasks,'add-memory'),/открытые задачи/);
  const done=C.completeProposal(M.patch(tasks,[{op:'node',value:{id:'TASK-9',state:'done'}}]),'add-memory');
  assert.equal(done.nodes.find(n=>n.id===req.id).state,'done');assert.equal(done.nodes.find(n=>n.id==='add-memory').state,'done');
  assert.throws(()=>C.task(done,'add-memory','NEW','Extra','Ops'),/завершено/);
  const multi=M.patch(tasks,[{op:'node',value:{id:'TASK-9',state:'done'}},{op:'node',value:{id:'another-proposal',kind:'proposal',name:'Second',state:'active',refs:[req.id]}}]);
  assert.equal(C.completeProposal(multi,'add-memory').nodes.find(n=>n.id===req.id).state,'active');
  const history=branch(input,'Intake'),updated=M.commit(history,done,M.head(history).rev,'Completed','Bob');
  assert.match(C.brief(done,req.id),/Verify capacity/);assert.match(C.brief(done,req.id),/add-memory/);
  assert.deepEqual(C.timeline(updated,req.id).map(h=>h.actor),['QA','Bob']);assert.match(C.changeLog(updated,M.head(doc).rev,M.head(updated).rev),/CR-9/);
  assert.throws(()=>C.changeLog(updated,M.head(updated).rev,M.head(doc).rev),/Конечная/);
});
test('OpenSpec package can return edits and rejects unsupported or stale updates',async()=>{
  const model=C.task(data,'upgrade-memory','TASK','Install','Alice'), d=branch(model,'Task');
  const raw=await S.openPackage(await S.bundle(d,'upgrade-memory')),files={...raw},paths=Object.keys(files),key=s=>paths.find(p=>p.endsWith(s));
  files[key('proposal.md')]=files[key('proposal.md')].replace('## Why','## Why\n\nNew reason');
  files[key('/spec.md')]=files[key('/spec.md')].replace('- **WHEN** ','- **WHEN** test ');
  files[key('tasks.md')]=files[key('tasks.md')].replace('[ ]','[x]');
  const adr=paths.find(p=>p.startsWith('docs/adr/'));files[adr]=files[adr].replace('## Контекст','## Контекст\n\nNew decision');
  const next=S.importPackage(d,files).data;
  assert.equal(M.diff(model,next).length,4);assert.equal(next.nodes.find(n=>n.id==='TASK').state,'done');
  assert.deepEqual(S.importPackage(d,raw).data,model);
  assert.throws(()=>S.importPackage(doc,raw),/база/);
  assert.throws(()=>S.importPackage(d,{...raw,[key('design.md')]:'Changed'}),/служебный/);
  assert.throws(()=>S.importPackage(d,{...raw,extra:'x'}),/состав/);
  assert.throws(()=>S.importPackage(d,{...raw,[key('tasks.md')]:'- [ ] Other'}),/отметки/);
  assert.throws(()=>S.importPackage(d,{...raw,[key('/spec.md')]:'Partial'}),/WHEN/);
  const without=M.patch(data,[{op:'node',value:{id:'REQ-1',note:'',attrs:{}}},{op:'node',value:{id:'ADR-1',refs:[]}}]);
  const check=S.readiness(without,'upgrade-memory');assert.match(check.errors.join(' '),/when, then, описание/);assert.match(check.warnings.join(' '),/ADR/);
  const colliding=M.patch(data,[{op:'node',value:{id:'dsm-u-52-45-51-2d-31',kind:'requirement',name:'Collision',note:'X',attrs:{when:'X',then:'Y'},refs:['upgrade-memory']}}]);
  assert.equal(Object.keys(S.packageFiles(branch(colliding,'a'),'upgrade-memory').files).filter(p=>p.endsWith('spec.md')).length,2);
});
const fixture=M.validate({title:'Checks',nodes:[
  {id:'A',name:'Service',kind:'service',state:'blocked',segment:'X',release:'R',relations:[['deployedOn','H']]},
  {id:'B',name:' service ',kind:'component',segment:'Y',release:'T'},
  {id:'H',name:'Host',kind:'server'},{id:'R',name:'Release R',kind:'release',capacity:5},{id:'T',name:'Release T',kind:'release'},
  {id:'Q',name:'Requirement',kind:'requirement'}, {id:'D',name:'Decision',kind:'adr'},{id:'F',name:'Feature',kind:'feature',effort:3}
],edges:[{from:'A',to:'B',layer:'flow',weight:2,reason:'ab'},{from:'B',to:'A',layer:'flow',weight:1,reason:'ba'},{from:'H',to:'B',layer:'flow',weight:1,reason:'hb'},{from:'B',to:'A',layer:'risk',weight:3,reason:'review'}]});
const expected={cycles:['A, B',2],reciprocal:['A','B',2,1],isolated:['D','Decision','adr'],contracts:['A','B',3,'review'],segments:['A','B','X','Y'],releases:['A','B','flow','R','T'],consumers:['B',2,3],placement:['A','H','server'],unplaced:['B','component',' service '],owners:['H','server','Host'],verification:['Q','Requirement'],unchecked:['H','B','hb'],decisions:['D','Decision','unspecified'],singleHost:['A','H'],duplicates:['Service','A, B',2],backlog:['—',1,3,0],reserve:['R',5,0,5,1],blocked:['A','H',2]};
for(const [key,row] of Object.entries(expected)){
  test('analytical report · '+key,()=>{
    const r=Reports.run(fixture,key);assert.ok(r.rows.some(v=>JSON.stringify(v)===JSON.stringify(row)));assert.equal(row.length,r.columns.length);
    assert.deepEqual(Reports.run({title:'Empty',nodes:[],edges:[]},key).rows,[]);
  });
}
test('catalog and history filters preserve scope, date and order',()=>{
  const f={...Registers.defaults(),kind:'server',order:'name'};
  assert.equal(Registers.nodes(data,'memorygib 16',f)[0].id,'S1');
  assert.equal(Registers.nodes(data,'',{...f,release:'REL'}).length,0);
  assert.deepEqual(Registers.nodes(data,'',{...Registers.defaults(),state:'review'}).map(n=>n.id),['DEV-1','upgrade-memory']);
  const h=branch(M.patch(data,[{op:'node',value:{id:'S1',name:'Host 02'}}]),'Changed host');
  const base={actor:'',object:'',text:'',from:'',until:'',oldest:false};
  assert.equal(Registers.revisions(h,{...base,actor:'QA',object:'S1',text:'changed host'}).length,1);
  assert.equal(Registers.revisions(h,{...base,from:'2999-01-01'}).length,0);
  assert.equal(Registers.revisions(h,{...base,until:'1970-01-01'}).length,0);
  assert.deepEqual(Registers.revisions(h,{...base,oldest:true}).map(r=>r.i),[0,1]);
});
