'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src='../skills/edit-dsm-project/scripts/src/';
const M=require(src+'model.js'),Fleet=require(src+'fleet.js'),Change=require(src+'fleet-change.js'),Source=require(src+'fleet-source.js'),Spec=require(src+'specifications.js'),Notebook=require(src+'notebook.js');
const form={requirement:'REQ-HA',specification:'SPEC-HA',context:'Два ЦОД',alternatives:'STD, DENSE',rationale:'Восстановление N−1',consequences:'Локальный резерв',owner:'Архитектор'};
const commit=(d,m,note='Изменение')=>M.commit(d,m,M.head(d).rev,note,'Испытания');
const model=d=>M.head(d).data;
const get=(d,id)=>model(d).nodes.find(n=>n.id===id);
async function fixture(){
  let d=M.create({title:'Два ЦОД',nodes:[],edges:[]});
  for(const k of Source.sourceKinds){
    const name=k+'.csv';
    const bytes=fs.readFileSync(path.join(__dirname,'../example/two-dc',name));
    d=commit(d,await Source.ingest(d,k,name,bytes,'BUY'),name);
  }
  return d;
}
function frozen(d,option='resilient',budget=1440000){
  const choice=Fleet.analyze(model(d),'BUY').choices.find(c=>c.key===option);
  return commit(d,Change.freeze(d,'BUY',choice,option,'REL',budget,'Целевой парк с расчётом'));
}
const edit=(d,id,fields)=>commit(d,M.patch(model(d),[{op:'node',value:{id,...fields}}]));

test('budget, N−1 and traced proposal gate atomic adoption',async()=>{
  const base=await fixture();
  assert.throws(()=>Change.approve(frozen(base,'resilient',1439999),'PLAN-1',form),/бюджет/);
  assert.throws(()=>Change.approve(frozen(base,'normal'),'PLAN-1',form),/резерв/);
  const draft=frozen(base);
  const approved=commit(draft,Change.approve(draft,'PLAN-1',form));
  const change=get(approved,'CHANGE-1');
  assert.deepEqual(Spec.readiness(model(approved),change.id).errors,[]);
  const files=Spec.packageFiles(approved,change.id).files;
  assert(Object.keys(files).some(k=>k.endsWith('/spec.md')));
  assert(Object.keys(files).some(k=>k.includes('docs/adr/')));
  assert.throws(()=>Change.implement(edit(approved,'SPEC-HA',{note:'Изменён критерий'}),'PLAN-1'),/спецификация/);
  assert.throws(()=>Change.implement(edit(approved,'DENSE',{attrs:{...get(approved,'DENSE').attrs,unitPriceRub:1}}),'PLAN-1'),/изменились/);
  const done=commit(approved,Change.implement(approved,'PLAN-1'));
  assert.equal(get(done,'CHANGE-1').state,'done');
  assert.equal(get(done,'WORK-1').state,'done');
  assert.equal(Change.historical(done,get(done,'PLAN-1')).choice.cost,1440000);
  assert.equal(Fleet.analyze(model(done),'BUY').choices.find(c=>c.key==='resilient').cost,0);
  assert.throws(()=>Change.implement(done,'PLAN-1'),/согласованный/);
});

test('receipt cross-checks order, price, relocations, partitions, source bytes and revision',async()=>{
  const base=await fixture(),data=model(base),a=Fleet.analyze(data,'BUY'),choice=a.choices[2],h=M.head(base);
  const lab={root:'BUY',key:'resilient',cost:choice.cost,worst:choice.worst,clusters:Object.fromEntries(['flow','risk'].map(k=>[k,Change.cluster(data,a,k).groups])),
    failures:choice.sites.flatMap(s=>s.failures.map(f=>[s.site,f.host,f.unplaced,f.moves]))};
  const input={kind:'fleet-result',data,lab,base:h.rev,project:base.project};
  for(const [key,value] of Object.entries({cost:1,worst:4,failures:[],clusters:{}}))
    assert.throws(()=>Change.fromBook(base,{...input,lab:{...lab,[key]:value}}),/расход/);
  const changed=structuredClone(input);changed.data.nodes.find(n=>n.attrs?.fleetRole==='source').attrs.sha256='0'.repeat(64);
  await assert.rejects(()=>Source.verifyResult(changed),/контрольная сумма/);
  const result=Change.fromBook(base,input),saved=commit(base,result);
  assert.deepEqual(M.diff(data,result).map(r=>r.key),['SIM-1']);
  assert.throws(()=>Change.fromBook(saved,input),/база/);
  const book=Notebook.replayFleet(saved,'SIM-1');
  assert.equal(book.metadata.dsm.base,M.head(saved).rev);
  const cluster=Change.fromBook(base,{...input,lab:{...lab,lifecycle:{action:'cluster',layer:'risk'}}});
  assert.deepEqual(cluster.nodes.filter(n=>n.attrs?.fleetRole==='partition').map(n=>n.refs),lab.clusters.risk);
  const plan=Change.fromBook(base,{...input,lab:{...lab,lifecycle:{action:'save',name:'Закупка',release:'REL',description:'Два ЦОД'}}});
  assert.equal(plan.nodes.find(n=>n.id==='PLAN-1').attrs.base,h.rev);
});

test('source reimport preserves identity and maps Markdown back to its requirement',async()=>{
  const d=await fixture(),file='requirements.csv',bytes=fs.readFileSync(path.join(__dirname,'../example/two-dc',file));
  assert.deepEqual(M.diff(model(d),await Source.ingest(d,'requirements',file,bytes,'BUY')),[]);
  const m=await Source.ingest(d,'specifications','monitoring.md',Buffer.from('# Метрики\nКонтроль RAM.'),'BUY','REQ-HA');
  assert.deepEqual(m.nodes.find(n=>n.attrs?.filename==='monitoring.md'&&n.attrs.fleetRole==='specification').refs,['BUY','REQ-HA']);
});
