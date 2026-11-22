const MachineBook=(()=>{
  function cells(doc,root,code,md,context){
    const h=doc.history.at(-1);root=root||h.data.nodes.find(n=>n.kind==='product'&&n.attrs?.workbench==='cnc')?.id;
    if(!root)throw Error('В проекте нет станка');
    return [md('scope','## Диагностическая запись шпинделя\nРасчёт ведётся по каждой группе одинаковых датчиков. Неполный блок получает полный заголовок и хранит фактическое число отсчётов.'),
      code('scope-data',`from html import escape
from IPython.display import HTML, SVG, display
root = ${JSON.stringify(root)}
by_id = {n["id"]: n for n in model["nodes"]}
def belongs(n):
    while n.get("parent"):
        if n["parent"] == root:
            return True
        n = by_id[n["parent"]]
    return False
def role(key):
    return [n for n in model["nodes"] if belongs(n) and n.get("attrs", {}).get("machineRole") == key]
requirement, = role("capture")
format_node, = role("format")
seconds = requirement["attrs"]["durationSeconds"]
fmt = format_node["attrs"]
print(root, requirement["id"], seconds, "с", format_node["id"])
def table(columns, rows):
    def tr(row, tag):
        return "<tr>" + "".join(f"<{tag}>{escape(str(v))}</{tag}>" for v in row) + "</tr>"
    display(HTML("<table>"+tr(columns, "th")+"".join(tr(r, "td") for r in rows)+"</table>"))`),
      md('inputs','## Потоки и нагрузка регистратора'),code('capture-storage',`streams = []
for sensor in role("sensor"):
    a = sensor["attrs"]
    samples = seconds * a["sampleHz"]
    blocks = (samples + fmt["blockSamples"] - 1) // fmt["blockSamples"]
    total = a["quantity"] * (samples * a["axes"] * a["bytesPerAxis"] + blocks * fmt["headerBytes"])
    streams.append([sensor["id"], a["quantity"], samples, blocks, total])
required = sum(row[-1] for row in streams)
table(["Датчик","Количество","Отсчётов на датчик","Блоков на датчик","Всего байт"], streams)
options = []
for chip in sorted(role("storage"), key=lambda n: (n["attrs"]["capacityBytes"], n["id"])):
    usable = chip["attrs"]["capacityBytes"] * (100 - fmt["reservePercent"]) // 100
    options.append([chip["id"], usable, usable - required])
selected = next((row[0] for row in options if row[2] >= 0), None)
table(["Накопитель","Доступно, байт","Остаток, байт"], options)
width = max([required, *(row[1] for row in options), 1])
bars = []
for i, (label, size) in enumerate([("Запись", required), *((row[0], row[1]) for row in options)]):
    y = 24 + i * 28
    bars.append(f'<text x="2" y="{y}">{escape(label)}</text><rect x="105" y="{y-14}" width="{300*size/width:.2f}" height="17" fill="#397b68"/><text x="415" y="{y}">{size:,} Б</text>')
display(SVG(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 570 {34+len(options)*28}" role="img" aria-label="Запись и доступная память">{"".join(bars)}</svg>'))
print("Нужно", required, "байт. Выбор:", selected or "нет подходящего варианта")`),
      ...(context?.machineTrace?traceCells(context.machineTrace,code,md):[]),
      md('return-help','## Проверка версии\nСохраните блокнот и верните результат Python через предпросмотр.'),
      code('result',`display({"application/vnd.mazzy.machine+json":{"project":${JSON.stringify(doc.project)},"base":${JSON.stringify(h.rev)},"root":root,"values":[required,selected,streams,options]},"text/plain":"Готов к проверке DSM"},raw=True)`,['dsm-result'])];
  }
  function traceCells(file,code,md){
    const packed=code('vib1-file','import base64, gzip, hashlib\ntrace_name = '+JSON.stringify(file.name)+'\ntrace = gzip.decompress(base64.b64decode('+JSON.stringify(file.packed)+'))\nassert hashlib.sha256(trace).hexdigest() == '+JSON.stringify(file.digest)+'\nprint(trace_name, len(trace), "байт")');
    packed.metadata.jupyter={source_hidden:true};
    return [md('vib1-title','## Запись испытания\nВложен загруженный файл. Python сверяет SHA-256 и CRC каждого блока. График показывает первый канал одного потока в кодах датчика.'),packed,
      code('vib1-analysis',`import struct, zlib
expected = {}
for sensor in role("sensor"):
    a = sensor["attrs"]
    for i in range(a["quantity"]):
        expected[a.get("streamBase", 0)+i] = (sensor["id"], a["axes"], a["sampleHz"])
counts = {stream: [0, 0] for stream in expected}
offset, signal, starts, last = 0, [], {}, {}
while offset < len(trace):
    magic, version, axes, width, flags, stream, count, seq, micros, size, checksum = struct.unpack_from("<4sBBBBHHIQII", trace, offset)
    sensor_id, expected_axes, hz = expected[stream]
    blocks, samples = counts[stream]
    assert (magic, version, axes, width, flags) == (b"VIB1", 1, expected_axes, 2, 0)
    assert seq == blocks and samples == blocks * fmt["blockSamples"] and 0 < count <= fmt["blockSamples"]
    starts.setdefault(stream, micros)
    assert micros > last.get(stream, -1) and abs(micros-starts[stream]-samples*1000000//hz) <= (1000000+hz-1)//hz
    last[stream] = micros
    tail = offset + 32 + size
    payload = memoryview(trace)[offset+32:tail]
    assert len(payload) == size == axes * count * width
    assert zlib.crc32(payload, zlib.crc32(trace[offset:offset+28])) == checksum
    if stream == min(expected) and len(signal) < 256:
        signal.extend(struct.unpack_from("<h", payload, j*axes*2)[0] for j in range(min(count, 256-len(signal))))
    counts[stream] = [blocks+1, samples+count]
    offset = tail
table(["Поток", "Датчик", "Блоков", "Принято", "Ожидалось"], [[k, expected[k][0], *v, expected[k][2]*seconds] for k,v in counts.items()])
if signal:
    low, span = min(signal), max(1, max(signal)-min(signal))
    pts = " ".join(f"{5+i*490/max(1,len(signal)-1):.1f},{90-(y-low)*80/span:.1f}" for i,y in enumerate(signal))
    display(SVG(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 505 100"><polyline fill="none" stroke="#196b56" stroke-width="2" points="{pts}"/></svg>'))
print("Полное окно:", all(samples == seconds*expected[k][2] for k, (_, samples) in counts.items()))`)];
  }
  return {cells};
})();
if(typeof module!=='undefined')module.exports=MachineBook;
