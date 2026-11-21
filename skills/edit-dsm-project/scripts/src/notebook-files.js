/* Shared by the offline viewer, CLI and local Jupyter server. */
const NotebookFiles = (() => {
  const source = value => Array.isArray(value) ? value.join('') : value ?? '';
  const tagged = cell => cell.metadata?.tags?.includes('dsm-input');
  const copy = obj => JSON.parse(JSON.stringify(obj));
  function validate(book) {
    if(book?.nbformat!==4||!Number.isInteger(book.nbformat_minor)||book.nbformat_minor<0)throw Error('Поддерживаются блокноты Jupyter nbformat 4');
    if(!Array.isArray(book.cells)||!book.metadata||typeof book.metadata!=='object'||Array.isArray(book.metadata))throw Error('В блокноте нужны metadata и массив cells');
    const ids=new Set();
    for(const [i,c] of book.cells.entries()){
      const fail=text=>{throw Error('Ячейка '+(i+1)+' · '+text);};
      if(!c||!['code','markdown','raw'].includes(c.cell_type))fail('неизвестный тип');
      if(typeof c.source!=='string'&&!(Array.isArray(c.source)&&c.source.every(v=>typeof v==='string')))fail('источник должен быть текстом');
      if(!c.metadata||typeof c.metadata!=='object'||Array.isArray(c.metadata))fail('нужен объект metadata');
      if(c.metadata.tags&&(!Array.isArray(c.metadata.tags)||!c.metadata.tags.every(t=>typeof t==='string')))fail('неверный список тегов');
      if(book.nbformat_minor>=5&&(typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(c.id||'')||ids.has(c.id)))fail('нужен уникальный ID');
      ids.add(c.id);
      if(c.cell_type==='code'&&!Array.isArray(c.outputs))fail('нужен массив outputs');
      if(c.cell_type==='code'&&!(c.execution_count===null||Number.isInteger(c.execution_count)&&c.execution_count>=0))fail('неверный счётчик исполнения');
      if(c.cell_type==='code')for(const o of c.outputs){
        if(!o||!['stream','execute_result','display_data','error'].includes(o.output_type))fail('неверный тип результата');
        const multiline=x=>typeof x==='string'||Array.isArray(x)&&x.every(v=>typeof v==='string');
        if(o.output_type==='stream'&&(!['stdout','stderr'].includes(o.name)||!multiline(o.text)))fail('неверный поток вывода');
        if(o.output_type==='error'&&(typeof o.ename!=='string'||typeof o.evalue!=='string'||!Array.isArray(o.traceback)||!o.traceback.every(v=>typeof v==='string')))fail('неверный traceback');
        if(['execute_result','display_data'].includes(o.output_type)&&(!o.data||typeof o.data!=='object'||Array.isArray(o.data)||('text/plain' in o.data&&!multiline(o.data['text/plain']))))fail('неверные MIME-данные');
      }
    }
    return book;
  }
  function output(o){
    if(o.output_type==='stream')return source(o.text);
    if(o.output_type==='error')return [o.ename,o.evalue,...(o.traceback||[])].filter(Boolean).join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    return o.data?.['text/plain']!==undefined?source(o.data['text/plain']):'Форматы вывода · '+Object.keys(o.data||{}).join(', ');
  }
  function overview(book){
    validate(book);
    return book.cells.map((c,i)=>({i,type:c.cell_type,title:source(c.source).split(/\r?\n/).find(s=>s.trim())?.replace(/^#+\s*/,'').slice(0,110)||'Пустая ячейка',source:source(c.source),tags:c.metadata.tags||[],outputs:(c.outputs||[]).map(output),count:c.execution_count??null}));
  }
  function clean(book){
    const next=copy(validate(book));
    for(const c of next.cells)if(c.cell_type==='code'){c.outputs=[];c.execution_count=null;delete c.metadata.execution;delete c.metadata.trusted;}
    delete next.metadata.widgets;
    return next;
  }
  function fenced(text,language=''){
    const backtick=String.fromCharCode(96);
    let width=3;for(const match of text.matchAll(/`+/g))width=Math.max(width,match[0].length+1);
    const fence=backtick.repeat(width);
    return fence+language+'\n'+text+'\n'+fence;
  }
  function asMarkdown(book){
    return overview(book).map(c=>{
      if(c.type==='markdown')return c.source;
      return [fenced(c.source,c.type==='code'?(book.metadata.language_info?.name||''):'text'),...c.outputs.map(s=>fenced(s,'text'))].join('\n\n');
    }).join('\n\n')+'\n';
  }
  function asPython(book){
    validate(book);
    if(!isPython(book))throw Error('Экспорт .py требует блокнота Python');
    return book.cells.map(c=>c.cell_type==='code'?'# %%\n'+source(c.source):'# %% ['+c.cell_type+']\n'+source(c.source).split('\n').map(l=>'# '+l).join('\n')).join('\n\n')+'\n';
  }
  function isPython(book){return /^python/i.test(book.metadata.language_info?.name||book.metadata.kernelspec?.language||book.metadata.kernelspec?.name||'python');}
  function attach(book,generated){
    const next=copy(validate(book));
    if(!isPython(next))throw Error('Ячейка модели рассчитана на Python');
    if(next.metadata.dsm||next.cells.some(c=>tagged(c)||c.metadata.tags?.includes('dsm-result')))throw Error('Блокнот уже содержит привязку DSM. Сверьте его исходную ревизию.');
    const ids=new Set(next.cells.map(c=>c.id));
    function fresh(original){
      const cell=copy(original);
      if(next.nbformat_minor<5){delete cell.id;return cell;}
      while(ids.has(cell.id))cell.id='dsm-'+globalThis.crypto.randomUUID();
      ids.add(cell.id);return cell;
    }
    next.cells.unshift(fresh(generated.cells.find(tagged)));
    next.cells.push(fresh(generated.cells.find(c=>c.metadata.tags?.includes('dsm-result'))));
    if(!next.metadata.kernelspec)next.metadata.kernelspec=copy(generated.metadata.kernelspec);
    next.metadata.dsm=copy(generated.metadata.dsm);
    return next;
  }
  return {validate,source,tagged,output,overview,clean,asPython,asMarkdown,attach,isPython};
})();
if(typeof module!=='undefined')module.exports=NotebookFiles;
