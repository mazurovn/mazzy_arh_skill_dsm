# %% library
from collections import Counter, defaultdict
from copy import deepcopy
from itertools import product
from pathlib import Path
from html import escape
from IPython.display import HTML, SVG, display
import base64, csv, hashlib, io, json, re, zipfile

KEYS = ("cpuCores", "ramGiB", "diskGiB")
tables, charts = {}, {}
def table(title, columns, rows):
    rows = list(rows)
    def row(values, tag):
        return "<tr>"+"".join("<"+tag+">"+escape(str(v))+"</"+tag+">" for v in values)+"</tr>"
    html = "<table>"+row(columns,"th")+"".join(row(r,"td") for r in rows)+"</table>"
    tables[title] = (columns, rows, html)
    display(HTML("<h4>"+escape(title)+"</h4>"+html))

def bars(title, entries, unit):
    entries = list(entries)
    high = max([1]+[v for _,v in entries])
    pieces = [f'<svg xmlns="http://www.w3.org/2000/svg" width="790" height="{35+30*len(entries)}"><title>{escape(title)}</title><text x="4" y="18">{escape(title)}</text>']
    for i,(label,v) in enumerate(entries):
        y=40+i*30
        pieces.append(f'<text x="4" y="{y}">{escape(str(label))}</text><rect x="265" y="{y-13}" width="{290*v/high}" height="15" fill="#246f63"/><text x="570" y="{y}">{v:,} {escape(unit)}</text>')
    charts[title]="".join(pieces)+"</svg>"
    display(SVG(charts[title]))

def related(n, kind):
    return [t for k,t in n.get("relations",[]) if k==kind]

def records():
    return {n["id"]:n for n in model["nodes"]}

def whole(v, name, minimum=0):
    if type(v) is not int or v < minimum:
        raise ValueError(f"{name}: нужно целое число от {minimum}")
    return v

# %% sources
def checked_sources():
    result={}
    for n in model['nodes']:
        a=n.get('attrs',{})
        if a.get('fleetRole')!='source' or n.get('parent')!=procurement_id: continue
        raw=base64.b64decode(a['content64'],validate=True)
        if len(raw)!=a['bytes'] or hashlib.sha256(raw).hexdigest()!=a['sha256']:
            raise ValueError("Нарушена контрольная сумма "+n['id'])
        result[n['id']]=(n,raw)
    return result

def scalar(v):
    if not isinstance(v,str): return v
    if v in ('true','false'): return v=='true'
    if re.fullmatch(r'-?(0|[1-9][0-9]*)(\.[0-9]+)?',v): return float(v) if '.' in v else int(v)
    return v

def input_tables(name, raw):
    if name.lower().endswith('.xlsx'):
        try: import openpyxl
        except ImportError as error: raise ImportError("Для чтения нового Excel в ядре установите openpyxl. Каталог из снимка доступен без этой зависимости.") from error
        workbook=openpyxl.load_workbook(io.BytesIO(raw),read_only=True,data_only=False)
        for sheet in workbook:
            data=iter(sheet.values);header=next(data,())
            if any(str(v).startswith('=') for v in header): raise ValueError("Сохраните значения исходного Excel")
            for cells in data:
                if any(isinstance(v,str) and v.startswith('=') for v in cells): raise ValueError("В исходном Excel нужны значения вместо формул")
                if any(v is not None for v in cells): yield dict(zip(header,cells))
    else:
        content=raw.decode('utf-8-sig')
        dialect=csv.Sniffer().sniff(content.splitlines()[0],delimiters=',;\t')
        yield from csv.DictReader(io.StringIO(content),dialect=dialect)

def import_source(category, path, content=None, requirement=''):
    if category not in ('catalog','requirements','specifications','contracts'):raise ValueError("Неизвестный тип источника "+category)
    path=Path(path)
    if path.suffix.lower() not in ('.csv','.tsv','.xlsx') and not (category=='specifications' and path.suffix.lower()=='.md'):raise ValueError("Недопустимый формат "+path.name)
    raw=path.read_bytes() if content is None else content
    if len(raw)>2*1024*1024 or not raw: raise ValueError("Источник должен иметь размер от 1 байта до 2 МиБ")
    by=records(); touched=set()
    if path.suffix.lower()=='.md' and category=='specifications':
        body=raw.decode('utf-8-sig')
        old=next((n for n in by.values() if n.get('attrs',{}).get('filename')==path.name and procurement_id in n.get('refs',[]) and n.get('attrs',{}).get('fleetRole')=='specification'),None)
        rows=[dict(id=old['id'] if old else new_id(by,'SPEC'),name=body.splitlines()[0].lstrip('# '),note=body,attrs={'filename':path.name})]
    else: rows=list(input_tables(path.name,raw))
    links=[]
    for row in rows:
        row={k:v for k,v in row.items() if k is not None and v is not None and v!=''}
        if 'from' in row and 'to' in row:
            links.append(row);continue
        ident=row.get('id')
        if not ident or not row.get('name'): raise ValueError("Нужны id и name")
        n=deepcopy(by.get(ident,{'id':ident,'name':row['name'],'kind':'component'}))
        for k in ('name','kind','parent','release','state','note','segment','bundle'):
            if k in row:n[k]=row[k]
        for k in ('refs','relations','steps','attrs'):
            if k in row:n[k]=json.loads(row[k]) if isinstance(row[k],str) else row[k]
        for k in ('effort','capacity'):
            if k in row:n[k]=float(row[k])
        for k,v in row.items():
            if k.startswith('attr.'):n.setdefault('attrs',{})[k[5:]]=scalar(v)
        if category in ('requirements','specifications'):
            expected='requirement' if category=='requirements' else 'artifact'
            if ident in by and by[ident]['kind']!=expected:raise ValueError("Конфликт типа "+ident)
            n['kind']=expected;n['refs']=list(dict.fromkeys(n.get('refs',[])+[procurement_id]))
            if category=='specifications':
                n.setdefault('attrs',{})['fleetRole']='specification'
                if requirement:
                    req=by.get(requirement,{})
                    if req.get('kind')!='requirement' or procurement_id not in req.get('refs',[]):raise ValueError("Требование другой закупки")
                    n['refs']=list(dict.fromkeys(n['refs']+[requirement]))
        by[ident]=n;touched.add(ident)
    for row in links:
        a,b=row['from'],row['to'];k=row.get('relation',row.get('layer','flow'))
        if a not in by or b not in by:raise ValueError("Неизвестный конец связи "+a+" / "+b)
        touched.update((a,b))
        if k in ('flow','risk'):
            def match(e):return e['layer']==k and ((e['from'],e['to'])==(a,b) or k=='risk' and (e['from'],e['to'])==(b,a))
            e={'layer':k,'from':a,'to':b,'weight':whole(int(row.get('weight',1)),'weight',1),'reason':row['reason']}
            prior=next((x for x in model['edges'] if match(x)),None)
            if prior is None:model['edges'].append(e)
            else:prior.update(e)
        elif k=='parent':by[b]['parent']=a
        elif k=='release':by[a]['release']=b
        elif k=='ref':by[a]['refs']=list(dict.fromkeys(by[a].get('refs',[])+[b]))
        elif [k,b] not in by[a].setdefault('relations',[]):by[a]['relations'].append([k,b])
    old=next((n for n in by.values() if n.get('attrs',{}).get('fleetRole')=='source' and n.get('parent')==procurement_id and n['attrs'].get('category')==category and n['attrs'].get('filename')==path.name),None)
    ident=old['id'] if old else new_id(by,'SOURCE')
    by[ident]={'id':ident,'name':path.name,'kind':'artifact','parent':procurement_id,'note':'Исходный документ · '+category,'refs':sorted(touched|{procurement_id}),
               'attrs':dict(fleetRole='source',filename=path.name,category=category,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),content64=base64.b64encode(raw).decode())}
    model['nodes']=list(by.values())

def new_id(by,prefix):
    n=1
    while f"{prefix}-{n}" in by:n+=1
    return f"{prefix}-{n}"

for entry in attached_files:
    content=base64.b64decode(entry['content64'],validate=True)
    if hashlib.sha256(content).hexdigest()!=entry['sha256']:raise ValueError("Нарушена целостность "+entry['filename'])
    if entry['category']=='inventory':archived_inventory=entry
    else:import_source(entry['category'],entry['filename'],content,entry.get('requirement') or specification_requirement)
for category,path in source_files: import_source(category,path,requirement=specification_requirement)
by=records()
for ident, values in attribute_edits.items():by[ident].setdefault('attrs',{}).update(values)
sources=checked_sources()
table('Происхождение данных',['Источник','Файл','Категория','Байты','SHA-256','Связанные ID'],[(k,n['attrs']['filename'],n['attrs']['category'],len(raw),n['attrs']['sha256'],', '.join(n['refs'])) for k,(n,raw) in sources.items()])
table('Требования и спецификации',['ID','Название','Описание','Связи'],[(n['id'],n['name'],n.get('note',''),', '.join(n.get('refs',[]))) for n in by.values() if procurement_id in n.get('refs',[]) and (n['kind']=='requirement' or n.get('attrs',{}).get('fleetRole')=='specification')])

# %% topology
def scope():
    by=records()
    if by[procurement_id]['kind']!='procurement': raise ValueError("Нужна закупка")
    sites=[]
    clusters=set()
    for ident in sorted(related(by[procurement_id],'uses')):
        inst=by[ident]
        if inst['kind']!='installation' or inst.get('attrs',{}).get('verification'):continue
        target=[k for k in related(inst,'deployedOn') if by[k]['kind']=='cluster']
        if len(target)!=1 or target[0] in clusters: raise ValueError("Нужен отдельный кластер "+ident)
        clusters.add(target[0]);pools=[];loads=[]
        for n in sorted(by.values(),key=lambda n:n['id']):
            attrs=n.get('attrs',{})
            if n.get('parent')==ident and attrs.get('fleetRole')=='stock':
                sku,=[by[t] for t in related(n,'uses') if by[t]['kind']=='server']
                a=sku['attrs'];pools.append(dict(id=n['id'],sku=sku['id'],limits=[whole(a[k],k,1) for k in KEYS],price=whole(a['unitPriceRub'],'price'),quantity=whole(attrs['quantity'],'quantity'),maxBuy=whole(attrs['maxBuy'],'maxBuy')))
            if n['kind'] in ('component','system','service','module') and ident in related(n,'deployedOn'):
                demand=[whole(attrs[k],k) for k in KEYS];apart=attrs.get('antiAffinity',False)
                if not any(demand) or type(apart)!=bool:raise ValueError("Проверьте нагрузку "+n['id'])
                loads.append(dict(id=n['id'],demand=demand,count=whole(attrs['replicas'],'replicas',1),apart=apart))
        if not pools or not loads or len({p['sku'] for p in pools})!=len(pools): raise ValueError("Неполный или неоднозначный парк "+ident)
        if sum(l['count'] for l in loads)>256 or sum(p['quantity']+p['maxBuy'] for p in pools)>96:raise ValueError("Превышен размер задачи")
        sites.append(dict(id=ident,cluster=target[0],pools=pools,loads=loads))
    if not sites:raise ValueError("У закупки нет площадок")
    return sites
sites=scope()
table('Парк AS-IS',['Площадка','Кластер','Строка','SKU','Сейчас','Можно купить','Цена, ₽',*KEYS],[(s['id'],s['cluster'],p['id'],p['sku'],p['quantity'],p['maxBuy'],p['price'],*p['limits']) for s in sites for p in s['pools']])
table('Нагрузки',['Площадка','Объект','Реплик',*KEYS,'Разнести'],[(s['id'],l['id'],l['count'],*l['demand'],l['apart']) for s in sites for l in s['loads']])

# %% solver
def replicas(site):
    scales=[max(p['limits'][i] for p in site['pools']) for i in range(3)]
    ordered=sorted(site['loads'],key=lambda l:(-max(v/s for v,s in zip(l['demand'],scales)),l['id']))
    return [dict(id=f"{l['id']}#{i+1}",load=l['id'],demand=l['demand'],apart=l['apart']) for l in ordered for i in range(l['count'])]

def place(hosts,items):
    missing=[]
    for r in items:
        best=None; score=float('inf')
        for h in hosts:
            if r['apart'] and any(k['load']==r['load'] for k in h['replicas']):continue
            left=[a-b for a,b in zip(h['free'],r['demand'])]
            if min(left)<0:continue
            waste=0.0
            for a,b in zip(left,h['limits']):waste+=a/b
            if waste<score:best=h;score=waste
        if best is None:missing.append(r)
        else:
            best['free']=[a-b for a,b in zip(best['free'],r['demand'])]
            best['replicas'].append(r)
    return missing

def evaluate(site, order):
    hosts=[];cost=units=0;items=replicas(site)
    for p in site['pools']:
        q=whole(order.get(p['id'],0),p['id'])
        if q>p['maxBuy']:raise ValueError("Превышен лимит "+p['id'])
        cost+=q*p['price'];units+=q
        for i in range(p['quantity']+q):
            hosts.append(dict(id=f"{p['id']}#{i+1}",pool=p['id'],sku=p['sku'],limits=p['limits'],free=p['limits'][:],replicas=[]))
    missing=place(hosts,items);failures=[]
    for dead in hosts:
        live=[dict(h,free=h['free'][:],replicas=h['replicas'][:]) for h in hosts if h is not dead]
        displaced={r['id'] for r in dead['replicas']+missing}
        pending=place(live,[r for r in items if r['id'] in displaced])
        failures.append(dict(host=dead['id'],pool=dead['pool'],lost=[r['id'] for r in dead['replicas']],unplaced=[r['id'] for r in pending],moves=[[r['id'],h['id']] for h in live for r in h['replicas'] if r['id'] in displaced]))
    return dict(site=site['id'],order=order,units=units,cost=cost,hosts=hosts,missing=[r['id'] for r in missing],failures=failures,worst=max([len(missing)]+[len(f['unplaced']) for f in failures]),idle=sum(not h['replicas'] for h in hosts))

def optimize(site):
    from math import prod
    pools=site['pools'];options=prod(p['maxBuy']+1 for p in pools)
    h=sum(p['quantity']+p['maxBuy'] for p in pools)
    if options>10000 or options*len(replicas(site))*max(1,h)**2>20_000_000:raise ValueError("Сузьте пределы полного перебора")
    best={}
    for counts in product(*(range(p['maxBuy']+1) for p in pools)):
        order={p['id']:q for p,q in zip(pools,counts)};r=evaluate(site,order)
        if r['missing']:continue
        keys=['normal']
        if r['worst']==0:
            keys+=['resilient']+['sku:'+p['sku'] for p in pools if all(t['sku']==p['sku'] or not order[t['id']] for t in pools)]
            if r['units']==0:keys.append('existing')
        for k in keys:
            if k not in best or (r['cost'],r['units'])<(best[k]['cost'],best[k]['units']):best[k]=r
    return best,options

def summarize(key,sites_result):
    valid=all(s is not None for s in sites_result)
    return dict(key=key,available=valid,sites=sites_result,units=sum(s['units'] for s in sites_result) if valid else None,cost=sum(s['cost'] for s in sites_result) if valid else None,idle=sum(s['idle'] for s in sites_result) if valid else None,worst=max(s['worst'] for s in sites_result) if valid else None,missing=sum(len(s['missing']) for s in sites_result) if valid else None)
search=[optimize(s) for s in sites]
variants={'asis':summarize('asis',[evaluate(s,{}) for s in sites])}
for key in ['normal','resilient']+['sku:'+sku for sku in sorted({p['sku'] for s in sites for p in s['pools']})]:
    variants[key]=summarize(key,[best.get(key,best.get('existing') if key.startswith('sku:') else None) for best,_ in search])
if manual_order is not None:
    unknown=set(manual_order)-{p['id'] for s in sites for p in s['pools']}
    if unknown:raise ValueError("Неизвестные позиции "+str(unknown))
    variants['manual']=summarize('manual',[evaluate(s,{p['id']:manual_order.get(p['id'],0) for p in s['pools']}) for s in sites])
choice=variants[variant_key]
table('Сравнение AS-IS / TO-BE',['Вариант','Доступен','Купить','Цена, ₽','Свободные узлы','Дефицит штатно','Худший отказ'],[(k,r['available'],r['units'],r['cost'],r['idle'],r['missing'],r['worst']) for k,r in variants.items()])
bars('Стоимость вариантов',[(k,r['cost']) for k,r in variants.items() if r['available']],'₽')
print("Проверено конфигураций по площадкам:",sum(n for _,n in search),"· выбор:",variant_key)

# %% failures
if choice['available']:
    table('Позиции заказа',['Площадка','Строка парка','SKU','Было','Добавить','Станет'],[(s['id'],p['id'],p['sku'],p['quantity'],r['order'].get(p['id'],0),p['quantity']+r['order'].get(p['id'],0)) for s,r in zip(sites,choice['sites']) for p in s['pools']])
    table('Назначения',['Площадка','Узел','SKU','Реплики','Свободно CPU / RAM / диск'],[(s['site'],h['id'],h['sku'],', '.join(r['id'] for r in h['replicas']),h['free']) for s in choice['sites'] for h in s['hosts']])
    all_failures=[(s['site'],f) for s in choice['sites'] for f in s['failures']]
    if failed_host and not any(f['host']==failed_host for _,f in all_failures):raise ValueError("Узел отсутствует в выбранном варианте: "+failed_host)
    table('Отказ каждого узла',['Площадка','Отказал','Затронуты','Перенос реплика → узел','Без места'],[(site,f['host'],', '.join(f['lost']),'; '.join(' → '.join(m) for m in f['moves']),', '.join(f['unplaced']) or '0') for site,f in all_failures if not failed_host or f['host']==failed_host])
    bars('Худший дефицит после одного отказа',[(k,r['worst']) for k,r in variants.items() if r['available']],'реплик')
else:print('Доступный парк и лимиты закупки не позволяют собрать этот вариант.')

# %% trace
load_ids={w['id'] for s in sites for w in s['loads']}
load_order=[n['id'] for n in model['nodes'] if n['id'] in load_ids]
def dsm_groups(layer):
    edges=[e for e in model['edges'] if e['layer']==layer and {e['from'],e['to']}<=load_ids]
    weights=Counter()
    for e in edges:weights[tuple(sorted((e['from'],e['to'])))]+=e['weight']
    total=sum(weights.values());deg=Counter();groups=[[ident] for ident in load_order]
    for (a,b),v in weights.items():deg[a]+=v;deg[b]+=v
    while total:
        owner={v:i for i,g in enumerate(groups) for v in g};mass=[sum(deg[v] for v in g) for g in groups];cuts=Counter()
        for (a,b),w in weights.items():
            i,j=sorted([owner[a],owner[b]])
            if i!=j:cuts[i,j]+=w
        best=0;pair=None
        for (i,j),v in sorted(cuts.items()):
            gain=v/total-mass[i]*mass[j]/(2*total**2)
            if gain>best+1e-12:best=gain;pair=(i,j)
        if pair is None:break
        i,j=pair;groups=[g for k,g in enumerate(groups) if k not in pair]+[groups[i]+groups[j]]
    positions={v:i for i,v in enumerate(load_order)}
    groups=sorted((sorted(g,key=positions.get) for g in groups),key=lambda g:positions[g[0]])
    matrix={(e['from'],e['to']):e['weight'] for e in edges}
    if layer=='risk':matrix.update({(b,a):v for (a,b),v in list(matrix.items())})
    order=[v for g in groups for v in g]
    table('DSM '+layer,['ID']+order,[[v]+[matrix.get((v,t),0) for t in order] for v in order])
    return groups
clusters={layer:dsm_groups(layer) for layer in ('flow','risk')}
table('Кластеры по связям',['Слой','Группа','ID нагрузок'],[(k,i+1,', '.join(g)) for k,groups in clusters.items() for i,g in enumerate(groups)])
groups=defaultdict(list)
if group_by not in ('site','sku','cluster'):raise ValueError("group_by: site, sku или cluster")
for s in sites:
    for p in s['pools']:groups[{'site':s['id'],'sku':p['sku'],'cluster':s['cluster']}[group_by]].append(p)
table('Группировка парка',['Группа','Строки исходных данных','Серверов AS-IS'],[(k,', '.join(p['id'] for p in ps),sum(p['quantity'] for p in ps)) for k,ps in groups.items()])
trace_ids={procurement_id}|load_ids|{s['id'] for s in sites}|{s['cluster'] for s in sites}|{p['id'] for s in sites for p in s['pools']}|{p['sku'] for s in sites for p in s['pools']}
for n in by.values():
    if procurement_id in n.get('refs',[]) or n.get('parent')==procurement_id:trace_ids.add(n['id'])
for n in by.values():
    if n.get('parent') in trace_ids or n.get('attrs',{}).get('fleetRole')=='order' and any(t in trace_ids for _,t in n.get('relations',[])):trace_ids.add(n['id'])
trace_ids.update(n['release'] for n in by.values() if n['id'] in trace_ids and n.get('release'))
relation_rows=[]
for n in by.values():
    if n['id'] not in trace_ids:continue
    relations=list(n.get('relations',[]))+[('ref',t) for t in n.get('refs',[])]
    if n.get('parent'):relations.append(('partOf',n['parent']))
    if n.get('release'):relations.append(('release',n['release']))
    relation_rows.extend((n['id'],k,t) for k,t in relations if t in trace_ids)
table('Архитектурные связи',['Источник','Отношение','Цель'],relation_rows)
table('Контракты DSM',['Источник','Цель','Слой','Вес','Основание'],[(e['from'],e['to'],e['layer'],e['weight'],e['reason']) for e in model['edges'] if e['from'] in load_ids and e['to'] in load_ids])
table('ADR, варианты и релизы',['ID','Тип','Состояние','Релиз','Связанные ID','Описание'],[(n['id'],n['kind'],n.get('attrs',{}).get('stage',n.get('state','')),n.get('release',''),', '.join(n.get('refs',[])),n.get('note','')) for n in by.values() if n['id'] in trace_ids and (n['kind'] in ('adr','release') or n.get('attrs',{}).get('fleetRole')=='variant')])

# %% decisions
# Field measurements use the current AS-IS inventory. A proposed order is a separate scenario.
observations=[];inventory_source=None
if inventory_file or archived_inventory:

    path=Path(inventory_file or archived_inventory['filename']);raw=path.read_bytes() if inventory_file else base64.b64decode(archived_inventory['content64'])
    if not inventory_file and hashlib.sha256(raw).hexdigest()!=archived_inventory['sha256']:raise ValueError("Нарушена целостность архивной ведомости")
    if not raw or len(raw)>2*1024*1024:raise ValueError("Недопустимый размер ведомости")
    pools={p['id']:p for site in sites for p in site['pools']};serials=set()
    for row in input_tables(path.name,raw):
        serial=str(row.get('serial','')).strip();pool=row.get('pool')
        if not serial or serial in serials or pool not in pools:raise ValueError("Неизвестная строка парка или повтор серийного номера")
        vals=[whole(int(str(row[k])),k,1) for k in KEYS]
        observations.append(dict(serial=serial,pool=pool,values=vals))
        serials.add(serial)
    count=Counter(o['pool'] for o in observations if all(v>=lim for v,lim in zip(o['values'],pools[o['pool']]['limits'])))
    table('Проверка фактического парка',['Строка парка','План AS-IS','Замерено','Соответствуют профилю','Расхождение'],
          [(k,p['quantity'],sum(o['pool']==k for o in observations),count[k],count[k]-p['quantity']) for k,p in pools.items()])
    inventory_source=dict(filename=path.name,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),content64=base64.b64encode(raw).decode())
    print("Ведомость",path.name,inventory_source['sha256'])

checks=[('Доступен состав в пределах заказа',choice['available'],'Пересмотреть доступные типы и пределы закупки'),('Все реплики размещены',choice['missing']==0,'Добавить ёмкость или изменить размещение'),('Каждый одиночный отказ выдержан',choice['worst']==0,'Увеличить резерв площадки'),('В пределах бюджета',budget_rub is None or choice['cost'] is not None and choice['cost']<=budget_rub,'Пересогласовать бюджет')]
outcome=next((no for _,ok,no in checks if not ok),'Предложить к согласованию')
table('Дерево принятия решения',['Условие','Да','Нет','Значение'],[(label,checks[i+1][0] if i+1<len(checks) else 'Предложить к согласованию',no,'Да' if ok else 'Нет') for i,(label,ok,no) in enumerate(checks)])
print('Результат дерева:',outcome)
table('Журнал ревизий',['Версия','Ревизия','Дата','Автор','Изменение'],history_rows)

# %% export
def safe_filename(name):return re.sub(r'[^\w. -]+','_',name).strip('. ') or 'source'
def html_report():
    css="body{font:13px system-ui;color:#193a33;margin:24px}table{border-collapse:collapse;width:100%;font-size:11px}td,th{text-align:left;padding:4px;border-bottom:1px solid #c9d6cf;overflow-wrap:anywhere}h2{break-after:avoid}tr,svg{break-inside:avoid}svg{max-width:100%}@page{size:A4 landscape;margin:12mm}thead{display:table-header-group}"
    return "<!doctype html><meta charset=utf-8><style>"+css+"</style><h1>"+escape(model['title'])+"</h1><p>"+escape(procurement_id+" · "+variant_key+" · "+base_revision)+"</p>"+''.join('<h2>'+escape(k)+'</h2>'+v[2] for k,v in tables.items())+''.join(charts.values())
if export_directory:
    target=Path(export_directory);target.mkdir(exist_ok=True,parents=True)
    with zipfile.ZipFile(target/'analysis.zip','w',zipfile.ZIP_DEFLATED) as bundle:
        for k,(cols,rows,_) in tables.items():
            buf=io.StringIO();writer=csv.writer(buf);writer.writerow(cols);writer.writerows(rows);bundle.writestr('tables/'+safe_filename(k)+'.csv',buf.getvalue().encode('utf-8-sig'))
        for k,(n,raw) in sources.items():bundle.writestr('sources/'+safe_filename(k)+'-'+safe_filename(n['attrs']['filename']),raw)
        for k,chart in charts.items():bundle.writestr('charts/'+safe_filename(k)+'.svg',chart)
        if inventory_source:bundle.writestr('measurements/'+safe_filename(inventory_source['filename']),base64.b64decode(inventory_source['content64']))
        bundle.writestr('variants.json',json.dumps(variants,ensure_ascii=False));bundle.writestr('report.html',html_report())
    report=target/'report.html';report.write_text(html_report(),encoding='utf-8')
    if export_pdf:
        import shutil,subprocess,tempfile
        chrome=next((shutil.which(k) for k in ('google-chrome','chromium','chromium-browser') if shutil.which(k)),None)
        if not chrome:raise RuntimeError("Откройте report.html в браузере и выберите Печать → Сохранить в PDF")
        with tempfile.TemporaryDirectory() as profile:
            subprocess.run([chrome,'--headless','--disable-gpu','--no-pdf-header-footer','--user-data-dir='+profile,'--print-to-pdf='+str((target/'report.pdf').resolve()),report.resolve().as_uri()],check=True,timeout=60,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print("Сохранено:",target.resolve())
else:print("Для выгрузки таблиц, исходников, графиков и отчёта задайте export_directory в параметрах.")
