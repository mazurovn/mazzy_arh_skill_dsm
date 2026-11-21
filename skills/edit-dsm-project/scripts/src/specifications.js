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
    if(!id.startsWith('dsm-u-')&&/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id))return id;
    return 'dsm-u-'+Array.from(id,c=>c.codePointAt(0).toString(16)).join('-');
  }
  function context(model,proposalId){
    const proposal=model.nodes.find(n=>n.id===proposalId&&n.kind==='proposal');
    if(!proposal)throw Error('Выберите предложение OpenSpec');
    const related=model.nodes.filter(n=>linked(n,proposal));
    return {proposal,related,requirements:related.filter(n=>n.kind==='requirement'),adrs:related.filter(n=>n.kind==='adr'),tasks:model.nodes.filter(n=>n.kind==='changeTask'&&n.parent===proposalId)};
  }
  function readiness(model,id){
    const {requirements,adrs,tasks,proposal}=context(model,id),errors=[],warnings=[];
    if(!requirements.length)errors.push('Свяжите предложение хотя бы с одним требованием');
    for(const r of requirements){
      const missing=['when','then'].filter(k=>typeof r.attrs?.[k]!=='string'||!r.attrs[k].trim());
      if(!r.note.trim())missing.push('описание');
      if(missing.length)errors.push(r.id+' · заполните '+missing.join(', '));
    }
    if(!adrs.length)warnings.push('К предложению пока не привязан ADR');
    if(!proposal.note.trim())warnings.push('Не заполнено описание предложения');
    const open=tasks.filter(n=>n.state!=='done');
    if(open.length)warnings.push('Открытые задачи · '+open.map(n=>n.id).join(', '));
    return {errors,warnings};
  }
  function packageFiles(doc,id){
    const model=M.head(doc).data,{proposal,requirements,adrs,tasks}=context(model,id);
    const {errors}=readiness(model,id);if(errors.length)throw Error(errors.join('\n'));
    const root='openspec/changes/'+slug(id)+'/',files={},edit={};
    files['openspec/config.yaml']='schema: spec-driven\n';
    files[root+'.openspec.yaml']='schema: spec-driven\n';
    files[root+'proposal.md']=document(proposal);edit[root+'proposal.md']={type:'document',id};
    const decisions=adrs.map(n=>{
      const path='docs/adr/'+slug(n.id)+'.md';files[path]=document(n);edit[path]={type:'document',id:n.id};
      return '- ['+n.id+'](../../../'+path+')';
    });
    files[root+'design.md']='## Context\n\n'+model.title+' · '+M.head(doc).rev+'\n\n## Decisions\n\n'+(decisions.join('\n')||'Решение ожидается.')+'\n';
    const checklist=tasks.length?tasks:requirements;
    files[root+'tasks.md']='## 1. '+(tasks.length?'Задачи изменения':'Проверка требований')+'\n\n'+checklist.map((r,i)=>'- ['+(r.state==='done'?'x':' ')+'] 1.'+(i+1)+' '+r.name.replace(/\s+/g,' ')).join('\n')+'\n';
    if(tasks.length)edit[root+'tasks.md']={type:'tasks',ids:tasks.map(t=>t.id)};
    for(const r of requirements){
      const title=r.name.replace(/\s+/g,' ').trim(),path=root+'specs/'+slug(r.id)+'/spec.md';
      files[path]='## ADDED Requirements\n\n### Requirement: '+title+'\n'+r.id+' SHALL '+r.note.trim()+'\n\n#### Scenario: '+title+'\n- **WHEN** '+r.attrs.when+'\n- **THEN** '+r.attrs.then+'\n';
      edit[path]={type:'requirement',id:r.id};
    }
    files['dsm-package.json']=JSON.stringify({format:1,project:doc.project,base:M.head(doc).rev,proposal:id},null,2);
    return {files,edit};
  }
  async function bundle(doc,id){
    const z=new Zip();
    for(const [path,text] of Object.entries(packageFiles(doc,id).files))z.file(path,text);
    return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
  }
  async function openPackage(bytes){
    if(bytes.byteLength>16*1024*1024)throw Error('ZIP превышает 16 МиБ');
    const z=await Zip.loadAsync(bytes),entries=Object.values(z.files).filter(f=>!f.dir);
    if(entries.length>1024)throw Error('Слишком много файлов в пакете');
    let size=0;const files=Object.create(null);
    for(const f of entries){
      size+=f._data?.uncompressedSize||0;
      if(size>16*1024*1024)throw Error('Распакованные файлы превышают 16 МиБ');
      if(f.unsafeOriginalName&&f.unsafeOriginalName!==f.name)throw Error('Некорректное имя файла в ZIP');
      if(!/\.(?:md|ya?ml|json)$/i.test(f.name))throw Error('Неподдерживаемый файл в пакете: '+f.name);
      files[f.name]=(await f.async('string')).replace(/\r\n/g,'\n');
    }
    return files;
  }
  function importPackage(doc,files){
    if(!files['dsm-package.json'])throw Error('Для импорта нужен пакет DSM с исходной ревизией');
    const m=JSON.parse(files['dsm-package.json']);
    if(m.format!==1||m.project!==doc.project||m.base!==M.head(doc).rev)throw Error('Другая база пакета OpenSpec');
    const {files:expected,edit}=packageFiles(doc,m.proposal),ops=[];
    for(const key of new Set([...Object.keys(expected),...Object.keys(files)])){
      if(!Object.hasOwn(expected,key)||!Object.hasOwn(files,key))throw Error('Изменён состав пакета: '+key);
      if(files[key]===expected[key])continue;
      const entry=edit[key];if(!entry)throw Error('Верните исходный служебный файл: '+key);
      const contents=files[key],node=M.head(doc).data.nodes.find(n=>n.id===entry.id);
      if(entry.type==='document'){
        const suffix=document(node).slice(('# '+node.name+'\n\n'+node.note).length);
        const head=contents.match(/^# ([^\n]+)\n\n/);
        if(!head||!contents.endsWith(suffix))throw Error('Проверьте заголовок и ссылки: '+key);
        ops.push({op:'node',value:{id:node.id,name:head[1],note:contents.slice(head[0].length,-suffix.length)}});
      }else if(entry.type==='requirement'){
        const parts=contents.trimEnd().match(/^## ADDED Requirements\n\n### Requirement: ([^\n]+)\n(\S+) SHALL ([\s\S]+?)\n\n#### Scenario: ([^\n]+)\n- \*\*WHEN\*\* ([\s\S]+?)\n- \*\*THEN\*\* ([\s\S]+)$/);
        if(!parts||parts[2]!==node.id||parts[1]!==parts[4]||[parts[3],parts[5],parts[6]].some(v=>/^(?:#{2,4} (?:Scenario:|Requirement:|ADDED Requirements)|- \*\*(?:WHEN|THEN)\*\*)/m.test(v)))throw Error('Ожидается один сценарий WHEN/THEN с названием требования: '+key);
        ops.push({op:'node',value:{id:node.id,name:parts[1],note:parts[3],attrs:{...node.attrs,when:parts[5],then:parts[6]}}});
      }else{
        const normalize=s=>s.replace(/^- \[[ xX]\]/gm,'- []');
        if(normalize(contents)!==normalize(expected[key]))throw Error('В tasks.md можно менять отметки выполнения');
        const marks=Array.from(contents.matchAll(/^- \[([ xX])\]/gm),x=>x[1].toLowerCase()==='x');
        entry.ids.forEach((id,i)=>{const old=M.head(doc).data.nodes.find(n=>n.id===id);if(marks[i]!== (old.state==='done'))ops.push({op:'node',value:{id,state:marks[i]?'done':'planned'}});});
      }
    }
    const data=ops.length?M.patch(M.head(doc).data,ops):M.head(doc).data;
    const workflow=typeof Delivery!=='undefined'?Delivery:require('./delivery.js');
    return {kind:'projection',project:m.project,base:m.base,data:ops.length?workflow.checkTasks(data):data};
  }
  return {coverage,document,bundle,context,readiness,packageFiles,openPackage,importPackage};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof JSZip!=='undefined'?JSZip:require('./vendor/jszip.js'));
if(typeof module!=='undefined')module.exports=Specifications;
