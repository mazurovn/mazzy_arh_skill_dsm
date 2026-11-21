const Specifications = ((M,Zip)=>{
  const linked = (a,b) => (a.refs||[]).includes(b.id)||(b.refs||[]).includes(a.id)||
    (a.relations||[]).some(r=>r[1]===b.id)||(b.relations||[]).some(r=>r[1]===a.id);
  function coverage(model){
    return model.nodes.filter(n=>n.kind==='requirement').map(requirement=>{
      const related=model.nodes.filter(n=>linked(n,requirement));
      const implementations=related.filter(n=>(n.relations||[]).some(([kind,to])=>kind==='realizes'&&to===requirement.id));
      const affected=new Set([requirement.id,...implementations.map(n=>n.id)]);
      const deviations=model.nodes.filter(n=>n.kind==='deviation'&&n.state!=='done'&&(n.refs||[]).some(id=>affected.has(id)));
      return {requirement,implementations,deviations};
    });
  }
  function document(n){
    const refs=(n.refs||[]).join(', ');
    return '# '+n.name+'\n\n'+n.note+(refs?'\n\nСвязанные ID · '+refs:'')+(n.steps?'\n\n'+n.steps.map((s,i)=>(i+1)+'. '+s.join(' → ')).join('\n'):'')+'\n';
  }
  function slug(id){
    if(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id))return id;
    return 'dsm-'+Array.from(id,c=>c.codePointAt(0).toString(16)).join('-');
  }
  async function bundle(doc, proposalId){
    const model=M.head(doc).data,proposal=model.nodes.find(n=>n.id===proposalId&&n.kind==='proposal');
    if(!proposal)throw Error('Выберите предложение OpenSpec');
    const related=model.nodes.filter(n=>linked(n,proposal)),requirements=related.filter(n=>n.kind==='requirement'),adrs=related.filter(n=>n.kind==='adr');
    if(!requirements.length)throw Error('Свяжите предложение хотя бы с одним требованием');
    const change=slug(proposal.id),root='openspec/changes/'+change+'/',z=new Zip();
    z.file('openspec/config.yaml','schema: spec-driven\n');
    z.file(root+'.openspec.yaml','schema: spec-driven\n');
    z.file(root+'proposal.md',document(proposal));
    const decisions=adrs.map(n=>{const file='docs/adr/'+slug(n.id)+'.md';z.file(file,document(n));return '- ['+n.id+'](../../../'+file+')';});
    z.file(root+'design.md','## Context\n\n'+model.title+' · '+M.head(doc).rev+'\n\n## Decisions\n\n'+(decisions.join('\n')||'Решение ожидается.')+'\n');
    z.file(root+'tasks.md','## 1. Проверка требований\n\n'+requirements.map((r,i)=>'- ['+(r.state==='done'?'x':' ')+'] 1.'+(i+1)+' '+r.name.replace(/\s+/g,' ')).join('\n')+'\n');
    for(const r of requirements){
      if(!r.note.trim()||!String(r.attrs?.when??'').trim()||!String(r.attrs?.then??'').trim())throw Error('Для '+r.id+' заполните описание, атрибуты when и then');
      const title=r.name.replace(/\s+/g,' ').trim();
      z.file(root+'specs/'+slug(r.id)+'/spec.md','## ADDED Requirements\n\n### Requirement: '+title+'\n'+r.id+' SHALL '+r.note.trim()+'\n\n#### Scenario: '+title+'\n- **WHEN** '+r.attrs.when+'\n- **THEN** '+r.attrs.then+'\n');
    }
    return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  return {coverage,document,bundle};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof JSZip!=='undefined'?JSZip:require('./vendor/jszip.js'));
if(typeof module!=='undefined')module.exports=Specifications;
