'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const src='../skills/edit-dsm-project/scripts/src/';
const R=require(src+'runtime.js'),M=R.Model,S=require(src+'installations.js'),Book=require(src+'notebook.js');
const fixture=path.resolve(__dirname,'../example/server-procurement.xlsx');
async function catalog(){
  const input=await R.readInput(fixture);
  const doc=M.create({title:'Закупка',nodes:[],edges:[]});
  return R.Fmt.preview(doc,input);
}
const edit=(m,id,attrs)=>M.patch(m,[{op:'node',value:{id,attrs:{...m.nodes.find(n=>n.id===id).attrs,...attrs}}}]);

test('ordinary Excel keeps typed columns, separate architecture links and both DSM layers',async()=>{
  const m=await catalog(),start=M.create(m);
  assert.deepEqual([m.nodes.length,m.edges.length],[12,2]);
  assert.equal(m.nodes.flatMap(n=>n.relations||[]).length,9);
  assert.equal(m.nodes.find(n=>n.id==='DB').attrs.antiAffinity,true);
  const add=R.Fmt.readCsv('from,relation,to\nAPI,uses,DB');
  const next=R.Fmt.preview(start,add);
  assert.equal(next.nodes.find(n=>n.id==='API').relations.length,3);
  assert.deepEqual(R.Fmt.preview(M.create(next),add),next);
  assert.deepEqual(R.Fmt.preview(start,await R.readInput(fixture)),m);
  const partial=R.Fmt.readCsv('id,name,attr.cpuCores\nAPI,Новый API,6');
  const a=R.Fmt.preview(start,partial).nodes.find(n=>n.id==='API');
  assert.equal(a.attrs.cpuCores,6);assert.equal(a.attrs.replicas,3);assert.equal(a.relations.length,2);
  assert.throws(()=>R.Fmt.preview(start,R.Fmt.readCsv('from,relation,to\nAPI,uses,UNKNOWN')),/ссылка/);
});

test('structure and DSM view CSV can be reapplied without changing the identities or weights',async()=>{
  const m=await catalog();
  const d=M.create(M.patch(m,[{op:'node',value:{id:'R',kind:'release',name:'Поставка'}},{op:'node',value:{id:'PROC',release:'R',refs:['HOST']}}]));
  const model=M.head(d).data;
  const edges=[{from:'PROC',to:'R',layer:'release'},{from:'PROC',to:'HOST',layer:'ref'},
    {from:'ORG',to:'PROC',layer:'parent'},{from:'DB',to:'INST',layer:'deployedOn'},...model.edges];
  const file=R.Fmt.csv([['from','to','layer','weight','reason'],...edges.map(e=>[e.from,e.to,e.layer,e.weight??'',e.reason])]);
  assert.deepEqual(R.Fmt.preview(d,R.Fmt.readCsv(file)),model);
});

test('whole replicas, separation, reserve, budget, resource saturation and uncovered functions',async()=>{
  const m=await catalog(),p=S.calculate(m,'INST');
  assert.deepEqual(p.totals,[28,144,1160]);
  assert.deepEqual([p.required,p.purchase,p.budget],[3,2,960000]);
  for(const b of p.bins){assert.equal(b.members.DB,1);assert.ok(b.used.every((value,i)=>value<=p.limits[i]));}
  const apart=S.calculate(edit(m,'API',{antiAffinity:true}),'INST');
  assert.equal(apart.required,4);assert.equal(apart.purchase,3);
  assert.equal(S.calculate(edit(m,'INST',{existingHosts:5}),'INST').purchase,0);
  assert.throws(()=>S.calculate(edit(m,'DB',{ramGiB:97}),'INST'),/не помещается|помещаться/);
  assert.throws(()=>S.calculate(edit(m,'HOST',{cpuCores:0}),'INST'),/целое число/);
  assert.throws(()=>S.calculate(edit(m,'DB',{replicas:0}),'INST'),/целое число/);
  assert.throws(()=>S.calculate(edit(m,'DB',{replicas:4100}),'INST'),/4096/);
  assert.equal(S.coverage(m).filter(f=>f.covered).length,2);
  const orphan=M.patch(m,[{op:'node',value:{id:'API',relations:[['realizes','FN-ORDER']]}}]);
  assert.equal(S.coverage(orphan).find(f=>f.id==='FN-ORDER').covered,false);
});

test('notebook receipt uses original project and proposal plus measured per-host capacities',async()=>{
  const m=await catalog();
  const records=[{id:'REQ-2',kind:'requirement',name:'Другое требование'},
    {id:'CHANGE',kind:'proposal',name:'Поставка',state:'done',refs:['REQ-CAP'],attrs:{appliedObject:'INST'}}];
  const doc=M.create(M.patch(m,records.map(value=>({op:'node',value}))));
  const b=Book.write(doc,'installation','INST'),result=b.cells.at(-1);
  assert.throws(()=>Book.result(b),/inventory/);
  const f={actor:'Комиссия',source:'Ведомость',environment:'ЦОД',requirement:'REQ-CAP',proposal:'CHANGE',installation:'INST',
    inventory:[1,2,3].map(i=>({id:'SN-'+i,cpuCores:16,ramGiB:96,diskGiB:i===3?799:800}))};
  const v={project:doc.project,base:M.head(doc).rev,observation:f};
  result.outputs=[{output_type:'display_data',metadata:{},data:{'application/vnd.mazzy.installation+json':v}}];
  const input=Book.result(b),after=R.Fmt.preview(doc,input);
  const obs=after.nodes.find(n=>n.id==='OBS-1');assert.equal(obs.attrs.verification,'failed');assert.equal(obs.attrs.qualifiedHosts,2);
  assert.ok(obs.refs.includes('HOST'));assert.deepEqual(obs.relations,[['verifies','REQ-CAP']]);
  const attempt=changes=>R.Fmt.preview(doc,{...input,observation:{...f,...changes}});
  assert.throws(()=>attempt({inventory:[]}),/фактические/);
  assert.throws(()=>attempt({inventory:[f.inventory[0],f.inventory[0]]}),/уникальный/);
  assert.throws(()=>attempt({requirement:'REQ-2'}),/Предложение/);
  assert.throws(()=>attempt({inventory:[{id:'SN-1'}]}),/целое число/);
  assert.throws(()=>R.Fmt.preview(M.commit(doc,after,v.base,'Проверили','Инженер'),input),/база/);
});
