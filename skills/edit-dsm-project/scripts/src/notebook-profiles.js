const NotebookProfiles = {
  requirements: {
    name:'Приёмка требований', caption:'Для каждого требования вычисляются реализации, проверяющие объекты и полнота сценария.',
    python:`for r in (n for n in model["nodes"] if n["kind"] == "requirement"):
    implementations = []
    checks = []
    for n in model["nodes"]:
        for kind, target in n.get("relations", []):
            if target == r["id"] and kind == "realizes": implementations.append(n["id"])
            if target == r["id"] and kind == "verifies": checks.append(n["id"])
    attrs = r.get("attrs", {})
    print(r["id"], "реализация:", implementations, "проверяет:", checks, "приёмка:", all(str(attrs.get(k, "")).strip() for k in ("when", "then")))`
  },
  placement: {
    name:'Инвентаризация размещения', caption:'Отчёт группирует сервисы по узлам размещения и выделяет компоненты без назначения.',
    python:`hosts = {}
for n in model["nodes"]:
    targets = [target for kind, target in n.get("relations", []) if kind == "deployedOn"]
    if targets or n["kind"] in ("component", "service"):
        for target in targets or ["Без назначения"]:
            hosts.setdefault(target, []).append(n["id"])
for host, members in sorted(hosts.items()):
    print(host, len(members), ", ".join(members))`
  },
  readiness: {
    name:'Готовность изменений и релизов', caption:'Остаток ёмкости, блокировки и незакрытые задачи рассчитываются по текущему вводу.',
    python:`for r in (n for n in model["nodes"] if n["kind"] == "release"):
    items = [n for n in model["nodes"] if n.get("release") == r["id"]]
    known = sum(n.get("effort") or 0 for n in items)
    print(r["id"], "резерв:", r["capacity"] - known if r["capacity"] is not None else None, "без оценки:", sum(n.get("effort") is None for n in items))
for proposal in (n for n in model["nodes"] if n["kind"] == "proposal"):
    tasks = [n["id"] for n in model["nodes"] if n["kind"] == "changeTask" and n.get("parent") == proposal["id"] and n["state"] != "done"]
    print(proposal["id"], "открытые задачи:", tasks)
print("Блокировки:", [n["id"] for n in model["nodes"] if n["state"] == "blocked"])`
  }
};
if(typeof module!=='undefined')module.exports=NotebookProfiles;
