function notebookPanel({doc,online,visible,render,proposed,modal,download,button,option,esc,toast}) {
  let selected=null,name='',profile='full',query='',kind='',onlyOutputs=false;
  let session=null,starting=false,error='',library=null,generation=0,loading='',selection=0;
  const host=()=>document.getElementById('notebookHost');
  const limit=16*1024*1024;
  const action=(id,label,attr='')=>button('book'+id,label,attr);
  function save(filename,value,type='application/x-ipynb+json'){
    download(filename,typeof value==='string'?value:JSON.stringify(value,null,2),type);
  }
  async function request(route,body){
    const response=await fetch('/api/notebooks/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const value=await response.json();
    if(!response.ok)throw Error(value.error||'Не удалось связаться с Jupyter');
    return value;
  }
  function reset(){
    selected=null;name='';library=null;error='';query='';kind='';onlyOutputs=false;generation++;selection++;loading='';
  }
  async function refresh(){
    if(!online())return;
    const ticket=++generation;
    try{const items=await request('list');if(ticket!==generation)return;library=items;}
    catch(e){if(ticket!==generation)return;error=e.message;}
    if(visible())render();
  }
  function choose(book,label){
    selected=NotebookFiles.validate(book);name=label;query='';kind='';onlyOutputs=false;error='';
    render();
  }
  async function loadBook(label,reader){
    const ticket=++selection;loading=label;error='';render();
    try{
      const book=await reader();
      if(ticket===selection){loading='';choose(book,label);}
    }catch(e){if(ticket===selection){loading='';error='Загрузка '+label+' · '+e.message;render();}}
  }
  async function upload(file){
    if(!file)return;
    await loadBook(file.name,async()=>{
      if(!/\.ipynb$/i.test(file.name))throw Error('Выберите файл .ipynb');
      if(file.size>limit)throw Error('Размер файла превышает 16 МиБ');
      return JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    });
  }
  function richOutput(output,summary){
    const mime=output.data||{},asText=NotebookFiles.source;
    if(mime['image/svg+xml']||mime['image/png']){
      const src=mime['image/svg+xml']?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(asText(mime['image/svg+xml'])):'data:image/png;base64,'+asText(mime['image/png']);
      return '<img class="book-chart" alt="График вычислений Jupyter" src="'+esc(src)+'">';
    }
    if(mime['text/html']){
      const template=document.createElement('template');template.innerHTML=asText(mime['text/html']);
      const table=template.content.querySelector('table');
      if(table){
        const rows=Array.from(table.rows).slice(0,100).map(row=>'<tr>'+Array.from(row.cells).slice(0,40).map(cell=>'<td>'+esc(cell.textContent)+'</td>').join('')+'</tr>');
        return '<div class="wrap"><table class="table">'+rows.join('')+'</table></div>'+(table.rows.length>100||Array.from(table.rows).some(r=>r.cells.length>40)?'<p>Показаны первые 100 строк и 40 столбцов.</p>':'');
      }
    }
    return '<pre class="cell-output">'+esc(summary)+'</pre>';
  }
  function cells(){
    if(!selected)return '';
    const rows=NotebookFiles.overview(selected).filter(c=>(!kind||kind===c.type)&&(!onlyOutputs||c.outputs.length)&&[c.source,...c.tags,...c.outputs].join(' ').toLowerCase().includes(query.toLowerCase()));
    return '<p>'+rows.length+' из '+selected.cells.length+' ячеек</p>'+rows.map(c=>'<details class="cell-preview"><summary><code>'+(c.i+1)+'</code> '+esc(c.type)+' · '+esc(c.title)+'</summary><pre>'+esc(c.source)+'</pre>'+
      (c.tags.length?'<p>Теги · '+esc(c.tags.join(', '))+'</p>':'')+(c.count===null?'':'<p>Порядок исполнения · '+c.count+'</p>')+
      c.outputs.map((out,i)=>richOutput(selected.cells[c.i].outputs[i],out)).join('')+'</details>').join('');
  }
  function viewer(){
    if(!selected)return '';
    const meta=selected.metadata.dsm, h=DSM.head(doc());
    const status=!meta?'Обычный блокнот':meta.project!==doc().project?'Другой проект':meta.base===h.rev?'Текущая ревизия':'Устаревшая ревизия';
    return '<section class="card"><div class="cardhead"><div><h3>'+esc(name)+'</h3><p>'+status+' · '+esc(selected.metadata.kernelspec?.display_name||'Ядро не указано')+(meta?' · '+esc(meta.base):'')+'</p></div>'+action('Clear','Закрыть просмотр')+'</div><div class="tools">'+
      (meta?action('Import','Предпросмотр модели'):action('Attach','Привязать модель',NotebookFiles.isPython(selected)?'':'disabled'))+
      (selected.cells.some(c=>c.metadata.tags?.includes('dsm-result'))?action('Result','Проверить результат Python'):'')+action('Download','Скачать .ipynb')+action('Clean','Без выводов')+action('Markdown','Отчёт .md')+action('Python','Скрипт .py',NotebookFiles.isPython(selected)?'':'disabled')+'</div>'+
      '<div class="tools"><input id="bookQuery" type="search" aria-label="Найти в ячейках" placeholder="Текст, тег или вывод" value="'+esc(query)+'"><select id="bookKind" aria-label="Тип ячейки">'+[['','Все ячейки'],['code','Код'],['markdown','Markdown'],['raw','Raw']].map(([k,v])=>option(k,v,kind)).join('')+'</select><label><input id="bookOutputs" type="checkbox" '+(onlyOutputs?'checked':'')+'> С выводами</label></div><div id="bookCells">'+cells()+'</div></section>';
  }
  function shelf(){
    if(!online())return '';
    const content=library?.length?library.map(item=>'<div class="file-item"><span>'+esc(item.name)+'<small>'+esc(new Date(item.updated).toLocaleString('ru-RU'))+' · '+Math.ceil(item.bytes/1024)+' КиБ</small></span>'+action('Recall','Открыть копию','data-id="'+esc(item.id)+'"')+'</div>').join(''):'<p>Сохранённые сессии появятся здесь.</p>';
    return '<details class="card"><summary>Библиотека проекта'+(library?' · '+library.length:'')+'</summary>'+content+action('Refresh','Обновить список')+'</details>';
  }
  function view(){
    const profiles={full:'Полный анализ DSM',installation:'Закупка и приёмка серверов',...Object.fromEntries(Object.entries(NotebookProfiles).map(([k,v])=>[k,v.name]))};
    const controls=session?'<p>Сохраните ячейки в Jupyter (Ctrl+S). Файл · '+esc(session.file)+'</p><div class="tools">'+action('Preview','Проверить изменения','class="primary"')+action('LiveResult','Проверить результат Python')+action('Saved','Скачать сохранённый блокнот')+action('Stop','Завершить сессию')+'</div>':
      '<div class="tools"><label>Расчёт <select id="bookProfile" aria-label="Профиль генерации">'+Object.entries(profiles).map(([k,v])=>option(k,v,profile)).join('')+'</select></label>'+action('Generate','Сгенерировать блокнот')+
      '<label class="btn">Загрузить .ipynb<input type="file" class="file-picker" id="bookFile" accept=".ipynb"></label>'+
      (online()?action('Start',starting?'Запуск…':'Запустить Jupyter',starting?'disabled':'class="primary"'):'')+'</div>'+
      (selected&&online()?'<p>Для запуска выбран файл '+esc(name)+'.</p>':!online()?'<p>Для вычислений запустите локальную мастерскую с Jupyter. Подготовка и просмотр файлов доступны здесь.</p>':'');
    return '<fieldset class="book-controls" '+(loading||starting?'disabled':'')+'><div class="stack">'+(loading?'<p role="status">Чтение · '+esc(loading)+'</p>':'')+'<article class="card" id="bookDrop"><h2>Jupyter Notebook</h2>'+controls+(error?'<p role="alert">'+esc(error)+'</p>':'')+'</article>'+(session?'':viewer()+shelf())+'</div></fieldset>';
  }
  async function handle(which,id){
    switch(which){
      case 'Generate':choose(Notebook.write(doc(),profile),'dsm-'+profile+'-'+DSM.head(doc()).rev.slice(0,8)+'.ipynb');break;
      case 'Clear':selected=null;name='';render();break;
      case 'Attach':choose(NotebookFiles.attach(selected,Notebook.write(doc(),profile)),name);break;
      case 'Import':proposed(Notebook.read(selected),name);break;
      case 'Download':save(name,selected);break;
      case 'Clean':save(name.replace(/\.ipynb$/i,'')+'-clean.ipynb',NotebookFiles.clean(selected));break;
      case 'Python':save(name.replace(/\.ipynb$/i,'')+'.py',NotebookFiles.asPython(selected),'text/x-python');break;
      case 'Markdown':save(name.replace(/\.ipynb$/i,'')+'.md',NotebookFiles.asMarkdown(selected),'text/markdown');break;
      case 'Recall':await loadBook(library.find(s=>s.id===id)?.name||'architecture.ipynb',()=>request('download/'+id));break;
      case 'Refresh':await refresh();break;
      case 'Start':
        if(starting||session)return;
        starting=true;error='';render();
        try{
          session=await request('start',selected?{book:selected,name}:{profile});
          const frame=document.createElement('iframe');frame.title='Jupyter Notebook';frame.src=session.url;host().replaceChildren(frame);
        }catch(e){error=e.message;}finally{starting=false;render();}
        break;
      case 'Result':proposed(Notebook.result(selected),name+' · Python');break;
      case 'LiveResult':proposed(Notebook.result(await request('download/'+session.id)),session.name+' · Python');break;
      case 'Preview':proposed(await request('read/'+session.id),session.name);break;
      case 'Saved':save(session.name,await request('download/'+session.id));break;
      case 'Stop':modal('Завершить сессию Jupyter','<p>Сохраните ячейки в Jupyter. Файл останется в библиотеке проекта.</p>',async()=>{
        await request('stop/'+session.id);session=null;host().replaceChildren();await refresh();
      },'Завершить');break;
    }
  }
  function bind(){
    const el=id=>document.getElementById(id);
    if(el('bookProfile'))el('bookProfile').onchange=e=>{profile=e.target.value;};
    if(el('bookFile'))el('bookFile').onchange=e=>upload(e.target.files[0]);
    if(el('bookDrop')&&!session){
      el('bookDrop').ondragover=e=>e.preventDefault();
      el('bookDrop').ondrop=e=>{e.preventDefault();upload(e.dataTransfer.files[0]);};
    }
    if(!el('bookQuery'))return;
    const redraw=()=>{el('bookCells').innerHTML=cells();};
    el('bookQuery').oninput=e=>{query=e.target.value;redraw();};
    el('bookKind').onchange=e=>{kind=e.target.value;redraw();};
    el('bookOutputs').onchange=e=>{onlyOutputs=e.target.checked;redraw();};
  }
  window.addEventListener('pagehide',ev=>{if(session&&!ev.persisted)fetch('/api/notebooks/stop/'+session.id,{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true}).catch(()=>{});});
  function installation(id,context){
    if(session||starting)throw Error('Сохраните и завершите текущую сессию Jupyter перед открытием другого блокнота');
    profile='installation';
    choose(Notebook.write(doc(),profile,id,context),'installation-'+id+'.ipynb');
  }
  function replay(id){
    if(session||starting)throw Error('Сохраните и завершите текущую сессию Jupyter');
    choose(Notebook.replayInstallation(doc(),id),'acceptance-'+id+'.ipynb');
  }
  return {view,handle,bind,refresh,reset,installation,replay,active:()=>!!session};
}
