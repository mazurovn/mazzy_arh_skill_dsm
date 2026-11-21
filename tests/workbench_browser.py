"""Real notebook, OpenSpec and architecture browser flows on disposable files."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from contextlib import contextmanager
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "example/enterprise-architecture.dsm.json"
CLI = ROOT / "dsm.cjs"


def cli(*args):
    return subprocess.check_output(["node", str(CLI), *map(str,args)],text=True)


def download(page, button, target):
    with page.expect_download() as entry:
        button.click()
    entry.value.save_as(target)
    return target


def capture(page, name):
    folder = os.environ.get("DSM_QA_IMAGES")
    if folder:
        page.screenshot(path=str(Path(folder)/name))


@contextmanager
def studio(project):
    proc = subprocess.Popen(["node", str(CLI), "serve", str(project), "0"],
                            stdout=subprocess.PIPE, text=True,
                            env={**os.environ, "DSM_JUPYTER_PYTHON": sys.executable})
    try:
        origin = proc.stdout.readline().strip()
        assert origin.startswith("http://127.0.0.1:"), origin
        yield origin
    finally:
        proc.terminate()
        proc.wait(timeout=15)


def saved_book(origin, action, data=None):
    request = Request(origin+"/api/notebooks/"+action, method="POST",
                      headers={"Content-Type":"application/json", "Origin":origin},
                      data=json.dumps(data or {}).encode())
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def verify_library(project):
    with studio(project) as origin:
        entries=saved_book(origin,"list")
        original=next(e for e in entries if e["name"]=="external.ipynb")
        assert not original["active"]
        content=saved_book(origin,"download/"+original["id"])
        reopened=saved_book(origin,"start",{"saved":original["id"]})
        assert reopened["id"]!=original["id"]
        assert saved_book(origin,"download/"+reopened["id"])==content
        saved_book(origin,"stop/"+reopened["id"])
    other=project.with_name("other.json")
    cli("init",other,"Другой проект")
    with studio(other) as origin:
        assert saved_book(origin,"list")==[]
        try:
            saved_book(origin,"download/"+original["id"])
        except HTTPError as err:
            assert err.code==400 and "другого проекта" in json.load(err)["error"]
        else:
            raise AssertionError("Another project's notebook was accessible")
    print("Notebook library survived restart, preserved both copies and isolated a second project.",flush=True)


def execute_profiles(folder):
    for profile in ("full","requirements","placement","readiness"):
        file=folder/(profile+".ipynb")
        cli("notebook",EXAMPLE,file,profile)
        book=nbformat.read(file,as_version=4)
        nbformat.validate(book)
        book.cells.insert(-1,nbformat.v4.new_code_cell('model["title"]="Calculated in Python"\nprint("EXECUTED", len(model["nodes"]))'))
        NotebookClient(book,timeout=60,kernel_name="python3").execute(cwd=folder)
        assert all(c.execution_count is not None for c in book.cells if c.cell_type=="code")
        value=book.cells[-1].outputs[0].data["application/vnd.mazzy.dsm+json"]
        assert value["data"]["title"]=="Calculated in Python"
        if profile!="full":
            lines="".join(o.get("text","") for o in next(c for c in book.cells if c.id=="report").outputs)
            assert {"requirements":"REQ-1","placement":"S1","readiness":"upgrade-memory"}[profile] in lines
        nbformat.write(book,file)
        assert json.loads(cli("import-preview",EXAMPLE,file,"result"))["changes"]
        assert json.loads(cli("notebook-info",file))["cells"][-1]["outputs"]==1
    print("Four generated profiles validated and executed in fresh Python kernels.",flush=True)


def notebook_flow(page,folder):
    start_cell=page.locator(".matrix tbody tr").first.locator(".cell").first
    start_cell.focus()
    page.keyboard.press("ArrowRight");page.keyboard.press("ArrowDown")
    expect(page.locator(".matrix tbody tr").nth(1).locator(".cell").nth(1)).to_be_focused()
    page.keyboard.press("End")
    expect(page.locator(".matrix tbody tr").nth(1).locator(".cell").last).to_be_focused()
    page.get_by_role("button",name="Данные и расчёты").click()
    page.get_by_role("button",name="Jupyter Notebook").click()
    page.locator("#bookProfile").select_option("placement")
    page.get_by_role("button",name="Сгенерировать блокнот").click()
    expect(page.locator(".cell-preview")).not_to_have_count(0)
    generic=nbformat.v4.new_notebook(cells=[nbformat.v4.new_markdown_cell("# External notes"),nbformat.v4.new_code_cell("print('CUSTOM-CELL')")])
    generic.cells[1].outputs=[nbformat.v4.new_output("stream",name="stdout",text="PREVIOUS-OUTPUT\n")]
    generic.cells[1].execution_count=1
    file=folder/"external.ipynb"
    nbformat.write(generic,file)
    file.write_bytes(b"\xef\xbb\xbf"+file.read_bytes())
    page.locator("#bookFile").set_input_files(file)
    expect(page.get_by_role("heading",name="external.ipynb")).to_be_visible()
    capture(page,"workbench-notebook.png")
    page.locator("#bookOutputs").check()
    expect(page.locator(".cell-preview")).to_have_count(1)
    page.locator(".cell-preview summary").click()
    expect(page.locator(".cell-preview")).to_contain_text("Порядок исполнения · 1")
    page.locator("#bookKind").select_option("markdown")
    expect(page.locator(".cell-preview")).to_have_count(0)
    page.locator("#bookKind").select_option("")
    page.locator("#bookQuery").fill("PREVIOUS-OUTPUT")
    expect(page.locator(".cell-preview")).to_have_count(1)
    page.get_by_role("button",name="Привязать модель").click()
    expect(page.get_by_text("Текущая ревизия",exact=False).first).to_be_visible()
    rejected=folder/"invalid.ipynb";rejected.write_text('{"nbformat":3}')
    page.locator("#bookFile").set_input_files(rejected)
    expect(page.get_by_role("alert")).to_contain_text("nbformat 4")
    expect(page.get_by_role("heading",name="external.ipynb")).to_be_visible()
    for label,name in [("Без выводов","clean.ipynb"),("Отчёт .md","report.md"),("Скрипт .py","analysis.py")]:
        target=download(page,page.get_by_role("button",name=label,exact=True),folder/name)
        if name.endswith("ipynb"):
            cleaned=nbformat.read(target,as_version=4);nbformat.validate(cleaned)
            assert not any(c.outputs for c in cleaned.cells if c.cell_type=="code")
        else: assert "CUSTOM-CELL" in target.read_text()
    page.get_by_role("button",name="Запустить Jupyter").click()
    frame=page.frame_locator("#notebookHost iframe")
    expect(frame.locator(".jp-Notebook")).to_contain_text("External notes",timeout=90000)
    expect(frame.locator(".jp-Notebook")).to_contain_text("PREVIOUS-OUTPUT")
    custom=frame.locator(".jp-CodeCell").filter(has_text="CUSTOM-CELL")
    custom.locator(".cm-content").click()
    page.keyboard.press("Control+Enter")
    expect(custom.locator(".jp-OutputArea")).to_contain_text("CUSTOM-CELL",timeout=45000)
    page.keyboard.press("Control+s")
    origin = page.url.rstrip("/")
    session = next(item for item in saved_book(origin,"list") if item["active"])
    # Jupyter acknowledges Ctrl+S before the server finishes writing the notebook.
    deadline = time.monotonic()+20
    while time.monotonic() < deadline:
        persisted = saved_book(origin,"download/"+session["id"])
        outputs = (out for c in persisted["cells"] for out in c.get("outputs",[]))
        if any("CUSTOM-CELL" in "".join(out.get("text","")) for out in outputs):
            break
        time.sleep(.1)
    else:
        raise AssertionError("Jupyter did not persist CUSTOM-CELL after Ctrl+S")
    live=download(page,page.get_by_role("button",name="Скачать сохранённый блокнот"),folder/"live.ipynb")
    native=nbformat.read(live,as_version=4)
    assert any("CUSTOM-CELL" in o.get("text","") for c in native.cells for o in c.get("outputs",[]))
    page.get_by_role("button",name="Завершить сессию").click()
    page.locator("#accept").click()
    expect(page.locator("#notebookHost iframe")).to_have_count(0)
    page.get_by_text("Библиотека проекта",exact=False).click()
    page.get_by_role("button",name="Открыть копию").first.click()
    expect(page.get_by_role("heading",name="external.ipynb")).to_be_visible()
    page.locator("#bookFile").set_input_files(folder/"readiness.ipynb")
    expect(page.get_by_role("heading",name="readiness.ipynb")).to_be_visible()
    page.get_by_role("button",name="Проверить результат Python").click()
    expect(page.locator(".diff-table")).to_contain_text("Calculated in Python")
    page.locator('[name=actor]').fill("Analyst");page.locator("#accept").click()
    expect(page.locator("h1")).to_have_text("Calculated in Python")
    page.get_by_role("button",name="Проверить результат Python").click()
    expect(page.locator("#toast")).to_contain_text("баз")
    print("Browser imported, bound, opened, downloaded and reopened a user notebook; computed model CAS verified.",flush=True)


def change_flow(page,folder,project):
    page.get_by_role("button",name="Архитектура",exact=True).click()
    page.get_by_role("button",name="Запросы",exact=True).click()
    page.get_by_role("button",name="+ Запрос").click()
    for key,value in {"id":"CR-1","name":"Увеличить ресурс","requester":"Иван","owner":"ИТ","objects":"REQ-1 S1","problem":"Недостаточно памяти","outcome":"32 ГиБ","acceptance":"Сверить паспорт"}.items():
        page.locator('#fields [name='+key+']').fill(value)
    page.locator("#accept").click()
    expect(page.locator("aside")).to_contain_text("Сверить паспорт")
    page.get_by_role("button",name="Разобрать").click()
    page.locator('[name=reviewer]').fill("Борис");page.locator('[name=reason]').fill("Согласовано");page.locator("#accept").click()
    page.get_by_role("button",name="Создать предложение").click()
    page.locator('[name=newId]').fill("request-memory");page.locator("#accept").click()
    card=page.locator("details.request-card").filter(has_text="request-memory")
    card.locator("summary").click()
    card.get_by_role("button",name="Добавить задачу").click()
    for k,v in {"id":"WORK-1","name":"Проверить память","owner":"ИТ"}.items():page.locator('#fields [name='+k+']').fill(v)
    page.locator("#accept").click()
    card.locator("summary").click()
    capture(page,"workbench-requests.png")
    card.get_by_role("button",name="Просмотреть пакет").click()
    expect(page.locator("#deskPackageText")).to_contain_text("Недостаточно памяти")
    page.locator("#cancel").click()
    pkg=download(page,card.get_by_role("button",name="Скачать ZIP"),folder/"change.zip")
    with zipfile.ZipFile(pkg) as archive:
        files={p:archive.read(p) for p in archive.namelist() if not p.endswith("/")}
    tasks=next(p for p in files if p.endswith("/tasks.md"))
    files[tasks]=files[tasks].replace(b"[ ]",b"[x]")
    revised=folder/"revised.zip"
    with zipfile.ZipFile(revised,"w") as archive:
        for k,v in files.items():archive.writestr(k,v)
    page.get_by_role("button",name="Обмен",exact=True).click()
    page.locator("#file").set_input_files(revised)
    expect(page.locator("#dialog .diff-table")).to_contain_text("WORK-1")
    expect(page.locator('#fields [name=note]')).to_have_value("Импорт · revised.zip")
    page.locator("#accept").click()
    page.get_by_role("button",name="Запросы",exact=True).click()
    card.locator("summary").click()
    card.get_by_role("button",name="Apply",exact=True).click()
    cur=json.loads(cli("show",project))
    patch={"project":cur["project"],"base":cur["base"],"ops":[{"op":"node","value":{"id":"S1","attrs":{"memoryGiB":32}}}]}
    page.locator('[name=patch]').fill(json.dumps(patch))
    page.locator('[name=actor]').fill("Комитет");page.locator('[name=note]').fill("Согласовано CR-1")
    page.locator("#accept").click()
    expect(page.locator("#dialog .diff-table")).to_contain_text("request-memory")
    page.locator("#accept").click()
    expect(page.locator("article,section.card").filter(has_text="Запросы на изменение").first).to_contain_text("Закрытые")
    page.get_by_role("button",name="История запроса").click()
    expect(page.locator("#fields")).to_contain_text("Комитет");page.locator("#accept").click()
    page.get_by_role("button",name="Анализ",exact=True).click()
    page.locator("#deskReport").select_option("placement")
    expect(page.locator("article")).to_contain_text("S1")
    capture(page,"workbench-analysis.png")
    csv=download(page,page.get_by_role("button",name="Выгрузить CSV"),folder/"report.csv")
    assert "API" in csv.read_text()
    page.get_by_role("button",name="S1",exact=True).click()
    expect(page.locator("aside")).to_contain_text("32")
    page.get_by_text("Фильтры и сортировка",exact=True).click()
    page.locator("#catalog-kind").select_option("server")
    page.locator("#query").fill("memorygib 32")
    expect(page.locator("article tbody tr")).to_have_count(1)
    catalog=download(page,page.get_by_role("button",name="CSV выборки"),folder/"catalog.csv")
    assert "S1" in catalog.read_text()
    page.get_by_role("button",name="Версии",exact=True).click()
    page.get_by_text("Фильтры истории").click()
    page.locator("#history-actor").select_option("Комитет")
    expect(page.locator("#content tbody tr")).to_have_count(1)
    expect(page.locator("#content tbody")).to_contain_text("Согласовано CR-1")
    page.get_by_role("button",name="Журнал .md").click()
    log=download(page,page.locator("#accept"),folder/"changes.md")
    assert "Согласовано CR-1" in log.read_text()
    print("Request, triage, proposal, task, ZIP return, Apply, timeline, reports and filtered exports passed.",flush=True)


def main():
    with tempfile.TemporaryDirectory() as temp:
        folder=Path(temp);project=folder/"model.json";shutil.copy(EXAMPLE,project)
        execute_profiles(folder)
        with studio(project) as origin:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(executable_path=os.environ.get("DSM_BROWSER"))
                page=browser.new_page(viewport={"width":1350,"height":900});errors=[]
                page.on("pageerror",lambda err:errors.append(str(err)))
                page.goto(origin)
                notebook_flow(page,folder);change_flow(page,folder,project)
                page.goto((ROOT/"DSM-Studio.html").as_uri())
                page.get_by_role("button",name="Данные и расчёты").click()
                page.get_by_role("button",name="Jupyter Notebook").click()
                page.locator("#bookFile").set_input_files(folder/"external.ipynb")
                expect(page.locator(".cell-preview")).to_have_count(2)
                # A real DataTransfer follows the same drop path as a desktop file.
                page.locator("#bookDrop").evaluate("""(area, contents) => {
                  const transfer=new DataTransfer();
                  transfer.items.add(new File([contents], 'dropped.ipynb', {type:'application/json'}));
                  area.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true}));
                }""",(folder/"external.ipynb").read_text(encoding="utf-8-sig"))
                expect(page.get_by_role("heading",name="dropped.ipynb")).to_be_visible()
                page.locator("#bookDrop").evaluate("""area => {
                  const transfer=new DataTransfer();
                  transfer.items.add(new File([new Uint8Array(16*1024*1024+1)], 'large.ipynb'));
                  area.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true}));
                }""")
                expect(page.get_by_role("alert")).to_contain_text("16 МиБ")
                expect(page.get_by_role("heading",name="dropped.ipynb")).to_be_visible()
                page.set_viewport_size({"width":390,"height":844})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),"mobile overflow"
                assert not errors,errors
                browser.close()
        verify_library(project)

if __name__=="__main__":main()
