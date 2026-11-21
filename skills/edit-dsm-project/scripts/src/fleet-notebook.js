const FleetNotebook=(()=>{
  function cells(doc,id,code,md,context={}){
    const model=doc.history.at(-1).data,buy=id||model.nodes.find(n=>n.kind==='procurement')?.id;
    if(!buy)throw Error('В каталоге нет закупки');
    const raw=typeof FleetPythonSource==='string'?FleetPythonSource:require('node:fs').readFileSync(require('node:path').join(__dirname,'fleet-analysis.py'),'utf8');
    const chunks=Object.fromEntries(raw.split(/^# %% /m).slice(1).map(part=>{const i=part.indexOf('\n');return [part.slice(0,i).trim(),part.slice(i+1).trim()];}));
    const quote=v=>JSON.stringify(v);
    const history=doc.history.map((h,i)=>[i+1,h.rev,h.at,h.actor,h.note]);
    const params=['procurement_id = '+quote(buy),'variant_key = '+quote(context.option||'resilient'),'base_revision = '+quote(doc.history.at(-1).rev),
      'budget_rub = '+(context.budget??'None'),'group_by = "site"   # site, sku, cluster','failed_host = ""   # пусто — проверить каждый узел',
      'specification_requirement = ""  # ID для привязки новой Markdown-спецификации',
      'attached_files = []  # файлы, вложенные через форму DSM',
      'source_files = []  # [("catalog", "catalog.csv"), ("requirements", "requirements.csv"), ("specifications", "spec.md"), ("contracts", "contracts.csv")]',
      'archived_inventory = '+(context.inventory?JSON.stringify(context.inventory):'None'),
      'inventory_file = ""  # CSV/Excel: serial, pool, cpuCores, ramGiB, diskGiB',
      'attribute_edits = {}  # {ID_профиля: {"unitPriceRub": 320000}}','manual_order = '+(context.order?JSON.stringify(context.order):'None')+'  # {ID_строки_парка: количество}; variant_key = "manual"',
      'lifecycle = {"action":"record"}  # record, cluster, save, approve, implement',
      '# save: name, description, release; approve: plan, requirement, specification, context, alternatives, rationale, consequences, owner; implement: plan',
      '# cluster: layer = "flow" или "risk". Перед сохранением варианта запишите правки исходных параметров и обновите базу.',
      'export_directory = None  # например "fleet-report"','export_pdf = False','history_rows = '+quote(history)].join('\n');
    const labels={library:'Инструменты расчёта и вывода',sources:'Источники, контроль целостности и загрузка данных',topology:'Исходный парк, ограничения и нагрузки',solver:'Оптимизация состава и сравнение AS-IS / TO-BE',failures:'Моделирование отказов и перенос реплик',trace:'Кластеры, группировки, матрицы и архитектурные связи',decisions:'Дерево решений, ADR и история релиза',export:'Экспорт таблиц, исходников, графиков и PDF'};
    return [md('fleet-help','## Работа с закупкой\nСначала выполните все ячейки. В параметрах выберите закупку и вариант. Для загрузки файла в ядро используйте файловый браузер Jupyter, затем укажите файл в source_files. После редактирования параметров выполните блокнот с начала, включая исходную модель. Изменения попадут в DSM после предпросмотра.'),code('parameters',params),
      ...Object.entries(labels).flatMap(([key,title])=>[md('title-'+key,'## '+title),code('fleet-'+key,chunks[key])]),
      md('fleet-return','## Возврат в DSM\nСохраните выполненный ipynb и выберите «Проверить результат Python». Мастерская пересчитывает цену и каждое перемещение, сверяет версию и показывает изменяемые объекты.'),
      code('result','from IPython.display import display\nif choice["available"]:\n    lab = dict(root=procurement_id,key=variant_key,order=manual_order,budget=budget_rub,cost=choice["cost"],worst=choice["worst"],failures=[[s["site"],f["host"],f["unplaced"],f["moves"]] for s in choice["sites"] for f in s["failures"]],lifecycle=lifecycle,clusters=clusters,inventory=observations,inventory_source=inventory_source)\n    display({"application/vnd.mazzy.fleet+json":{"project":'+quote(doc.project)+',"base":base_revision,"data":model,"lab":lab},"text/plain":"Расчёт и операция готовы к предпросмотру DSM"},raw=True)\nelse: print("Сначала выберите доступный вариант")',['dsm-result'])];
  }
  async function attach(book,category,file,requirement=''){
    if(!file||!file.size||file.size>2*1024*1024)throw Error('Выберите файл до 2 МиБ');
    if(!['catalog','requirements','specifications','contracts','inventory'].includes(category))throw Error('Неизвестная категория');
    const params=book.cells.findIndex(c=>c.id==='parameters');
    if(params<0)throw Error('В блокноте нет параметров расчёта');
    const clean=NotebookFiles.clean(book),index=clean.cells.findIndex(c=>c.id==='attachments'),prefix='attached_files = ';
    const prev=index<0?[]:JSON.parse([clean.cells[index].source].flat().join('').slice(prefix.length));
    const raw=new Uint8Array(await file.arrayBuffer()),sha=await crypto.subtle.digest('SHA-256',raw);
    const entry={category,filename:file.name,requirement,content64:FleetSource.encode(raw),sha256:Array.from(new Uint8Array(sha),b=>b.toString(16).padStart(2,'0')).join('')};
    const rows=prev.filter(e=>e.category!==category||(category!=='inventory'&&e.filename!==file.name));
    const cell={id:'attachments',cell_type:'code',metadata:{tags:['dsm-sources']},execution_count:null,outputs:[],source:prefix+JSON.stringify([...rows,entry])};
    if(index<0)clean.cells.splice(params+1,0,cell);else clean.cells[index]=cell;
    return NotebookFiles.validate(clean);
  }
  return {cells,attach};
})();
if(typeof module!=='undefined')module.exports=FleetNotebook;
