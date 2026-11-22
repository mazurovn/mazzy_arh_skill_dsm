const Notebook=((M,A,F,Files,Profiles)=>{
  const code=(id,source,tags=[])=>({id,cell_type:'code',metadata:{tags},execution_count:null,outputs:[],source});
  const md=(id,source)=>({id,cell_type:'markdown',metadata:{},source});
  const pre='null = None\ntrue = True\nfalse = False\nmodel = ';
  function write(doc,profile='full',installation,context){
    if(profile!=='full'&&profile!=='machine'&&profile!=='installation'&&profile!=='fleet'&&!Object.hasOwn(Profiles,profile))throw Error('Неизвестный профиль блокнота');
    const h=M.head(doc),meta=F.meta(doc);
    const initial=profile==='full'?Object.fromEntries(['flow','risk'].map(l=>[l,A.calculate(h.data,l)])):{};
    const cells=[
      md('intro','# '+h.data.title+'\n\nМастерская DSM · mazzy (mazurovn)\n\nСнимок '+h.rev+' · '+h.at+'. Измените каталог в следующей ячейке, пересчитайте блокнот и импортируйте сохранённый .ipynb в редактор. Предпросмотр модели читает dsm-input. Для возврата вычисленного model выполните ячейку dsm-result.'),
      code('input',pre+JSON.stringify(h.data,null,2),['dsm-input']),
      md('matrix-title','## Два слоя зависимостей\nВ строке расположен потребитель контракта. Вес симметричной связи учитывается один раз. Числа в ячейках пересчитываются при выполнении.'),
      code('matrix',[
        'from collections import Counter','from html import escape','from itertools import combinations','import json',
        'ids = [n["id"] for n in model["nodes"]]','assert len(ids) == len(set(ids))','pos = {v:i for i,v in enumerate(ids)}',
        'def matrix(layer, order):','    index = {n:i for i,n in enumerate(order)}','    rows = [[0]*len(order) for _ in order]','    for e in model["edges"]:','        if e["layer"] != layer: continue','        i,j = index[e["from"]],index[e["to"]]','        assert i != j and not rows[i][j] and type(e["weight"]) == int and e["weight"] > 0','        rows[i][j] = e["weight"]','        if layer == "risk": rows[j][i] = e["weight"]','    return rows',
        'def table(headers, rows):','    try:','        from IPython.display import display, HTML','        tr = lambda cells, tag: "<tr>"+"".join("<{0}>{1}</{0}>".format(tag,escape(str(v))) for v in cells)+"</tr>"','        display(HTML("<table>"+tr(headers,"th")+"".join(tr(r,"td") for r in rows)+"</table>"))','    except ImportError:','        print(headers, *rows, sep="\\n")',
        'for layer in ("flow","risk"):','    print(layer)','    table(["ID"] + ids, [[n] + r for n,r in zip(ids, matrix(layer,ids))])'].join('\n')),
      md('group-title','## Кластеры и цена изменения\nЖадно объединяем группы при положительном приросте модулярности. Сравниваем вес межгрупповых связей и взвешенную длину размещения. Вариант порядка, сохранённый редактором, служит базой сравнения. При новом наборе ID нужно снова экспортировать порядок из редактора.'),
      code('group',[
        'reference = '+JSON.stringify(Object.fromEntries(Object.entries(initial).map(([l,x])=>[l,x.order]))),
        'def analyze(layer, strong=3):','    weights = Counter()','    for e in model["edges"]:','        if e["layer"] == layer:','            w = strong if layer == "risk" and e["weight"] == 3 else e["weight"]','            weights[tuple(sorted((e["from"],e["to"])))] += w',
        '    total = sum(weights.values())','    deg = Counter()','    for (a,b),w in weights.items(): deg[a] += w; deg[b] += w','    groups = [[n] for n in ids]',
        '    while total:','        membership = {n:i for i,g in enumerate(groups) for n in g}','        mass = [sum(deg[n] for n in g) for g in groups]','        cuts = Counter()','        for (a,b),w in weights.items():','            i,j = sorted([membership[a],membership[b]])','            if i != j: cuts[i,j] += w','        best, pair = 0, None','        for (i,j),w in sorted(cuts.items()):','            gain = w/total - mass[i]*mass[j]/(2*total**2)','            if gain > best + 1e-12: best, pair = gain,(i,j)','        if pair is None: break','        i,j = pair','        groups = [g for k,g in enumerate(groups) if k not in pair]+[groups[i]+groups[j]]',
        '    membership = {n:i for i,g in enumerate(groups) for n in g}','    cross = sum(w for (a,b),w in weights.items() if membership[a]!=membership[b])','    def distance(order):','        if set(order) != set(ids): return None','        p = {v:i for i,v in enumerate(order)}','        return sum(w*abs(p[a]-p[b]) for (a,b),w in weights.items())','    return groups, cross, distance(ids), distance(reference[layer])',
        'for layer in ("flow","risk"):','    groups,cross,before,ref = analyze(layer)','    print(layer, "группы", groups, "межгрупповой вес", cross, "L исходный / базовый порядок", before, ref)'].join('\n')),
      md('sensitivity-title','## Чувствительность разбиения\nИзмените вес сильной совместной проверки. Коэффициент Жаккара сравнивает пары узлов, оказавшиеся в одной группе в двух вариантах.'),
      code('sensitivity','strong_weight = 5\npairs = lambda groups: {tuple(sorted(p)) for group in groups for p in combinations(group, 2)}\na = pairs(analyze("risk")[0])\nb = pairs(analyze("risk",strong_weight)[0])\nprint("Jaccard", len(a & b)/len(a | b) if a | b else 1, "изменившиеся пары", sorted(a ^ b))'),
      md('release-title','## План релизов\nОценки указаны в условных единицах работы. Пустая оценка увеличивает число неизвестных. Внешние вызовы показывают точки координации с другими работами.'),
      code('release','rows=[]\nfor r in model["nodes"]:\n    if r["kind"] != "release": continue\n    assigned = [n for n in model["nodes"] if n.get("release")==r["id"]]\n    members={n["id"] for n in assigned}\n    known=sum(n["effort"] for n in assigned if n.get("effort") is not None)\n    unknown=sum(n.get("effort") is None for n in assigned)\n    outside=sum(e["layer"]=="flow" and e["from"] in members and e["to"] not in members for e in model["edges"])\n    rows.append([r["id"],len(assigned),known,unknown,r.get("capacity"),outside])\ntable(["Релиз","Работы","Оценено","Без оценки","Ёмкость","Внешние вызовы"],rows)'),
      md('handoff','## Возврат в редактор\nСохраните блокнот и выберите его в разделе «Обмен». Просмотрите разницу и сохраните новую версию. Если после экспорта агент уже изменил проект, откройте актуальный JSON и перенесите нужные изменения через патч.')
    ];
    if(profile==='machine'){
      const lab=typeof MachineBook!=='undefined'?MachineBook:require('./machine-notebook.js');
      cells.splice(2,cells.length-2,...lab.cells(doc,installation,code,md,context));meta.profile=profile;
    }else if(profile==='fleet'){
      const lab=typeof FleetNotebook!=='undefined'?FleetNotebook:require('./fleet-notebook.js');
      cells.splice(2,cells.length-2,...lab.cells(doc,installation,code,md,context));meta.profile=profile;
    }else if(profile==='installation'){
      const report=typeof InstallationNotebook!=='undefined'?InstallationNotebook:require('./installation-notebook.js');
      cells.splice(2,cells.length-2,...report.write(doc,installation,code,md,context));meta.profile=profile;
    }else if(profile!=='full'){
      const spec=Profiles[profile];
      cells.splice(2,cells.length-3,md('report-title','## '+spec.name+'\n'+spec.caption),code('report',spec.python));
      meta.profile=profile;
    }
    if(profile!=='machine'&&profile!=='installation'&&profile!=='fleet')cells.push(md('result-help','## Передать результат вычислений в DSM\nВыполните эту ячейку после своих изменений model и сохраните блокнот. В редакторе выберите «Проверить результат Python».'),
      code('result',"from IPython.display import display\n"+'display({"application/vnd.mazzy.dsm+json": {"project": '+JSON.stringify(doc.project)+', "base": '+JSON.stringify(h.rev)+', "data": model}, "text/plain": "Модель подготовлена для DSM"}, raw=True)',['dsm-result']));
    return {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python'},dsm:meta},cells};
  }
  function read(book){
    Files.validate(book);
    const cells=book.cells.filter(Files.tagged);if(cells?.length!==1||!book.metadata?.dsm)throw Error('Нужна одна ячейка dsm-input в блокноте редактора');
    if(cells[0].cell_type!=='code')throw Error('dsm-input должна быть ячейкой кода');
    if(!M.idOK(book.metadata.dsm.project)||!M.idOK(book.metadata.dsm.base))throw Error('Некорректные project или base в метаданных блокнота');
    const s=Files.source(cells[0].source).replace(/\r\n/g,'\n');
    if(!s.startsWith(pre))throw Error('Сохраните префикс model = в ячейке исходных данных');
    return {...book.metadata.dsm,kind:'projection',data:M.validate(JSON.parse(s.slice(pre.length)))};
  }
  function result(book){
    Files.validate(book);
    const cells=book.cells.filter(c=>c.cell_type==='code'&&c.metadata.tags?.includes('dsm-result'));
    if(book.metadata?.dsm?.profile==='machine'){
      const payloads=cells.flatMap(c=>c.outputs.map(o=>o.data?.['application/vnd.mazzy.machine+json']).filter(Boolean));
      const v=payloads[0],meta=book.metadata.dsm;
      if(cells.length!==1||payloads.length!==1||v.base!==meta.base||v.project!==meta.project)throw Error('Выполните расчёт изделия и сохраните блокнот с текущей базой');
      return {...v,kind:'machine-receipt'};
    }
    if(book.metadata?.dsm?.profile==='fleet'){
      const outputs=cells.flatMap(c=>c.outputs.map(o=>o.data?.['application/vnd.mazzy.fleet+json']).filter(Boolean));
      if(cells.length!==1||outputs.length!==1)throw Error('Выполните расчёт парка и сохраните блокнот');
      const v=outputs[0],meta=book.metadata.dsm;
      if(v.base!==meta.base||v.project!==meta.project)throw Error('Другая база результата');
      return {...v,kind:'fleet-result'};
    }
    if(book.metadata?.dsm?.profile==='installation'){
      const meta=book.metadata.dsm;
      const outputs=cells.flatMap(c=>c.outputs.map(o=>o.data?.['application/vnd.mazzy.installation+json']).filter(Boolean));
      if(cells.length!==1||outputs.length!==1)throw Error('Для приёмки заполните inventory, выполните ячейки и сохраните блокнот');
      const v=outputs[0];
      if(!M.idOK(meta.project)||!M.idOK(meta.base)||v.project!==meta.project||v.base!==meta.base)throw Error('Другая база результата Jupyter');
      return {kind:'installation-receipt',project:v.project,base:v.base,observation:v.observation};
    }
    const payloads=cells.flatMap(c=>c.outputs.map(o=>o.data?.['application/vnd.mazzy.dsm+json']).filter(Boolean));
    if(cells.length!==1||payloads.length!==1)throw Error('Выполните одну ячейку dsm-result и сохраните её вывод');
    const value=payloads[0],meta=book.metadata.dsm;
    if(!meta||!M.idOK(meta.base)||!M.idOK(meta.project)||value.project!==meta.project||value.base!==meta.base)throw Error('Результат вычислений относится к другой базе');
    return {kind:'projection',project:value.project,base:value.base,data:M.validate(value.data)};
  }
  function replayInstallation(doc,id){
    const node=M.head(doc).data.nodes.find(n=>n.id===id&&n.attrs?.source==='Jupyter'&&n.attrs.verification);
    if(!node)throw Error('Выберите проверку инсталляции из Jupyter');
    const i=doc.history.findIndex(h=>h.rev===node.attrs.base);
    if(i<0)throw Error('В проекте отсутствует исходная ревизия измерения');
    const snapshot={...doc,history:doc.history.slice(0,i+1)},nodes=M.head(snapshot).data.nodes;
    const proposal=nodes.find(n=>n.kind==='proposal'&&node.refs?.includes(n.id)&&n.attrs?.appliedObject&&node.refs.includes(n.attrs.appliedObject));
    const requirement=node.relations?.find(([k])=>k==='verifies')?.[1];
    if(!proposal||!requirement)throw Error('Нужны исходное предложение и требование проверки');
    const book=write(snapshot,'installation',proposal.attrs.appliedObject,{proposal:proposal.id,requirement});
    const rows=JSON.parse(node.attrs.inventory).map(n=>({id:n.id,cpuCores:n.values[0],ramGiB:n.values[1],diskGiB:n.values[2]}));
    const literals={environment:node.attrs.environment,actor:node.attrs.owner,source:node.attrs.evidenceSource||node.note.split(' · соответствуют профилю ')[0],inventory:rows};
    book.cells.find(c=>c.id==='measured').source=Object.entries(literals).map(([key,v])=>key+' = '+JSON.stringify(v,null,2)).join('\n');
    return book;
  }
  function replayFleet(doc,id){
    const i=doc.history.findIndex(h=>h.data.nodes.some(n=>n.id===id&&n.attrs?.fleetRole==='simulation'));
    if(i<0)throw Error('Проверка отсутствует в истории');
    const snap={...doc,history:doc.history.slice(0,i+1)},n=M.head(snap).data.nodes.find(n=>n.id===id);
    return write(snap,'fleet',n.parent,{option:n.attrs.option,budget:n.attrs.budget,inventory:n.attrs.inventoryFile?{filename:n.attrs.inventoryFile,sha256:n.attrs.inventoryHash,content64:n.attrs.content64}:null,order:n.attrs.option==='manual'?Object.assign({},...JSON.parse(n.attrs.order)):null});
  }
  return {write,read,result,replayInstallation,replayFleet};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Analysis!=='undefined'?Analysis:require('./analysis.js'),typeof Formats!=='undefined'?Formats:require('./formats.js'),typeof NotebookFiles!=='undefined'?NotebookFiles:require('./notebook-files.js'),typeof NotebookProfiles!=='undefined'?NotebookProfiles:require('./notebook-profiles.js'));
if(typeof module!=='undefined')module.exports=Notebook;
