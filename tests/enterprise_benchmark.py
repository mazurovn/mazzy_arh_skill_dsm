"""Measure actual DOM interaction to the second animation frame in standalone Chrome."""
import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def measure(page, selector, value=None):
    return page.evaluate("""async ([selector,value])=>{
      const t=performance.now(), el=document.querySelector(selector);
      if(!el)throw Error('Missing '+selector);
      if(value===null)el.click();
      else {el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
      void document.body.offsetHeight;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return Math.round(performance.now()-t);
    }""", [selector,value])


def benchmark(args):
    with tempfile.TemporaryDirectory() as directory:
        folder=Path(directory)
        fixture=folder/'catalog.json'
        subprocess.run(['node',ROOT/'tests/enterprise_catalog.cjs',str(args.objects),str(args.revisions),fixture],check=True)
        model=fixture.read_text()
        template=Path(args.html).read_text()
        # Isolate each view from the old quadratic startup so graph and history can be measured independently.
        assert "let tab='matrix'" in template
        if not args.startup_only:
            template=template.replace("let tab='matrix'","let tab='history'",1)
        if args.matrix_segment:
            marker="resetView();render();if(server)" if "resetView();render();if(server)" in template else "resetView();if(!readLocation())"
            assert marker in template
            template=template.replace(marker,marker.replace("resetView();","resetView();segment="+json.dumps(args.matrix_segment)+";"),1)
        payload=model.replace('<',r'\u003c')
        file=folder/'catalog.html'
        file.write_text(re.sub(r'(<script type="application/json" id="project-data">).*?(</script>)',lambda m:m[1]+payload+m[2],template,count=1,flags=re.S))
        stats={}
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('DSM_BROWSER'))
            for i in range(args.repeats):
                page=browser.new_page(viewport={'width':1440,'height':900})
                errors=[]
                page.on('pageerror',lambda e: errors.append(str(e)))
                if args.startup_only:
                    page.goto(file.as_uri()+'#matrix',timeout=90000)
                    page.wait_for_selector('.matrix button.cell')
                    ms=page.evaluate("async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return Math.round(performance.now());}")
                    stats.setdefault('startup_ms',[]).append(ms)
                    page.close()
                    continue
                page.goto(file.as_uri(),timeout=90000)
                page.wait_for_selector('#history-actor',state='attached')
                def sample(name,selector,value=None):
                    if args.progress:print(name,flush=True,file=sys.stderr)
                    stats.setdefault(name,[]).append(measure(page,selector,value))
                last='EA-'+str(args.objects-1).zfill(5)
                sample('history_first_ms','#history-object',last)
                hits=page.locator('#content tbody tr').count()
                assert hits==1+(args.revisions-1)//3,(hits,args.revisions)
                sample('history_other_ms','#history-object','EA-00002')
                sample('history_repeat_ms','#history-object',last)
                sample('neighbors_ms','[data-action=tab][data-id=graph]')
                for mode in ['component','concept','tree','all','sequence']:
                    sample(mode+'_ms','#graphMode',mode)
                    stats.setdefault(mode+'_nodes',[]).append(page.locator('#content svg g[data-action=focus]').count())
                if not args.skip_matrix:
                    sample('matrix_ms','[data-action=tab][data-id=matrix]')
                    stats.setdefault('matrix_cells',[]).append(page.locator('button.cell').count())
                    sample('matrix_select_ms','button.cell[data-to="EA-00001"][data-id="EA-00000"]')
                assert not errors,errors
                page.close()
            browser.close()
        print(json.dumps({'objects':args.objects,'revisions':args.revisions,'edges':len(json.loads(model)['history'][0]['data']['edges']),
                          'bytes':fixture.stat().st_size,'samples':stats,'median':{k:statistics.median(v) for k,v in stats.items()}},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--html',default=ROOT/'DSM-Studio.html')
    p.add_argument('--objects',type=int,default=1200)
    p.add_argument('--revisions',type=int,default=32)
    p.add_argument('--repeats',type=int,default=3)
    p.add_argument('--progress',action='store_true')
    p.add_argument('--startup-only',action='store_true')
    p.add_argument('--matrix-segment')
    p.add_argument('--skip-matrix',action='store_true')
    benchmark(p.parse_args())
