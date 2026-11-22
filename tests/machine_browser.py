"""Exercise the CNC operator's workflow against a served model and a real Python kernel."""
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from playwright.sync_api import sync_playwright, expect

from delivery_browser import button, submit
from workbench_browser import ROOT, capture, download, saved_book, studio


def run(page, url, project, folder):
    issues = []
    page.on('pageerror', lambda err: issues.append(str(err)))
    page.goto(url)
    machine = lambda: page.locator('[data-action="tab"][data-id="machine"]').first.click()
    expect(page.get_by_role('heading', name='Состав изделия')).to_be_visible()
    expect(page.locator('#content')).to_contain_text('BUILD-REC')
    button(page, 'Программная архитектура').click()
    expect(page.locator('#graphMode')).to_have_value('software')
    expect(page.locator('#content svg').first).to_be_visible()
    machine()
    button(page, 'Интерфейсы и матрицы').click()
    expect(page.locator('#content')).to_contain_text('IF-CAM')
    page.locator('#machineLayer').select_option('risk')
    page.locator('#machineOrder').select_option('groups')
    expect(page.locator('.machine-matrix tr')).to_have_count(18)
    capture(page, 'cnc-matrix.png')
    page.get_by_role('button', name='VIEW → REC', exact=True).click()
    expect(page.locator('#content')).to_contain_text('Единый формат блока')
    machine()
    button(page, 'Задание ЧПУ').click()
    button(page, 'Проверить траекторию').click()
    expect(page.get_by_role('img', name='Траектория программы, проекция XY')).to_be_visible()
    capture(page, 'cnc-path.png')
    page.locator('#machineProgram').fill('G21\nG90\nG0 X9000')
    button(page, 'Проверить траекторию').click()
    expect(page.locator('#toast')).to_contain_text('Строка 3')
    expect(page.locator('.machine-plot')).to_have_count(0)
    program = 'G21\nG90\nG0 Z10\nG1 X15 Y20 F300'
    page.locator('#machineJobFile').set_input_files({'name':'case.nc','mimeType':'text/plain','buffer':program.encode()})
    expect(page.locator('#machineProgram')).to_have_value(program)
    button(page, 'Сохранить задание').click()
    expect(page.locator('#toast')).to_contain_text('верси', ignore_case=True)
    page.reload()
    button(page, 'Задание ЧПУ').click()
    expect(page.locator('#machineProgram')).to_have_value(program)
    button(page, 'Диагностика').click()
    expect(page.locator('.sizing-metrics')).to_contain_text('NOR4')
    button(page, 'Изменить окно записи').click()
    submit(page, {'seconds':'20','criterion':'Оба потока покрывают 20 секунд'})
    expect(page.locator('.sizing-metrics')).to_contain_text('NOR8')
    trace = download(page, button(page, 'Скачать тестовый VIB1'), folder/'record.vib')
    assert trace.stat().st_size == 6541504
    page.locator('#machineTrace').set_input_files(trace)
    expect(page.get_by_role('img', name='Осциллограмма первого канала')).to_be_visible()
    expect(page.locator('#content')).to_contain_text('Окно подтверждено')
    button(page, 'Открыть сигнал в Jupyter').click()
    attached = download(page, button(page, 'Скачать .ipynb'), folder/'signal.ipynb')
    signal = nbformat.read(attached, as_version=4)
    NotebookClient(signal, kernel_name='python3', timeout=60).execute(cwd=folder)
    analysis = next(c for c in signal.cells if c.id=='vib1-analysis')
    assert any('Полное окно: True' in o.get('text','') for o in analysis.outputs)
    assert any('image/svg+xml' in o.get('data',{}) for o in analysis.outputs)
    machine()
    button(page, 'Сохранить протокол файла').click()
    expect(button(page,'TRACE-1')).to_be_visible()
    data = bytearray(trace.read_bytes())
    data[39] ^= 1
    page.locator('#machineTrace').set_input_files({'name':'broken.vib','mimeType':'application/octet-stream','buffer':bytes(data[:4096])})
    expect(page.locator('#toast')).to_contain_text('CRC')
    button(page, 'Пересчитать в Jupyter').click()
    expect(page.locator('#bookProfile')).to_have_value('machine')
    file = download(page, button(page, 'Скачать .ipynb'), folder/'machine.ipynb')
    book = nbformat.read(file, as_version=4)
    NotebookClient(book, kernel_name='python3', timeout=60).execute(cwd=folder)
    nbformat.write(book, file)
    assert any('image/svg+xml' in o.get('data',{}) for c in book.cells for o in c.get('outputs',[]))
    page.locator('#bookFile').set_input_files(file)
    expect(page.locator('#content')).to_contain_text('machine.ipynb')
    button(page, 'Проверить результат Python').click()
    expect(page.locator('#fields')).to_contain_text('CALC-1')
    submit(page, {})
    expect(page.locator('#dialog')).not_to_be_visible()
    button(page, 'Проверить результат Python').click()
    expect(page.locator('#dlgTitle')).to_have_text('Расчёт устарел')
    expect(page.locator('#fields')).to_contain_text('CALC-1')
    page.locator('#accept').click()
    expect(page.locator('#content')).to_contain_text('Текущая ревизия')
    nodes = {n['id']:n for n in json.loads(project.read_text())['history'][-1]['data']['nodes']}
    assert nodes['CALC-1']['attrs']['bytes'] == 6541504
    assert nodes['TRACE-1']['attrs']['complete'] and len(nodes['TRACE-1']['attrs']['sha256']) == 64
    button(page, 'Запустить Jupyter').click()
    frame = page.frame_locator('#notebookHost iframe')
    first = frame.locator('.jp-CodeCell .cm-content').first
    expect(first).to_contain_text('null = None', timeout=90000)
    frame.get_by_role('menuitem', name='Run', exact=True).click()
    frame.get_by_text('Run All Cells', exact=True).click()
    expect(frame.locator('.jp-CodeCell .jp-OutputArea').last).to_contain_text('Готов к проверке DSM', timeout=75000)
    session = next(s for s in saved_book(url, 'list') if s['active'])
    save = frame.locator('button[data-command="docmanager:save"],button[title^="Save"]').first
    for _ in range(25):
        if save.is_visible() and save.is_enabled():
            save.click()
        else:
            first.click()
            page.keyboard.press('Control+s')
        time.sleep(.4)
        native = saved_book(url, 'download/'+session['id'])
        if all(c.get('execution_count') for c in native['cells'] if c['cell_type']=='code'):
            break
    else:
        raise AssertionError('Notebook 7 did not save all executed CNC cells')
    button(page, 'Проверить результат Python').click()
    expect(page.locator('#fields')).to_contain_text('CALC-2')
    page.locator('#cancel').click()
    button(page,'Завершить сессию').click()
    page.locator('#accept').click()
    expect(page.locator('#notebookHost iframe')).to_have_count(0, timeout=30000)
    assert not issues, issues


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        project = folder/'machine.json'
        shutil.copyfile(ROOT/'example/cnc/machine.dsm.json', project)
        with studio(project) as url, sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.getenv('DSM_BROWSER'))
            run(browser.new_page(accept_downloads=True), url, project, folder)
            browser.close()
    print('CNC UI, firmware contract, real Python result and conflict review passed.')
