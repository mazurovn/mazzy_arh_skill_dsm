"""Import real sources, approve the mixed fleet and verify the deployment in native Notebook 7."""
import csv
import hashlib
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from openpyxl import Workbook
from playwright.sync_api import sync_playwright, expect
from delivery_browser import button, submit
from workbench_browser import ROOT, cli, studio, saved_book

SOURCE = ROOT/'example/two-dc'


def workbook(target):
    book = Workbook()
    sheet = book.active
    sheet.title = 'Каталог'
    with (SOURCE/'catalog.csv').open(encoding='utf-8-sig',newline='') as stream:
        for row in csv.reader(stream):
            sheet.append(row)
    book.save(target)


def load(page, kind, path):
    page.locator('#fleetCategory').select_option(kind)
    page.locator('#fleetFile').set_input_files(path)
    expect(page.locator('#dialog')).to_be_visible()
    expect(page.locator('#fields')).to_contain_text('SOURCE-')
    page.locator('#accept').click()
    expect(page.locator('#dialog')).not_to_be_visible()


def native(page,url):
    button(page,'Рассчитать в Jupyter').click()
    page.locator('#bookDataKind').select_option('inventory')
    page.locator('#bookDataFile').set_input_files(SOURCE/'inventory.csv')
    expect(page.locator('#toast')).to_contain_text('Вложен файл inventory.csv')
    button(page,'Запустить Jupyter').click()
    frame=page.frame_locator('#notebookHost iframe')
    first=frame.locator('.jp-CodeCell .cm-content').first
    expect(first).to_contain_text('null = None',timeout=90000)
    # Notebook 7 virtualizes long documents; use its own Run menu.
    frame.get_by_role('menuitem',name='Run',exact=True).click()
    frame.get_by_text('Run All Cells',exact=True).click()
    session=next(s for s in saved_book(url,'list') if s['active'])
    deadline=time.monotonic()+65
    while time.monotonic()<deadline:
        first.click()
        page.keyboard.press('Control+s')
        time.sleep(.65)
        book=saved_book(url,'download/'+session['id'])
        if any('application/vnd.mazzy.fleet+json' in o.get('data',{}) for c in book['cells'] for o in c.get('outputs',[])):
            break
    else:raise AssertionError('Fleet notebook did not persist its verification')
    button(page,'Проверить результат Python').click()
    expect(page.locator('#fields')).to_contain_text('SIM-')
    page.locator('#accept').click()
    expect(page.locator('#dialog')).not_to_be_visible()
    button(page,'Проверить результат Python').click()
    expect(page.locator('#toast')).to_contain_text('база')
    button(page,'Завершить сессию').click()
    page.locator('#accept').click()
    expect(page.locator('#notebookHost iframe')).to_have_count(0,timeout=30000)
    return book


def manual_entry(page):
    button(page,'Создать закупку').click()
    submit(page,{'id':'SPARE','name':'Отдельная закупка'})
    button(page,'Добавить площадку').click()
    submit(page,{'id':'LAB-DC','name':'Лаборатория'})
    button(page,'Добавить тип в парк').click()
    submit(page,{'id':'LAB-SKU','name':'Лабораторный сервер','unitPriceRub':'100','maxBuy':'2'})
    button(page,'Добавить нагрузку').click()
    submit(page,{'id':'LAB-SVC','name':'Тестовая служба'})
    button(page,'Добавить релиз').click()
    submit(page,{'id':'LAB-REL','name':'Испытание'})
    button(page,'Варианты и резерв').click()
    expect(page.locator('#content')).to_contain_text('200 ₽')


def exercise(folder):
    catalog=folder/'catalog.xlsx'
    workbook(catalog)
    project=folder/'work.json'
    cli('init',project,'Закупка для двух ЦОД · учебный парк')
    with studio(project) as url,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=os.getenv('DSM_BROWSER'))
        page=browser.new_page(viewport={'width':1440,'height':1000})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(url+'/#fleet')
        for category,path in [('catalog',catalog),*[(k,SOURCE/(k+'.csv')) for k in ('requirements','specifications','contracts')]]:
            load(page,category,path)
        with page.expect_download() as dl:
            button(page,'Скачать оригинал').first.click()
        assert Path(dl.value.path()).read_bytes()==catalog.read_bytes()
        shutil.copyfile(project,folder/'baseline.json')
        button(page,'Текущий парк').click()
        page.locator('#fleetGroup').select_option('sku')
        page.locator('#fleetLayer').select_option('risk')
        button(page,'В DSM').first.click()
        expect(page.locator('aside')).to_contain_text('Совместимая версия схемы')
        button(page,'К закупке BUY').click()
        for mode in ('Техническая архитектура','Инфраструктурная архитектура','Программная архитектура'):
            button(page,mode).click()
            expect(page.locator('#content svg')).to_be_visible()
            button(page,'Таблица связей').click()
            expect(page.locator('article tbody')).to_contain_text('API-N')
            button(page,'Матрица связей').click()
            expect(page.locator('article table')).to_contain_text('API-N')
            button(page,'Закупка по ЦОД').click()
        button(page,'Записать кластеры').click()
        page.locator('#accept').click()
        expect(page.locator('#dialog')).not_to_be_visible()
        button(page,'Варианты и резерв').click()
        expect(page.locator('#content')).to_contain_text('1 440 000')
        page.screenshot(path=str(folder/'variants.png'),full_page=True)
        button(page,'Задать бюджет').click()
        submit(page,{'rub':'1500000'})
        button(page,'Сохранить вариант в релиз').click()
        submit(page,{'note':'Разместить все реплики локально с проверкой N−1 на обеих площадках.'})
        button(page,'Оформить ADR').click()
        submit(page,{'requirement':'REQ-HA','specification':'SPEC-HA','owner':'Архитектурный совет',
                     'context':'Два независимых ЦОД и различные серверные профили.',
                     'alternatives':'Штатный заказ теряет реплику. Закупка только DENSE стоит дороже.',
                     'rationale':'Выбран минимальный допустимый по цене заказ с N−1.',
                     'consequences':'Шесть новых серверов. Отказ площадки требует отдельного сценария.'})
        expect(page.locator('#content')).to_contain_text('approved')
        shutil.copyfile(project,folder/'two-dc.json')
        with page.expect_download() as package:
            button(page,'Скачать OpenSpec').click()
        package.value.save_as(folder/'procurement-openspec.zip')
        button(page,'Отчёт').click()
        expect(page.locator('#fleetReport')).to_contain_text(hashlib.sha256(catalog.read_bytes()).hexdigest())
        page.evaluate("window.print=()=>window.reportPrinted=document.body.classList.contains('fleet-print')")
        button(page,'Печать / PDF').click()
        assert page.evaluate('window.reportPrinted')
        page.evaluate("document.body.classList.add('fleet-print')")
        page.pdf(path=folder/'two-dc-report.pdf',format='A4',landscape=True,margin={k:'12mm' for k in ('top','bottom','left','right')})
        page.evaluate("document.body.classList.remove('fleet-print')")
        button(page,'ADR и релиз').click()
        button(page,'Внедрить заказ').click()
        page.locator('#accept').click()
        expect(page.locator('#content')).to_contain_text('implemented')
        button(page,'Варианты и резерв').click()
        page.locator('#fleetOption').select_option('asis')
        book=native(page,url)
        (folder/'post-implementation.ipynb').write_text(json.dumps(book,ensure_ascii=False))
        evidence=next(n for n in json.loads(project.read_text())['history'][-1]['data']['nodes'] if n.get('attrs',{}).get('fleetRole')=='simulation')
        assert {'PLAN-1','ADR-1','REL','REQ-HA','SPEC-HA'}<=set(evidence['refs'])
        assert evidence['attrs']['cost']==evidence['attrs']['worst']==0
        assert evidence['attrs']['conforms'] and evidence['attrs']['qualified']==8
        assert evidence['attrs']['inventoryHash']==hashlib.sha256((SOURCE/'inventory.csv').read_bytes()).hexdigest()
        button(page,'Закупка по ЦОД').click()
        button(page,'ADR и релиз').click()
        button(page,'Повторить в Jupyter').click()
        expect(page.locator('#content')).to_contain_text('acceptance-SIM-1.ipynb')
        shutil.copyfile(project,folder/'implemented.json')
        button(page,'Закупка по ЦОД').click()
        manual_entry(page)
        if errors:raise AssertionError(errors)
        browser.close()
    print('PASS · Excel, sources, DSM, three diagrams/tables/matrices, grouping, ADR, release, PDF, native Jupyter and version checks',flush=True)


if __name__=='__main__':
    if os.environ.get('DSM_FLEET_OUTPUT'):
        output=Path(os.environ['DSM_FLEET_OUTPUT'])
        output.mkdir(parents=True,exist_ok=True)
        exercise(output)
    else:
        with tempfile.TemporaryDirectory() as folder:exercise(Path(folder))
