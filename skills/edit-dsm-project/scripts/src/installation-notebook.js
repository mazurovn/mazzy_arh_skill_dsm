/* Standalone Python notebook. No kernel packages beyond IPython are required. */
const InstallationNotebook = (() => {
  const calculation=`from html import escape
from IPython.display import HTML, SVG, display
nodes = {n["id"]: n for n in model["nodes"]}
inst = nodes[installation_id]
def related(n, relation, kind):
    return [nodes[t] for k, t in n.get("relations", []) if k == relation and nodes[t]["kind"] == kind]
host, = related(inst, "uses", "server")
cluster, = related(inst, "deployedOn", "cluster")
keys = ("cpuCores", "ramGiB", "diskGiB")
units = ("CPU, ядра", "RAM, ГиБ", "Диск, ГиБ")
def count(n, k, minimum=0):
    v = n.get(k)
    if type(v) is not int or v < minimum:
        raise ValueError(f"{k}: требуется целое число от {minimum}")
    return v
limits = [count(host["attrs"], k, 1) for k in keys]
loads = []
for n in nodes.values():
    if n["kind"] not in ("component", "service", "module", "system") or not any(k == "deployedOn" and t == installation_id for k,t in n.get("relations", [])):
        continue
    a = n.get("attrs", {})
    q = [count(a,k) for k in keys]
    if not any(q) or any(v > c for v,c in zip(q,limits)):
        raise ValueError("Реплика не помещается: " + n["id"])
    apart = a.get("antiAffinity",False)
    if type(apart) is not bool: raise ValueError("antiAffinity: требуется true или false")
    loads.append((n["id"], count(a,"replicas",1), q, apart))
if not loads or sum(n for _,n,_,_ in loads) > 4096: raise ValueError("Нужно от 1 до 4096 реплик")
bins = []
for name, replicas, q, apart in sorted(loads,key=lambda w:(-max(v/c for v,c in zip(w[2],limits)),w[0])):
    for _ in range(replicas):
        for used,members in bins:
            if (not apart or name not in members) and all(v+u <= c for v,u,c in zip(q,used,limits)): break
        else:
            used,members = [0,0,0], []
            bins.append((used,members))
        members.append(name)
        for j,v in enumerate(q): used[j] += v
spare = count(inst["attrs"],"spareHosts")
required = len(bins)+spare
purchase = max(0, required-count(inst["attrs"],"existingHosts"))
def table(headers,rows):
    def row(cells,tag):
        return "<tr>"+"".join(f"<{tag}>{escape(str(v))}</{tag}>" for v in cells)+"</tr>"
    display(HTML("<table>"+row(headers,"th")+"".join(row(r,"td") for r in rows)+"</table>"))
table(["Рабочий узел","Реплики",*units], [[i+1,", ".join(m),*u] for i,(u,m) in enumerate(bins)])
print(f"Узлов {required}, резерв {spare}, закупить {purchase}")
if "unitPriceRub" in host["attrs"]: print("Стоимость, ₽", purchase*count(host["attrs"],"unitPriceRub"))
totals = [sum(u[i] for u,_ in bins) for i in range(3)]
bars = []
for i,(label,value,limit) in enumerate(zip(units,totals,limits)):
    capacity = len(bins)*limit
    y = 41+i*45
    bars.append(f'<text x="4" y="{y}">{label}</text><rect x="109" y="{y-14}" width="240" height="17" fill="#e2ece7"/><rect x="109" y="{y-14}" width="{240*value/capacity}" height="17" fill="#157055"/><text x="359" y="{y}">{value} / {capacity}</text>')
display(SVG('<svg xmlns="http://www.w3.org/2000/svg" width="530" height="156"><title>Спрос и рабочая ёмкость</title><text x="4" y="16" font-weight="bold">Спрос / ёмкость рабочих узлов</text>'+"".join(bars)+'</svg>'))`;
  function write(doc,id,code,md,context={}){
    const h=DSMRef().head(doc),m=h.data;
    const candidates=m.nodes.filter(n=>n.kind==='installation'&&!n.attrs?.verification);
    if(id&&!candidates.some(n=>n.id===id))throw Error('Неизвестная инсталляция '+id);
    const install=candidates.find(n=>n.id===id)||candidates[0];
    const proposals=m.nodes.filter(n=>n.kind==='proposal'&&n.state==='done'&&n.attrs?.appliedObject===install?.id);
    const p=context.proposal?proposals.find(n=>n.id===context.proposal):proposals.length===1?proposals[0]:null;
    const reqs=m.nodes.filter(n=>n.kind==='requirement'&&p?.refs?.includes(n.id));
    const req=context.requirement?reqs.find(n=>n.id===context.requirement):reqs.length===1?reqs[0]:null;
    if((context.proposal&&!p)||(context.requirement&&!req))throw Error('Маршрут больше не связан с инсталляцией');
    const text=v=>JSON.stringify(v||'');
    return [
      md('sizing-title','## План закупки и размещения\nВыберите инсталляцию по ID, выполните ячейки сверху вниз. CPU, RAM и диск задают полезную ёмкость после накладных расходов. Резерв состоит из узлов того же типа.'),
      code('scope','installation_id = '+text(install?.id)+'\nrequirement_id = '+text(req?.id)+'\nproposal_id = '+text(p?.id)),
      code('sizing',calculation),
      md('measured-title','## Фактическая приёмка\nЗаполните inventory фактическими доступными узлами. Укажите среду, исполнителя и источник замера. Пустой список оставляет блокнот расчётным. Для нескольких предложений выберите точные ID в ячейке scope.'),
      code('measured','environment = '+text(install?.attrs?.environment)+'\nactor = ""\nsource = ""\ninventory = [\n    # {"id": "serial-001", "cpuCores": 16, "ramGiB": 96, "diskGiB": 800},\n]'),
      code('result',`if inventory:
    if not actor.strip() or not source.strip() or not environment.strip(): raise ValueError("Заполните среду, исполнителя и источник")
    if not requirement_id or not proposal_id: raise ValueError("Укажите требование и применённое предложение")
    seen = set()
    rows = []
    for n in inventory:
        name = n["id"].strip()
        if not name or name in seen: raise ValueError("Повтор или пустой ID фактического узла")
        seen.add(name)
        values = [count(n,k) for k in keys]
        rows.append([name,*values,all(v>=c for v,c in zip(values,limits))])
    good = sum(r[-1] for r in rows)
    table(["Фактический узел",*units,"Соответствует"],rows)
    print("Соответствуют профилю",good,"из",required,"требуемых")
    width = 230*min(good/required,1)
    display(SVG(f'<svg xmlns="http://www.w3.org/2000/svg" width="380" height="62"><title>Фактические узлы и требуемый состав</title><text x="4" y="18">Соответствуют профилю / требуется</text><rect x="4" y="30" width="230" height="18" fill="#e2ece7"/><rect x="4" y="30" width="{width}" height="18" fill="#157055"/><text x="246" y="45">{good} / {required}</text></svg>'))
    observation = dict(installation=installation_id,requirement=requirement_id,proposal=proposal_id,inventory=inventory,actor=actor,environment=environment,source=source)
    display({"application/vnd.mazzy.installation+json":{"project":`+text(doc.project)+`,"base":`+text(h.rev)+`,"observation":observation},"text/plain":"Свидетельство готово к предпросмотру"},raw=True)
else:
    print("Расчёт готов. Для проверки внедрения введите фактические узлы.")`,['dsm-result'])
    ];
  }
  const DSMRef=()=>typeof DSM!=='undefined'?DSM:require('./model.js');
  return {write};
})();
if(typeof module!=='undefined')module.exports=InstallationNotebook;
