const AxisBook=(()=>{
  function write(doc,id,code,md){
    const h=doc.history.at(-1),node=id?h.data.nodes.find(n=>n.id===id):h.data.nodes.filter(n=>n.attrs?.machineRole==='axisRun').at(-1);
    if(node?.attrs?.machineRole!=='axisRun')throw Error('Сначала выполните прогон или выберите его протокол');
    return [md('axis-intro','## Верификация обратной связи осей\nПлан — команда контроллера, факт — показание программного энкодера в миллиметрах. После ALARM координаты команды удерживаются.'),
      code('axis-source',`import json, hashlib
from html import escape
from IPython.display import HTML, SVG, display
by_id = {n["id"]: n for n in model["nodes"]}
run_id = ${JSON.stringify(node.id)}
entry = by_id[run_id]
packet = json.loads(entry["attrs"]["packet"])
c, fault, r = packet["config"], packet["fault"], packet["run"]
s, rows = c["settings"], r["rows"]
digest = hashlib.sha256(c["program"].encode("utf-8")).hexdigest()
assert digest == r["sha256"] == entry["attrs"]["sha256"]
assert all(k in entry["refs"] and k in by_id for k in [c["req"], c["adr"], c["job"], c["plan"]])
print(run_id, r["engine"], c["job"], digest)
print("Требование", c["req"], c["criterion"])
print("ADR", c["adr"], c["decision"])
print("Альтернатива:", c["alternative"], "\\nОбоснование:", c["rationale"])
def table(columns, values):
    def row(record, tag):
        return "<tr>"+"".join(f"<{tag}>{escape(str(v))}</{tag}>" for v in record)+"</tr>"
    display(HTML("<table>"+row(columns,"th")+"".join(row(v,"td") for v in values)+"</table>"))`),
      code('axis-series',`assert rows and all(b[0]-a[0] == s["periodMs"] for a,b in zip(rows,rows[1:]))
planned = [[v[i+2] for v in rows] for i in range(3)]
measured = [[v[i+5]/s["countsPerMm"] for v in rows] for i in range(3)]
peaks = [round(max(abs(a-b) for a,b in zip(p,m)),6) for p,m in zip(planned,measured)]
alarm_index = next((j for j,row in enumerate(rows) if row[8]=="ALARM"),None)
alarm = None if alarm_index is None else rows[alarm_index][0]
assert alarm == r["alarm"]
delay = None if alarm is None or r["injected"] is None else alarm-r["injected"]
holds = [row for row in rows if row[8]=="HOLD"]
steady = alarm_index is not None and all(row[2:5] == rows[alarm_index][2:5] for row in holds)
fault_index = "XYZ".find(fault["axis"])
first = next((i for i,row in enumerate(rows) if row[0]==r["injected"]), None)
excited = first is not None and first>0 and any(row[2+fault_index]!=rows[first-1][2+fault_index] for row in rows[first:])
if fault["axis"]=="none":
    passed = alarm is None and max(max(abs(a-b) for a,b in zip(p,m)) for p,m in zip(planned,measured)) <= s["toleranceMm"]+1e-9
    verdict = "passed" if passed else "failed"
elif not excited:
    verdict = "inconclusive"
else:
    axis = "XYZ".index(fault["axis"])
    streak, detected = 0, None
    for j,(p,m) in enumerate(zip(planned[axis],measured[axis])):
        streak = streak+1 if abs(p-m)>s["toleranceMm"]+1e-9 else 0
        if streak >= s["tripSamples"]:
            detected = rows[j][0]
            break
    passed = alarm is not None and detected==alarm and r["axis"]==fault["axis"] and 0 <= delay <= s["maxResponseMs"] and steady and len(holds)>=2
    verdict = "passed" if passed else "failed"
table(["Ось","План в конце, мм","Обратная связь, мм","Макс. ошибка, мм"],[[axis,p[-1],m[-1],peak] for axis,p,m,peak in zip("XYZ",planned,measured,peaks)])
print("Внесение, мс:",r["injected"],"Срабатывание, мс:",alarm,"Реакция, мс:",delay,"Такты удержания:",len(holds),"Итог:",verdict)
indices = sorted(set([0,len(rows)-1]+list(range(max(0,(alarm_index or 0)-3),min(len(rows),(alarm_index or 0)+4)))))
table(["мс","Строка NC","План XYZ, мм","Факт XYZ, мм","Режим"],[[rows[i][0],rows[i][1],rows[i][2:5],[m[i] for m in measured],rows[i][8]] for i in indices])`),
      code('axis-plots',`def charts():
    items = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 730 390"><title>План и показания энкодеров XYZ</title><text x="15" y="18">План — синий · энкодер — оранжевый пунктир · ALARM — красная линия</text>']
    x = lambda ms: 65+635*ms/max(1,rows[-1][0])
    for i,axis in enumerate("XYZ"):
        top=40+i*115
        lo,hi=min(planned[i]+measured[i]),max(planned[i]+measured[i])
        y=lambda v: top+75-70*(v-lo)/max(hi-lo,0.001)
        items.append(f'<text x="3" y="{top+18}">{axis}, мм</text><text x="3" y="{top+36}">{hi:.2f}</text><text x="3" y="{top+77}">{lo:.2f}</text>')
        items.append(f'<path d="M65 {top} v80 h635" fill="none" stroke="#96aaa4"/>')
        for series,color,dash in [(planned[i],"#245e96",""),(measured[i],"#ba521b","5 3")]:
            points=" ".join(f"{x(row[0]):.2f},{y(v):.2f}" for row,v in zip(rows,series))
            items.append(f'<polyline fill="none" stroke="{color}" stroke-width="2" stroke-dasharray="{dash}" points="{points}"/>')
        if alarm is not None:items.append(f'<path d="M{x(alarm):.2f} {top} v80" stroke="#b9222b"/>')
    items.append(f'<text x="65" y="380">0 мс</text><text x="615" y="380">{rows[-1][0]} мс</text></svg>')
    display(SVG("".join(items)))
charts()`),
      md('axis-return','## Заключение\nПри возврате DSM сверяет вывод с сохранённым протоколом. Приёмка на физическом станке оформляется отдельно.'),
      code('result',`display({"application/vnd.mazzy.axis+json":{"project":${JSON.stringify(doc.project)},"base":${JSON.stringify(h.rev)},"runId":run_id,"sha256":digest,"values":[peaks,delay,len(holds),verdict]},"text/plain":"Заключение по осям готово"},raw=True)`,['dsm-result'])];
  }
  return {write};
})();
if(typeof module!=='undefined')module.exports=AxisBook;
