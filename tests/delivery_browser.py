"""Real UI from an empty model to deployment and a cross-window DSM lookup."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from workbench_browser import ROOT, cli, studio

def button(page, name):
    return page.get_by_role("button",name=name,exact=True)

def submit(page, values):
    for key,value in values.items():
        el=page.locator('#fields [name="'+key+'"]')
        if el.evaluate("x=>x.tagName")=="SELECT": el.select_option(value)
        else: el.fill(value)
    page.locator("#accept").click()

def journey(page,project):
    expect(page.get_by_role('navigation',name='Меню проекта')).to_be_visible()
    button(page,'Новое требование').click()
    submit(page,dict(name='Память для поставок',need='Пиковая нагрузка',when='После установки',then='32 ГиБ',owner='Анна',due='2026-01-01'))
    button(page,'Создать запрос').click();submit(page,{})
    button(page,'Разобрать запрос').click();submit(page,{'reason':'Одобрено'})
    button(page,'Подготовить предложение').click();submit(page,{})
    button(page,'Записать решение ADR').click();submit(page,{'choice':'Расширить ОЗУ','effects':'Окно обслуживания'})
    button(page,'Создать первый релиз').click();submit(page,{'name':'Пилот','capacity':'4'})
    button(page,'Запланировать работу').click()
    page.locator('[name=effort]').fill('2');expect(page.locator('#journeyCapacity')).to_contain_text('0 → 2 / 4')
    submit(page,{'name':'Закупка'})
    button(page,'Добавить работу').click();submit(page,{'name':'Установка','effort':'3','after':'WORK-1'})
    button(page,'Новый релиз').click();submit(page,{'name':'Расширение','capacity':'8'})
    button(page,'Релизы и фичи').click()
    work=page.locator('tr').filter(has_text='WORK-2')
    work.get_by_role('button',name='Перенести работу').click();submit(page,{'release':'REL-2'})
    expect(page.locator('#fields')).to_contain_text('REL-2')
    page.locator('#accept').click()
    expect(work).to_contain_text('REL-2')
    button(page,'Маршрут изменения').click()
    finish=button(page,'Завершить работу')
    finish.nth(1).click();submit(page,{});expect(page.locator('#formError')).to_contain_text('WORK-1');page.locator('#cancel').click()
    finish.first.click();submit(page,{});finish.first.click();submit(page,{})
    button(page,'Применить изменение').click()
    submit(page,{'target':'S-1','targetName':'Сервер','attribute':'memoryGiB','type':'number','value':'32'})
    expect(page.locator('#dialog .diff-table')).to_contain_text('S-1')
    page.locator('#accept').click()
    button(page,'Подтвердить внедрение').click()
    submit(page,{'environment':'Пром','outcome':'failed','evidence':'Паспорт показывает 16 ГиБ'})
    expect(page.locator('#content')).to_contain_text('DEV-1')
    button(page,'Повторная проверка').click();submit(page,{'evidence':'После перезапуска 32 ГиБ'})
    expect(page.locator('#content')).to_contain_text('Внедрение подтверждено')
    with page.expect_download() as trace:button(page,'Отчёт .md').click()
    assert 'DEV-1' in Path(trace.value.path()).read_text()
    page.get_by_text('Очередь требований',exact=False).first.click()
    page.locator('#journeyOwner').select_option('Анна');page.locator('#journeyStage').select_option('done')
    page.locator('#journeyLate').check();expect(page.locator('.journey-queue')).to_contain_text('Подходящих требований нет')
    page.locator('#journeyLate').uncheck()
    with page.expect_download() as queue:button(page,'CSV очереди').click()
    assert 'Память для поставок' in Path(queue.value.path()).read_text()
    button(page,'Ссылка на требование').click()
    url=page.locator('[name=link]').input_value()
    page.locator('#accept').click()
    button(page,'Каталог').click()
    page.goto(url);expect(page.locator('#content')).to_contain_text('После перезапуска 32 ГиБ')
    button(page,'✓ Работы').click();expect(page.locator('[data-trace="Работы релиза"] h4')).to_be_focused()
    model=json.loads(cli('show',project))['data']
    assert next(n for n in model['nodes'] if n['id']=='S-1')['attrs']['memoryGiB']==32
    folder=os.environ.get('DSM_QA_IMAGES')
    if folder:
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(Path(folder)/'delivery-workflow.png'))
    if os.environ.get('DSM_QA_EXPORTS'):
        output=Path(os.environ['DSM_QA_EXPORTS'])/'delivery-example.html'
        cli('export',project,output)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('#projectMenu summary').click()
    expect(page.locator('#content h2').first).to_be_visible()
    print('Verified the complete journey, ten workflow capabilities, deep link and mobile menu.',flush=True)

def matrix(page):
    button(page,'Матрица').click()
    expect(page.locator('.matrix .cell')).to_have_count(1024)
    page.locator('#rowJump').fill('EA-01188');page.locator('#colJump').fill('EA-01199')
    button(page,'Найти ячейку').click()
    expect(page.locator('.matrix .active')).to_have_attribute('aria-label','EA-01188 / EA-01199 / 1')
    expect(page.locator('aside')).to_contain_text('Передача заявки')
    button(page,'На граф').click();expect(page.locator('svg')).to_contain_text('EA-01199')
    button(page,'В матрицу').click()
    expect(page.locator('.matrix .active')).to_have_attribute('data-id','EA-01188')
    page.locator('#rowJump').fill('EA-00000');page.locator('#colJump').fill('EA-01199')
    button(page,'Найти ячейку').click();expect(page.locator('.matrix .active')).to_have_attribute('aria-label','EA-00000 / EA-01199 / 0')
    page.locator('.matrix .active').focus();page.keyboard.press('Home')
    expect(page.locator('.matrix .cell:focus')).to_have_attribute('data-to','EA-00000')
    page.keyboard.press('End');expect(page.locator('.matrix .cell:focus')).to_have_attribute('data-to','EA-01199')
    button(page,'На граф').click();page.locator('#graphMode').select_option('all')
    button(page,'Граничные связи').click()
    crossing=page.locator('#content article table button[data-action=cell]').first
    a,b=crossing.get_attribute('data-id'),crossing.get_attribute('data-to')
    crossing.click()
    for endpoint in (a,b):
        expect(page.locator('svg g[data-action=focus][data-id="'+endpoint+'"]')).to_have_count(1)
    button(page,'В матрицу').click()
    expect(page.locator('.matrix .active')).to_have_attribute('data-id',a)
    expect(page.locator('.matrix .active')).to_have_attribute('data-to',b)
    button(page,'На граф').click();page.locator('#graphMode').select_option('sequence')
    button(page,'Далее · Сообщения').click()
    expect(page.locator('svg text').filter(has_text='41. Передача заявки').first).to_be_visible()
    button(page,'Версии').click();page.get_by_text('Фильтры истории').click()
    page.locator('#history-object').select_option('EA-01199');expect(page.locator('#content tbody tr')).to_have_count(11)
    print('Verified 1200-object catalog, far coordinates, matrix–graph return and 11 matching revisions.',flush=True)

def main():
    import subprocess
    with tempfile.TemporaryDirectory() as directory,sync_playwright() as pw:
        root=Path(directory);project=root/'empty.json';cli('init',project,'Внедрение')
        browser=pw.chromium.launch(executable_path=os.environ.get('DSM_BROWSER'))
        for file,check in [(project,lambda page:journey(page,project)),(root/'large.json',matrix)]:
            if file!=project:subprocess.run(['node',ROOT/'tests/enterprise_catalog.cjs','1200','32',file],check=True)
            with studio(file) as url:
                page=browser.new_page(viewport={'width':1440,'height':900})
                errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
                page.goto(url);check(page);assert not errors,errors;page.close()
        browser.close()

if __name__=='__main__': main()
