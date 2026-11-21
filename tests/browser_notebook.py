"""End-to-end checks against a disposable synthetic project. CI installs test dependencies."""
import json
import os
import sys
import time
import shutil
import subprocess
import tempfile
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "example"
CLI = ROOT / "dsm.cjs"

def run(*args):
    return subprocess.run(["node", str(CLI), *map(str, args)], capture_output=True, text=True, check=True).stdout

def check_book(folder):
    project = EXAMPLE / "terminal-kit.dsm.json"
    book = nbformat.read(EXAMPLE / "terminal-kit.ipynb", as_version=4)
    nbformat.validate(book)
    NotebookClient(book, timeout=60, kernel_name="python3").execute(cwd=folder)
    assert all(cell.execution_count is not None for cell in book.cells if cell.cell_type == "code")
    edited = load_workbook(EXAMPLE / "terminal-kit.xlsx")
    nodes = edited["Nodes"]
    column = {c.value: c.column for c in nodes[1]}
    for r in range(2, nodes.max_row+1):
        if nodes.cell(r, column["id"]).value == "F03":
            nodes.cell(r, column["release"]).value = "R2"
    file = folder / "edited.xlsx"
    edited.save(file)
    delta = json.loads(run("import-preview",project,file))
    assert len(delta["changes"]) == 1 and delta["releases"][1]["knownEffort"] == 10

def capture(page, name):
    folder = os.environ.get("DSM_QA_IMAGES")
    if folder:
        page.screenshot(path=str(Path(folder)/name))

def check_views(page):
    page.locator("#graphMode").select_option("component")
    expect(page.locator("svg [data-id=CLI] rect")).to_have_count(1)
    page.locator("#graphMode").select_option("sequence")
    expect(page.locator("svg [data-action=cell]")).to_have_count(3)
    capture(page, "sequence.png")
    page.locator("#graphMode").select_option("all")
    page.get_by_role("button",name="Совместные проверки",exact=True).click()
    page.locator("svg [data-id=F02][data-to=F03] circle").click()
    page.get_by_role("button",name="В реестр связей").click()
    expect(page.locator("tr.selected")).to_contain_text("F02 ↔ F03")
    page.get_by_role("button",name="В матрицу").click()
    expect(page.locator(".cell.active")).to_have_attribute("data-to","F03")
    capture(page, "matrix.png")

def check_jupyter(page, project):
    page.get_by_role("button",name="Данные и расчёты").click()
    page.get_by_role("button",name="Jupyter Notebook").click()
    page.get_by_role("button",name="Запустить Jupyter").click()
    frame=page.frame_locator("#notebookHost iframe")
    code=frame.locator(".jp-CodeCell").first
    editor=code.locator(".cm-content")
    expect(editor).to_contain_text("null = None",timeout=90000)
    model=json.loads(project.read_text())["history"][-1]["data"]
    model["title"]="Terminal Kit · Jupyter"
    source="null = None\ntrue = True\nfalse = False\nmodel = "+json.dumps(model,ensure_ascii=False)
    editor.click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text(source)
    page.keyboard.press("Control+Enter")
    expect(code.locator(".jp-InputPrompt")).to_contain_text("[1]",timeout=45000)
    page.keyboard.press("Escape")
    page.keyboard.press("b")
    page.keyboard.press("Enter")
    page.keyboard.insert_text('print("DSM-NODES", len(model["nodes"]))')
    page.keyboard.press("Control+Enter")
    expect(frame.locator(".jp-OutputArea").filter(has_text="DSM-NODES 14")).to_have_count(1,timeout=45000)
    page.keyboard.press("Control+s")
    capture(page, "jupyter.png")
    book=next(project.parent.glob(".dsm-notebooks/*/architecture.ipynb"))
    for _ in range(100):
        if "DSM-NODES" in book.read_text(): break
        time.sleep(.1)
    page.get_by_role("button",name="Проверить изменения",exact=True).click()
    expect(page.locator("#dialog .diff-table")).to_contain_text("Terminal Kit · Jupyter")
    page.locator("#accept").click()
    expect(page.locator("h1")).to_have_text("Terminal Kit · Jupyter")
    page.get_by_role("button",name="Проверить изменения",exact=True).click()
    expect(page.locator("#toast")).to_contain_text("база")
    page.get_by_role("button",name="Завершить сессию").click()
    page.locator("#accept").click()
    expect(page.locator("iframe")).to_have_count(0)

def check_enterprise(browser, folder):
    project=EXAMPLE/"enterprise-architecture.dsm.json"
    snapshot=folder/"organization.html"
    run("export",project,snapshot)
    page=browser.new_page()
    page.goto(snapshot.as_uri())
    page.get_by_role("button",name="Требования",exact=True).click()
    row=page.locator("article tbody tr").first
    expect(row).to_contain_text("REQ-1")
    expect(row).to_contain_text("API")
    expect(row).to_contain_text("DEV-1")
    page.get_by_role("button",name="Артефакты",exact=True).click()
    page.locator('article [data-action=focus][data-id=upgrade-memory]').first.click()
    expect(page.locator("aside")).to_contain_text("ADR-1")
    with page.expect_download() as output:
        page.get_by_role("button",name="Пакет OpenSpec").click()
    dest=folder/"bundle.zip"
    output.value.save_as(dest)
    import zipfile
    with zipfile.ZipFile(dest) as archive:
        files=archive.namelist()
        assert any(f.endswith("spec.md") for f in files)
        assert any(f.startswith("docs/adr/") and f.endswith(".md") for f in files)
    doc=json.loads(project.read_text())
    patch={"project":doc["project"],"base":doc["history"][-1]["rev"],"ops":[
        {"op":"node","value":{"id":"DEV-1","state":"done"}},
        {"op":"node","value":{"id":"S1","attrs":{"memoryGiB":32}}}]}
    page.get_by_role("button",name="Apply · применить патч").click()
    page.locator("[name=patch]").fill(json.dumps(patch))
    page.locator("#accept").click()
    expect(page.locator("#dialog .diff-table")).to_contain_text("DEV-1")
    page.locator("#accept").click()
    expect(page.locator("#revision")).to_contain_text("Версия 2")
    page.get_by_role("button",name="Требования",exact=True).click()
    expect(page.locator("article")).not_to_contain_text("DEV-1")
    capture(page, "requirements.png")
    page.get_by_role("button",name="Данные и расчёты").click()
    page.get_by_role("button",name="Ввод строк").click()
    page.locator("#gridRows tr").first.locator("input").first.fill("A2")
    page.locator("#gridRows tr").first.locator("input").last.fill("Локальный сервис")
    page.locator("#accept").click()
    expect(page.locator("#dialog .diff-table")).to_contain_text("Локальный сервис")
    page.locator("#accept").click()
    expect(page.locator("#revision")).to_contain_text("Версия 3")
    page.close()

def check_ui(folder):
    project = folder / "project.json"
    shutil.copy(EXAMPLE / "terminal-kit.dsm.json", project)
    with subprocess.Popen(["node",str(CLI),"serve",str(project),"0"],stdout=subprocess.PIPE,text=True,env={**os.environ, 'DSM_JUPYTER_PYTHON':sys.executable}) as server:
        try:
            origin = server.stdout.readline().strip()
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.environ.get("DSM_BROWSER"))
                page = browser.new_page(viewport={"width":1300,"height":900})
                errors = []
                page.on("pageerror",lambda e:errors.append(str(e)))
                page.goto(origin)
                expect(page.locator("h1")).to_have_text("Terminal Kit")
                expect(page.locator(".cell")).to_have_count(196)
                page.get_by_role("button",name="Совместные проверки",exact=True).click()
                page.get_by_role("button",name="F02 / F03 / 3",exact=True).click()
                expect(page.locator("aside")).to_contain_text("показанной версии плана")
                page.get_by_role("button",name="Релизы и фичи").click()
                page.get_by_role("checkbox",name="Выбрать F03").check()
                page.get_by_role("button",name="Изменить выбранные (1)").click()
                page.locator("select[name=release]").select_option("R2")
                page.locator("#accept").click()
                expect(page.locator(".big").first).to_have_text("8 / 12")
                assert json.loads(run("show",project))["version"] == 2
                cur = json.loads(run("show",project))
                patch = {"project":cur["project"],"base":cur["base"],"actor":"qa-agent","note":"UI feedback","ops":[{"op":"title","value":"Terminal Kit II"}]}
                pf=folder/"patch.json"
                pf.write_text(json.dumps(patch))
                run("apply",project,pf)
                expect(page.locator("h1")).to_have_text("Terminal Kit II",timeout=10000)
                page.get_by_role("button",name="Граф и схема").click()
                page.locator("#graphMode").select_option("tree")
                expect(page.locator('svg g[data-action="focus"] rect')).to_have_count(14)
                check_views(page)
                check_jupyter(page, project)
                page.get_by_role("button",name="Версии",exact=True).click()
                expect(page.locator(".table tbody tr")).to_have_count(4)
                page.get_by_role("button",name="Обмен",exact=True).click()
                with page.expect_download() as download:
                    page.locator('[data-action="export"][data-id="html"]').click()
                artifact=folder/"snapshot.html"
                download.value.save_as(artifact)
                offline=browser.new_page(viewport={"width":390,"height":844})
                offline.goto(artifact.as_uri())
                expect(offline.locator("h1")).to_have_text("Terminal Kit · Jupyter")
                offline.get_by_role("button",name="Данные и расчёты").click()
                offline.get_by_role("button",name="Каталог",exact=True).click()
                offline.get_by_role("button",name="+ Объект",exact=True).click()
                offline.locator('[name=id]').fill("DEMO")
                offline.locator('[name=name]').fill("Новая фича")
                offline.locator("#accept").click()
                expect(offline.locator("#revision")).to_contain_text("Версия 5")
                offline.reload()
                expect(offline.locator("#revision")).to_contain_text("Версия 5")
                assert not errors, errors
                check_enterprise(browser,folder)
                browser.close()
        finally:
            server.terminate()

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        folder=Path(temp)
        check_book(folder)
        check_ui(folder)
    print("Notebook kernel, Excel edit, browser, CLI feedback and offline reopen passed.")
