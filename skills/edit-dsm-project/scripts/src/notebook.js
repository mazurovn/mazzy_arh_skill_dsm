const Notebook=((M,A,F)=>{
  const code=(id,source,tags=[])=>({id,cell_type:'code',metadata:{tags},execution_count:null,outputs:[],source});
  const md=(id,source)=>({id,cell_type:'markdown',metadata:{},source});
  const pre='null = None\ntrue = True\nfalse = False\nmodel = ';
  function write(doc){
    const h=M.head(doc),meta=F.meta(doc);
    const initial=Object.fromEntries(['flow','risk'].map(l=>[l,A.calculate(h.data,l)]));
    const cells=[
      md('intro','# '+h.data.title+'\n\nМастерская DSM · mazzy (mazurovn)\n\nСнимок '+h.rev+' · '+h.at+'. Измените каталог в следующей ячейке, пересчитайте блокнот и импортируйте сохранённый .ipynb в редактор. Импорт использует только данные ячейки dsm-input.'),
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
    return {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'},language_info:{name:'python'},dsm:meta},cells};
  }
  function read(book){
    const cells=book.cells?.filter(c=>c.metadata?.tags?.includes('dsm-input'));if(cells?.length!==1||!book.metadata?.dsm)throw Error('Нужна одна ячейка dsm-input в блокноте редактора');
    const raw=cells[0].source,s=Array.isArray(raw)?raw.join(''):raw;
    if(!s.startsWith(pre))throw Error('Сохраните префикс model = в ячейке исходных данных');
    return {...book.metadata.dsm,kind:'projection',data:M.validate(JSON.parse(s.slice(pre.length)))};
  }
  return {write,read};
})(typeof DSM!=='undefined'?DSM:require('./model.js'),typeof Analysis!=='undefined'?Analysis:require('./analysis.js'),typeof Formats!=='undefined'?Formats:require('./formats.js'));
if(typeof module!=='undefined')module.exports=Notebook;
