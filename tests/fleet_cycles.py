"""Two runs of five independent end-to-end scenarios. Set DSM_FLEET_OUTPUT to keep receipts."""
import csv
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from playwright.sync_api import expect, sync_playwright
from fleet_browser import SOURCE, workbook
from workbench_browser import ROOT, cli, studio


def read(path):
    return json.loads(path.read_text())


def json_cli(*args):
    return json.loads(cli(*args))


def input_project(folder):
    path=folder/'input.json'
    cli('init',path,'Учебная закупка двух ЦОД')
    workbook(folder/'catalog.xlsx')
    for k in ('catalog','requirements','specifications','contracts'):
        file=folder/'catalog.xlsx' if k=='catalog' else SOURCE/(k+'.csv')
        preview=json_cli('source-preview',path,k,file,'BUY')
        assert preview['changes']
        cli('source-import',path,k,file,'BUY',preview['base'],'Аналитик','Загрузка '+file.name)
    return path


def run_book(folder,project,params,export=False):
    template=folder/'template.ipynb'
    cli('notebook',project,template,'fleet','BUY')
    book=nbformat.read(template,4)
    cell=next(c for c in book.cells if c.id=='parameters')
    cell.source+='\n'+'\n'.join(k+' = '+repr(v) for k,v in params.items())
    if export:cell.source+='\nexport_directory = "export"'
    NotebookClient(book,timeout=90,kernel_name='python3').execute(cwd=folder)
    failed=[o for c in book.cells for o in c.get('outputs',[]) if o.output_type=='error']
    assert not failed,failed
    out=folder/'result.ipynb';nbformat.write(book,out)
    mime='application/vnd.mazzy.fleet+json'
    lab=next(o.data[mime]['lab'] for c in book.cells for o in c.get('outputs',[]) if mime in o.get('data',{}))
    return out,lab


def check_rejection(*args):
    proc=subprocess.run(['node',ROOT/'dsm.cjs',*map(str,args)],capture_output=True,text=True)
    assert proc.returncode!=0,(args,proc.stdout[:260])
    return json.loads(proc.stderr)['error']


def run(folder):
    base=input_project(folder)
    # Expected values are independent purchase acceptance criteria.
    cases=[
      ('01-mixed-stock',dict(variant_key='asis'),0,3),
      ('02-steady-state',dict(variant_key='normal'),900000,1),
      ('03-each-host',dict(variant_key='resilient',failed_host='NORTH-STD#1'),1440000,0),
      ('04-dense-only',dict(variant_key='sku:DENSE',group_by='sku'),2100000,0),
      ('05-budget',dict(budget_rub=1439999),1440000,0),
      ('06-source-roundtrip',dict(source_files=[('catalog',str(folder/'catalog.xlsx'))]),1440000,0),
      ('07-new-price',dict(attribute_edits={'DENSE':{'unitPriceRub':220000}}),1100000,0),
      ('08-local-shortage',dict(variant_key='asis',attribute_edits={'NORTH-DENSE':{'maxBuy':0},'NORTH-STD':{'maxBuy':0},'SOUTH-STD':{'quantity':4}}),0,3),
      ('09-manual',dict(variant_key='manual',manual_order={'NORTH-STD':3,'SOUTH-STD':3},group_by='cluster'),1440000,0),
      ('10-inventory',dict(inventory_file='inventory.csv'),1440000,0)]
    receipts=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=os.getenv('DSM_BROWSER'))
        for case,params,cost,worst in cases:
            work=folder/case;work.mkdir()
            project=work/'project.json';shutil.copyfile(base,project)
            if case.startswith('10'):
                (work/'inventory.csv').write_text('serial,pool,cpuCores,ramGiB,diskGiB\nSN1,NORTH-STD,8,32,400\nSN2,SOUTH-DENSE,16,48,1000\n')
                (work/'spec-extra.md').write_text('# Проверка ОЗУ\nИзмерить каждое шасси.')
                params={**params,'specification_requirement':'REQ-HA','source_files':[('specifications','spec-extra.md')]}
            out,lab=run_book(work,project,params,True)
            assert (lab['cost'],lab['worst'])==(cost,worst),(case,lab['cost'],lab['worst'])
            preview=json_cli('import-preview',project,out,'result')
            diff=[r['key'] for r in preview['changes']]
            if case[:2] in ('01','02','03','04','05','06','09'):assert diff==['SIM-1'],(case,diff)
            if case.startswith('07'):assert diff==['DENSE','SIM-1'],diff
            if case.startswith('10'):
                sim=preview['changes'][-1]['after'];assert sim['attrs']['qualified']==1 and not sim['attrs']['conforms']
                spec=next(r['after'] for r in preview['changes'] if r['key']=='SPEC-1');assert 'REQ-HA' in spec['refs']
            cli('import',project,out,preview['base'],'Jupyter','Проверка '+case,'result')
            assert 'база' in check_rejection('import-preview',project,out,'result').lower()
            with zipfile.ZipFile(work/'export/analysis.zip') as z:
                entries=z.namelist();variants=json.loads(z.read('variants.json'))
                assert len([n for n in entries if n.startswith('charts/')])>=2
                assert z.read('sources/SOURCE-1-catalog.xlsx')==(folder/'catalog.xlsx').read_bytes()
                if case.startswith('08'):assert not variants['resilient']['available']
                if case.startswith('05'):assert 'Пересогласовать бюджет' in z.read('report.html').decode()
            with studio(project) as url:
                page=browser.new_page();page.goto(url+'/#fleet')
                page.locator('[data-action=fleetStep][data-id=stock]').click()
                page.locator('#fleetLayer').select_option('risk')
                page.get_by_role('button',name='В DSM',exact=True).first.click()
                expect(page.locator('aside')).to_contain_text('Совместимая версия схемы')
                page.get_by_role('button',name='К закупке BUY',exact=True).click()
                page.get_by_role('button',name='Инфраструктурная архитектура',exact=True).click()
                expect(page.locator('article svg')).to_be_visible()
                page.get_by_role('button',name='Таблица связей',exact=True).click()
                expect(page.locator('article table')).to_contain_text('NORTH-STD')
                page.close()
            receipts.append(dict(case=case,option=lab['key'],cost=cost,worst=worst,hosts_checked=len(lab['failures']),changed=diff,revision=read(project)['history'][-1]['rev']))
            print('PASS',case,cost,worst,diff,flush=True)
        browser.close()
    (folder/'cycles.json').write_text(json.dumps(receipts,indent=2,ensure_ascii=False))


if __name__=='__main__':
    if os.environ.get('DSM_FLEET_OUTPUT'):
        folder=Path(os.environ['DSM_FLEET_OUTPUT']);folder.mkdir(parents=True,exist_ok=True);run(folder)
    else:
        with tempfile.TemporaryDirectory() as scratch:run(Path(scratch))
