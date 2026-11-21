"""Purchase to acceptance in real Chrome and native Notebook 7, using a separate project."""
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

import nbformat
from playwright.sync_api import sync_playwright, expect
from delivery_browser import button, submit
from workbench_browser import ROOT, cli, studio, saved_book

SOURCE = ROOT / 'example/server-procurement.xlsx'


def import_catalog(page):
    button(page,'Обмен').click()
    page.locator('#file').set_input_files(SOURCE)
    expect(page.locator('#dialog')).to_contain_text('12 объектов · 2 связей')
    page.locator('#accept').click()
    button(page,'Расчёт инсталляций').click()
    expect(page.locator('.sizing-metrics')).to_contain_text('960')
    expect(page.locator('.sizing-bars')).to_contain_text('144 / 192')
    assert page.locator('.sizing-bars meter').count()==3
    coverage=page.locator('section.card').filter(has=page.get_by_role('heading',name='Покрытие функций'))
    expect(coverage.locator('tbody tr')).to_have_count(2)
    expect(coverage.locator('tbody tr').first).to_contain_text('REQ-CAP')
    expect(coverage.locator('tbody tr').first).to_contain_text('API')
    with page.expect_download() as download:button(page,'Скачать размещение CSV').click()
    assert 'DB' in Path(download.value.path()).read_text()
    button(page,'Параметры').click()
    submit(page,{'spareHosts':'2'})
    expect(page.locator('#dialog')).to_contain_text('spareHosts')
    page.locator('#cancel').click()
    button(page,'Изменить нагрузку').first.click()
    page.locator('#cancel').click()


def delivery(page):
    button(page,'Маршрут изменения').click()
    button(page,'Создать запрос').click();submit(page,{})
    button(page,'Разобрать запрос').click();submit(page,{'reason':'Согласовано резервирование на одной площадке'})
    button(page,'Подготовить предложение').click();submit(page,{})
    button(page,'Записать решение ADR').click()
    submit(page,{'choice':'Два рабочих сервера и один резервный','effects':'Купить два сервера, один уже доступен'})
    button(page,'Создать первый релиз').click();submit(page,{'name':'Поставка и ввод в ЦОД','capacity':'8'})
    button(page,'Запланировать работу').click();submit(page,{'name':'Закупить и установить узлы','effort':'3'})
    button(page,'Завершить работу').click();submit(page,{})
    button(page,'Применить изменение').click()
    submit(page,{'target':'INST','attribute':'approvedHosts','type':'number','value':'3'})
    expect(page.locator('#dialog')).to_contain_text('approvedHosts');page.locator('#accept').click()
    expect(page.locator('#content')).to_contain_text('Проверка внедрения')


def diagrams(page):
    button(page,'Граф и схема').click()
    page.locator('#graphMode').select_option('technical')
    button(page,'Добавить архитектурную связь').click();submit(page,{'from':'PROC','relation':'uses','to':'HOST'})
    expect(page.locator('#dialog')).to_contain_text('HOST');page.locator('#accept').click()
    button(page,'Изменить архитектурную связь').click();submit(page,{'relation':'dependsOn'});page.locator('#accept').click()
    expect(page.locator('article svg [data-id=PROC][data-to=HOST][data-layer=dependsOn]')).to_have_count(1)
    for mode,source,target,relation in [('technical','WORK-1','REL-1','release'),('infra','INST','HOST','uses'),('software','API','FN-ORDER','realizes')]:
        page.locator('#graphMode').select_option(mode)
        selector=f'[data-id="{source}"][data-to="{target}"][data-layer="{relation}"]'
        edge=page.locator('article svg '+selector)
        expect(edge).to_have_count(1)
        edge.focus();page.keyboard.press('Enter')
        button(page,'В реестр архитектурных связей').click()
        expect(page.locator('article tr.selected')).to_contain_text(source)
        button(page,'Вернуться на схему').click()
        expect(page.locator('#graphMode')).to_have_value(mode)
        for label in ('Таблица связей','Матрица связей'):
            button(page,label).click()
            el=page.locator('article table '+selector).first
            el.click();expect(page.locator('aside .callout')).to_contain_text(target)
        with page.expect_download() as csv:button(page,'CSV связей').click()
        data=Path(csv.value.path()).read_text(encoding='utf-8-sig')
        assert source in data and target in data and relation in data
        button(page,'Схема').click()
        with page.expect_download() as svg:button(page,'Скачать SVG').click()
        assert source in Path(svg.value.path()).read_text()
    button(page,'Совместные проверки').click()
    button(page,'Матрица связей').click()
    page.locator('article table [data-id=API][data-to=DB][data-layer=risk]').last.click()
    expect(page.locator('aside .callout')).to_contain_text('Совместимая версия')
    button(page,'В матрицу').click()
    expect(page.locator('.matrix .active')).to_have_attribute('aria-label','API / DB / 3')


def verify(page,url,count,folder):
    button(page,'Маршрут изменения').click();button(page,'Проверить в Jupyter').click()
    expect(page.get_by_role('heading',name='installation-INST.ipynb')).to_be_visible()
    button(page,'Запустить Jupyter').click()
    frame=page.frame_locator('#notebookHost iframe')
    cells=frame.locator('.jp-CodeCell')
    expect(cells.first.locator('.cm-content')).to_contain_text('null = None',timeout=90000)
    inventory=[{'id':'SN-'+str(i+1),'cpuCores':16,'ramGiB':96,'diskGiB':800} for i in range(count)]
    for i in range(5):
        cell=cells.nth(i);editor=cell.locator('.cm-content')
        editor.click()
        if i==3:
            page.keyboard.press('Control+a')
            page.keyboard.insert_text('environment = "ЦОД / пром"\nactor = "Комиссия"\nsource = "Синтетическая ведомость приёмки"\ninventory = '+json.dumps(inventory))
        page.keyboard.press('Control+Enter')
        expect(cell.locator('.jp-InputPrompt')).to_contain_text('['+str(i+1)+']',timeout=45000)
    expect(cells.nth(2).locator('.jp-OutputArea')).to_contain_text('Узлов 3, резерв 1, закупить 2')
    expect(cells.nth(2).locator('.jp-OutputArea svg, .jp-OutputArea img')).not_to_have_count(0)
    expect(cells.last.locator('.jp-OutputArea')).to_contain_text('Соответствуют профилю '+str(count)+' из 3')
    page.keyboard.press('Control+s')
    session=next(s for s in saved_book(url,'list') if s['active'])
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
        book=saved_book(url,'download/'+session['id'])
        if any('application/vnd.mazzy.installation+json' in o.get('data',{}) for c in book['cells'] for o in c.get('outputs',[])):break
        time.sleep(.2)
    else:raise AssertionError('Notebook did not persist the measured inventory')
    nbformat.validate(nbformat.from_dict(book))
    outputs=[o.get('data',{}) for c in book['cells'] for o in c.get('outputs',[])]
    assert sum('image/svg+xml' in data for data in outputs)==2
    assert sum('text/html' in data for data in outputs)>=2
    (folder/f'acceptance-{count}.ipynb').write_text(json.dumps(book,ensure_ascii=False,indent=2))
    button(page,'Проверить результат Python').click();expect(page.locator('#dialog')).to_contain_text('OBS-')
    page.locator('#accept').click()
    button(page,'Проверить результат Python').click();expect(page.locator('#toast')).to_contain_text('база')
    button(page,'Завершить сессию').click();page.locator('#accept').click()
    button(page,'Маршрут изменения').click()


def new_installation(page):
    button(page,'Расчёт инсталляций').click();button(page,'Новая инсталляция').click()
    submit(page,{'name':'Склад','environment':'Тест','cpuCores':'8','ramGiB':'32','diskGiB':'100','unitPriceRub':'200'})
    page.locator('#accept').click();expect(page.locator('#content')).to_contain_text('назначьте хотя бы одну нагрузку')
    button(page,'Назначить нагрузку').click()
    submit(page,{'id':'WARE','name':'Сервис склада','replicas':'2','cpuCores':'3','ramGiB':'8','diskGiB':'20','apart':'yes'})
    expect(page.locator('.sizing-metrics')).to_contain_text('600')
    button(page,'Параметры').click();submit(page,{'existingHosts':'1'});page.locator('#accept').click()
    expect(page.locator('.sizing-metrics')).to_contain_text('400')


def main():
    with tempfile.TemporaryDirectory() as scratch,sync_playwright() as pw:
        folder=Path(scratch);project=folder/'procurement.json'
        cli('init',project,'Закупка серверов для платформы заявок')
        with studio(project) as url:
            browser=pw.chromium.launch(executable_path=os.environ.get('DSM_BROWSER'))
            page=browser.new_page(viewport={'width':1440,'height':940})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(url);import_catalog(page);delivery(page);diagrams(page)
            verify(page,url,2,folder);expect(page.locator('#content')).to_contain_text('DEV-1')
            verify(page,url,3,folder);expect(page.locator('#content')).to_contain_text('Внедрение подтверждено')
            button(page,'Jupyter Notebook').click();page.locator('#bookFile').set_input_files(folder/'acceptance-3.ipynb')
            expect(page.locator('#bookCells .book-chart')).to_have_count(2)
            expect(page.locator('#bookCells table')).to_have_count(2)
            trace=json.loads(cli('journey',project,'REQ-CAP'))
            assert [o['attrs']['qualifiedHosts'] for o in trace['observations']]==[2,3]
            assert trace['findings'][0]['state']=='done'
            assert all({'ADR-1','REL-1','REQ-CAP','INST','HOST','API','DB'}<=set(o['refs']) for o in trace['observations'])
            plan=json.loads(cli('installation',project,'INST'))
            assert plan['totals']==[28,144,1160] and plan['budget']==960000
            button(page,'Расчёт инсталляций').click();expect(page.locator('#content')).to_contain_text('OBS-2')
            button(page,'OBS-1').first.click();button(page,'Воспроизвести проверку в Jupyter').click()
            expect(page.get_by_role('heading',name='acceptance-OBS-1.ipynb')).to_be_visible()
            replay=page.locator('#bookCells .cell-preview').filter(has_text='SN-1').last
            expect(replay).to_contain_text('SN-2');expect(replay).not_to_contain_text('SN-3')
            button(page,'Расчёт инсталляций').click()
            out=os.environ.get('DSM_PROCUREMENT_EXPORTS')
            if out:
                dest=Path(out);dest.mkdir(exist_ok=True,parents=True)
                for source in [project,folder/'acceptance-2.ipynb',folder/'acceptance-3.ipynb']:shutil.copy2(source,dest/source.name)
                page.evaluate('window.scrollTo(0,0)')
                page.wait_for_function("!document.querySelector('#toast').textContent")
                page.screenshot(path=str(dest/'installation.png'))
            assert not errors,errors
            second=folder/'new.json';cli('init',second,'Новая установка')
            with studio(second) as other:
                page.goto(other);new_installation(page)
            assert not errors,errors
            browser.close()
    print('Verified Excel, 3 diagrams as SVG/table/matrix, DSM, ADR, release, sizing, two native Jupyter receipts and stale rejection.',flush=True)

if __name__=='__main__':main()
