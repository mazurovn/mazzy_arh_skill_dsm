"""End-to-end checks against a disposable synthetic project. CI installs test dependencies."""
import json
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

def check_ui(folder):
    project = folder / "project.json"
    shutil.copy(EXAMPLE / "terminal-kit.dsm.json", project)
    with subprocess.Popen(["node",str(CLI),"serve",str(project),"0"],stdout=subprocess.PIPE,text=True) as server:
        try:
            origin = server.stdout.readline().strip()
            with sync_playwright() as pw:
                browser = pw.chromium.launch()
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
                expect(page.locator("svg g")).to_have_count(14)
                page.get_by_role("button",name="Версии",exact=True).click()
                expect(page.locator(".table tbody tr")).to_have_count(3)
                page.get_by_role("button",name="Обмен",exact=True).click()
                with page.expect_download() as download:
                    page.locator('[data-action="export"][data-id="html"]').click()
                artifact=folder/"snapshot.html"
                download.value.save_as(artifact)
                offline=browser.new_page(viewport={"width":390,"height":844})
                offline.goto(artifact.as_uri())
                expect(offline.locator("h1")).to_have_text("Terminal Kit II")
                offline.get_by_role("button",name="Каталог",exact=True).click()
                offline.get_by_role("button",name="+ Объект",exact=True).click()
                offline.locator('[name=id]').fill("DEMO")
                offline.locator('[name=name]').fill("Новая фича")
                offline.locator("#accept").click()
                expect(offline.locator("#revision")).to_contain_text("Версия 4")
                offline.reload()
                expect(offline.locator("#revision")).to_contain_text("Версия 4")
                assert not errors, errors
                browser.close()
        finally:
            server.terminate()

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        folder=Path(temp)
        check_book(folder)
        check_ui(folder)
    print("Notebook kernel, Excel edit, browser, CLI feedback and offline reopen passed.")
