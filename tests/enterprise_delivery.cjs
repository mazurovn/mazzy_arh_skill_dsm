'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const src='../skills/edit-dsm-project/scripts/src/';
const M=require(src+'model.js'),C=require(src+'changes.js'),D=require(src+'delivery.js'),A=require(src+'analysis.js'),R=require(src+'registers.js');
const fixture=require('./enterprise_catalog.cjs');

test('large catalog keeps the established DSM partition, cost and edge semantics',()=>{
  const data=fixture(1200,1).history[0].data;
  for(const [layer,groups,cost] of [['flow',5,28162],['risk',601,1198]]){
    const result=A.calculate(data,layer);
    assert.equal(result.groups.length,groups);assert.equal(result.cost_after,cost);
    assert.equal(new Set(result.order).size,1200);
  }
  const impact=A.impact(data,'EA-01199');
  assert.equal(impact.dependents.length,1199);
});

test('indexed history includes added, renamed, removed and incident objects on either end',()=>{
  const base=fixture(36,4),id='EA-00013',data=M.head(base).data;
  const edge=data.edges.find(e=>e.from==='EA-00002'&&e.to===id);
  const next=M.commit(base,M.patch(data,[{op:'edge',value:{...edge,reason:'updated'}}]),M.head(base).rev,'Контракт','Архитектор');
  const removal=M.commit(next,M.patch(M.head(next).data,[{op:'removeEdge',value:edge}]),M.head(next).rev,'Удаление связи','Архитектор');
  const f={actor:'',object:id,from:'',until:'',text:'',oldest:true};
  for(const object of [id,edge.from]){
    const hits=R.revisions(removal,{...f,object}).map(i=>i.i);assert.deepEqual(hits.slice(-2),[4,5]);
    assert.deepEqual(R.revisions(removal,{...f,object,text:'Контракт'}).map(i=>i.i),[4]);
    assert.equal(R.revisions(base,{...f,object}).some(i=>i.i>3),false);
  }
  let doc=removal;
  for(const edit of [{op:'node',value:{id:'TEMP',kind:'component',name:'Временный'}},
    {op:'node',value:{id:'TEMP',name:'Переименован'}},{op:'removeNode',id:'TEMP'}]){
    doc=M.commit(doc,M.patch(M.head(doc).data,[edit]),M.head(doc).rev,'Каталог','Архитектор');
  }
  assert.deepEqual(R.revisions(doc,{...f,object:'TEMP'}).map(i=>i.i),[6,7,8]);
});

test('linked delivery, task dependencies, capacity, failed observation and scoped recheck',()=>{
  let m=M.validate({title:'Предприятие',nodes:[],edges:[]});
  m=D.requirement(m,{id:'Q',name:'Резерв',need:'Память',when:'При пике',then:'32 ГиБ',owner:'Склад',due:'2026-01-01'});
  const current=()=>D.chain(m,'Q');
  const queue=(extra={})=>D.portfolio(m,{stage:'',owner:'',overdue:false,...extra},'2026-02-01');
  assert.equal(queue({stage:'intake',owner:'Склад',overdue:true}).length,1);
  assert.equal(queue({owner:'ИТ'}).length,0);
  m=C.request(m,{id:'C',name:'Резерв',problem:'16',outcome:'32',acceptance:'Проверить',owner:'ИТ',requester:'Анна',priority:'high',refs:['Q']});
  m=C.review(m,'C','accepted','Анна','Согласовано');
  m=C.promote(m,'C','change-memory');
  m=D.decision(m,current(),{id:'ADR',name:'Расширить',choice:'Память',effects:'Остановка',actor:'ИТ'});
  m=M.patch(m,[{op:'node',value:{id:'R',kind:'release',name:'Пилот',capacity:4}}]);
  m=D.task(m,current(),{id:'A',name:'Заказать',owner:'ИТ',release:'R',effort:'2'});
  m=D.task(m,current(),{id:'B',name:'Установить',owner:'ИТ',release:'R',effort:'3',after:'A'});
  assert.equal(M.plan(m)[0].knownEffort,5);
  assert.throws(()=>D.taskState(m,'B'),/Сначала/);
  m=D.taskState(m,'A');m=D.taskState(m,'B');
  assert.throws(()=>D.taskState(m,'A'),/Сначала/);
  m=D.apply(m,current(),{target:'S',targetName:'Сервер',attribute:'memory',value:'32',type:'number'});
  assert.equal(D.index(m).by.get('S').attrs.memory,32);assert.equal(current().stage,'verify');
  const f={environment:'Пром',actor:'Анна',evidence:'Измерили 16',outcome:'failed'};
  m=D.observe(m,current(),f);assert.equal(current().stage,'deviation');
  m=D.observe(m,current(),{...f,environment:'Стенд',outcome:'passed'});assert.equal(current().deviations.length,1);
  m=D.observe(m,current(),{...f,evidence:'Измерили 32',outcome:'passed'});
  assert.equal(current().stage,'done');assert.equal(current().requirement.state,'done');assert.equal(current().observations.length,3);
  assert.equal(queue({overdue:true}).length,0);assert.match(D.trace(current()),/Измерили 16/);assert.match(D.trace(current()),/DEV-1/);
});
