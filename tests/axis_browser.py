"""Load a real NC file, dispatch to the SIL process, capture baselines and verify an executed Notebook 7 report."""
import hashlib
import json
import os
import shutil
import tempfile
import time
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from workbench_browser import ROOT, studio, saved_book, download
from delivery_browser import button, submit


def exercise(page, project, origin, folder):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(origin+'/#machine')
    button(page,'Задание ЧПУ').click()
    source=ROOT/'example/cnc/plate.nc'
    page.locator('#machineJobFile').set_input_files(source)
    expect(page.locator('#machineProgram')).to_have_value(source.read_text())
    button(page,'К решению и испытанию').click()
    expect(page.locator('#toast')).to_contain_text('Сначала сохраните')
    button(page,'Сохранить задание').click()
    expect(page.locator('#toast')).to_contain_text('Версия сохранена')
    button(page,'К решению и испытанию').click()
    expect(page.get_by_role('img',name='Схема команд и обратной связи')).to_be_visible()
    page.locator('#axisAdr summary').click()
    expect(page.locator('#axisAdr')).to_contain_text('Альтернатива')
    package=download(page,button(page,'Пакет OpenSpec'),folder/'axis-openspec.zip')
    with zipfile.ZipFile(package) as z:
        adr=next(n for n in z.namelist() if n.startswith('docs/adr/') and n.endswith('.md'))
        assert '## Альтернатива' in z.read(adr).decode()
    button(page,'Открыть проверку в DSM').click()
    expect(page.locator('#content')).to_contain_text('Совместная проверка замера энкодера')
    page.locator('[data-action=tab][data-id=machine]').first.click()
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    for i,(axis,at) in enumerate([('none',None),('X',1000),('Y',1300),('Z',100)],1):
        page.locator('#axisFault').select_option(axis)
        if at is not None: page.locator('#axisAt').fill(str(at))
        with page.expect_response(lambda r:r.url.endswith('/api/axis-bench')) as response:
            button(page,'Передать в контроллер и испытать').click()
        r=response.value.json()
        assert r['engine']=='node-sil' and r['sha256']==digest and response.value.ok, r
        expect(page.locator('#axisReceipt')).to_have_value('AXRUN-'+str(i))
        expect(page.locator('.axis-status')).to_contain_text('Критерий выполнен')
    select=page.locator('#axisReceipt')
    select.select_option('AXRUN-2')
    section=page.locator('section.card').filter(has=page.get_by_role('heading',name='Протокол испытания'))
    expect(section).to_contain_text('Ось X')
    if os.environ.get('DSM_AXIS_OUTPUT'):
        section.screenshot(path=str(folder/'protocol.png'))
    download(page,button(page,'Скачать досье .md'),folder/'architecture.md')
    report=download(page,button(page,'Отчёт для печати'),folder/'architecture.html')
    assert all(s in (folder/'architecture.md').read_text() for s in ['AXRUN-4','REQ-AXIS','ADR-HOLD',digest])
    check=page.context.new_page()
    check.goto(report.as_uri())
    expect(check.locator('h2').filter(has_text='Свидетельства')).to_be_visible()
    expect(check.locator('tr').filter(has_text='AXRUN-2')).to_contain_text('Критерий выполнен')
    check.close()
    button(page,'План и факт в Jupyter').click()
    expect(page.locator('#bookProfile')).to_have_value('axes')
    download(page,button(page,'Скачать .ipynb'),folder/'source.ipynb')
    button(page,'Запустить Jupyter').click()
    frame=page.frame_locator('#notebookHost iframe')
    expect(frame.locator('.jp-CodeCell .cm-content').first).to_contain_text('null = None',timeout=90000)
    frame.get_by_role('menuitem',name='Run',exact=True).click()
    frame.get_by_text('Run All Cells',exact=True).click()
    expect(frame.locator('.jp-CodeCell .jp-OutputArea').last).to_contain_text('Заключение по осям готово',timeout=90000)
    session=next(s for s in saved_book(origin,'list') if s['active'])
    for _ in range(25):
        save=frame.locator('button[data-command="docmanager:save"],button[title^="Save"]').first
        if save.is_visible() and save.is_enabled(): save.click()
        else:
            frame.locator('.jp-CodeCell .cm-content').first.click()
            page.keyboard.press('Control+s')
        time.sleep(.4)
        book=saved_book(origin,'download/'+session['id'])
        if all(c.get('execution_count') for c in book['cells'] if c['cell_type']=='code'):break
    else: raise AssertionError('Native notebook did not persist cell outputs')
    (folder/'axis-fault.ipynb').write_text(json.dumps(book,ensure_ascii=False,indent=1)+'\n')
    cells={c['id']:c for c in book['cells']}
    chart=next(o['data']['image/svg+xml'] for o in cells['axis-plots']['outputs'] if 'image/svg+xml' in o.get('data',{}))
    (folder/'axis-fault.svg').write_text(''.join(chart))
    result=cells['result']['outputs'][0]['data']['application/vnd.mazzy.axis+json']
    assert result['runId']=='AXRUN-2' and result['sha256']==digest and result['values'][-1]=='passed'
    shutil.copyfile(project,folder/'notebook-base.json')
    button(page,'Проверить результат Python').click()
    expect(page.locator('#fields')).to_contain_text('AXREPORT-1')
    submit(page,{})
    expect(page.locator('#dialog')).not_to_be_visible()
    button(page,'Завершить сессию').click()
    page.locator('#accept').click()
    expect(page.locator('#notebookHost iframe')).to_have_count(0,timeout=30000)
    page.locator('[data-action=tab][data-id=machine]').first.click()
    button(page,'Оформить обзор SIL').click()
    submit(page,{'owner':'Инженер учебного стенда','conclusion':'Штатный ход и три внесённых отказа соответствуют критериям SIL. Проверка физической остановки остаётся в плане приёмки.'})
    expect(button(page,'AXREVIEW-1')).to_be_visible()
    shutil.copyfile(project,folder/'verified.json')
    download(page,button(page,'Скачать досье .md'),folder/'architecture.md')
    download(page,button(page,'Отчёт для печати'),folder/'architecture.html')
    download(page,button(page,'Пакет OpenSpec'),folder/'axis-openspec.zip')
    check=page.context.new_page()
    check.goto((folder/'architecture.html').as_uri())
    expect(check.locator('body')).to_contain_text('AXREVIEW-1')
    if os.environ.get('DSM_AXIS_OUTPUT'):
        check.pdf(path=str(folder/'architecture.pdf'),print_background=True,prefer_css_page_size=True)
    check.close()
    page.locator('#axisAdr summary').click()
    button(page,'Редактировать ADR').click()
    submit(page,{'rationale':'Новая редакция для повторной экспертизы'})
    expect(page.locator('.axis-status')).to_contain_text('Архивная конфигурация')
    expect(page.locator('#content')).to_contain_text('Ожидает испытания')
    download(page,button(page,'Документ этого прогона'),folder/'historical.md')
    assert 'Новая редакция для повторной экспертизы' not in (folder/'historical.md').read_text()
    assert not errors, errors
    from workbench_browser import cli
    standalone=folder/'acceptance.html'
    if standalone.exists(): standalone.unlink()
    cli('export',folder/'verified.json',standalone)
    offline=page.context.new_page()
    offline.set_viewport_size({'width':390,'height':844})
    offline.goto(standalone.as_uri())
    button(offline,'Испытания и ADR').click()
    button(offline,'Передать в контроллер и испытать').click()
    expect(offline.locator('#axisReceipt')).to_have_value('AXRUN-5',timeout=15000)
    expect(offline.locator('#content')).to_contain_text('worker-sil')
    assert offline.evaluate('document.documentElement.scrollWidth <= innerWidth')
    offline.close()


if __name__=='__main__':
    with tempfile.TemporaryDirectory() as tmp:
        folder=Path(os.environ.get('DSM_AXIS_OUTPUT',tmp))
        folder.mkdir(parents=True,exist_ok=True)
        project=Path(tmp)/'machine.json'
        shutil.copyfile(ROOT/'example/cnc/machine.dsm.json',project)
        with studio(project) as origin,sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.getenv('DSM_BROWSER'))
            context=browser.new_context(accept_downloads=True)
            exercise(context.new_page(),project,origin,folder)
            browser.close()
    print('CNC transfer, four SIL scenarios, architecture dossier, native Jupyter and ADR revision verified.')
