'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process'),{once}=require('node:events');
const root=path.resolve(__dirname,'..'),src=path.join(root,'skills/edit-dsm-project/scripts/src'),R=require(path.join(src,'runtime.js')),B=require(path.join(src,'bridge.js')),A=require(path.join(src,'analysis.js')),M=R.Model;
const sample=path.join(root,'example/terminal-kit.dsm.json'),doc=R.readProject(sample),h=M.head(doc),patch=JSON.parse(fs.readFileSync(path.join(root,'example/rebalance.patch.json')));
function workspace(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mazzy-dsm-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'project.json');fs.copyFileSync(sample,file);return {dir,file};}
test('six file formats preserve the model; archives preserve history',async t=>{
  const {dir}=workspace(t);
  const d=M.copy(h.data);d.nodes[0].note=' A|B "x", ; &amp; &#10; \r\n<э> ';
  const active=M.commit(doc,d,h.rev,'Контроль специальных символов','qa');
  for(const k of ['md','csv','xlsx','ipynb','html','json']){
    const f=path.join(dir,'out.'+k);fs.writeFileSync(f,await R.exportBytes(active,k));const parsed=await R.readInput(f);
    assert.deepEqual(R.Fmt.preview(active,parsed),M.head(active).data,k);
    if(k==='html'||k==='json')assert.deepEqual(parsed.doc,active);
  }
});
test('demo release balancing keeps boundary rationale and a stale patch fails',t=>{
  const {file}=workspace(t);
  assert.deepEqual(M.plan(h.data).map(r=>r.knownEffort),[13,5]);
  const preview=B.invoke(file,'dsm_preview',patch);assert.equal(preview.changes.length,2);assert.deepEqual(preview.releases.map(r=>r.knownEffort),[8,10]);
  const saved=B.invoke(file,'dsm_apply',patch);assert.deepEqual(saved.data.edges,h.data.edges);assert.notEqual(saved.base,h.rev);
  assert.throws(()=>B.invoke(file,'dsm_apply',patch),/Конфликт/);
  B.invoke(file,'dsm_restore',{project:doc.project,base:saved.base,revision:h.rev,note:'Возврат',actor:'qa'});
  const after=R.readProject(file);assert.equal(after.history.length,3);assert.deepEqual(M.head(after).data,h.data);
});
test('raw input, directed and symmetric conventions, impact and invalid references',async()=>{
  const imported=R.Fmt.preview(doc,await R.readInput(path.join(root,'example/raw-catalog.csv')));
  const next=M.commit(doc,imported,h.rev,'Каталог','qa');
  const linked=R.Fmt.preview(next,await R.readInput(path.join(root,'example/raw-links.txt')));
  assert.equal(linked.nodes.length,h.data.nodes.length+2);assert.equal(linked.edges.length,h.data.edges.length+3);
  const ids=['F02','F03'];assert.deepEqual(A.matrix(h.data,'risk',ids),[[0,3],[3,0]]);
  assert.deepEqual(A.matrix(h.data,'flow',['CLI','CTX']),[[0,1],[0,0]]);
  assert.ok(A.impact(h.data,'CFG').dependents.includes('F06'));
  assert.throws(()=>M.patch(h.data,[{op:'node',value:{id:'TK',parent:'F03'}}]),/цикл/);
  assert.throws(()=>M.patch(h.data,[{op:'removeNode',id:'RUN'}]));
  assert.throws(()=>R.Fmt.readCsv(',A,B\nA,0,3\nB,0,0',{layer:'risk'}));
  assert.throws(()=>M.validate({...h.data,edges:[...h.data.edges,{...h.data.edges.at(-1),from:h.data.edges.at(-1).to,to:h.data.edges.at(-1).from}]}));
  assert.equal(A.calculate(M.validate({title:'Пустой',nodes:[],edges:[]}),'flow').links,0);
});
test('rollback and import of an edited Markdown table preserve base guards',async t=>{
  const {file}=workspace(t),txt=R.Fmt.markdown(doc).replace('Предпросмотр правки','Сверка правки'),input=R.Fmt.readMd(txt);
  assert.equal(R.preview(doc,input).changes.length,1);
  B.invoke(file,'dsm_apply',patch);assert.throws(()=>R.preview(R.readProject(file),input),/база/);
  const before=fs.readFileSync(file);assert.throws(()=>R.update(file,doc.project,M.head(R.readProject(file)).rev,'тест','qa',()=>({title:'X',nodes:[],edges:h.data.edges})));
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(file+'.lock'),false);
});
test('MCP initialization, tool list, read, preview, apply and conflict',t=>{
  const {file}=workspace(t),simple={project:patch.project,base:patch.base,ops:patch.ops};
  const requests=[['initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'qa',version:'1'}}],['tools/list',{}],['tools/call',{name:'dsm_read',arguments:{}}],['tools/call',{name:'dsm_preview',arguments:simple}],['tools/call',{name:'dsm_apply',arguments:patch}],['tools/call',{name:'dsm_apply',arguments:patch}]];
  const input=requests.map(([method,params],i)=>JSON.stringify({jsonrpc:'2.0',id:i+1,method,params})).join('\n')+'\n';
  const ran=spawnSync(process.execPath,[path.join(root,'dsm.cjs'),'mcp',file],{input,encoding:'utf8'});assert.equal(ran.status,0,ran.stderr);
  const res=ran.stdout.trim().split('\n').map(x=>JSON.parse(x).result);assert.equal(res[0].protocolVersion,'2025-06-18');assert.equal(res[1].tools.length,7);assert.equal(JSON.parse(res[2].content[0].text).base,h.rev);assert.equal(JSON.parse(res[3].content[0].text).changes.length,2);assert.equal(JSON.parse(res[4].content[0].text).version,2);assert.equal(res[5].isError,true);
});
test('HTTP and agent share storage; concurrent base has one winner',async t=>{
  const {file}=workspace(t),proc=spawn(process.execPath,[path.join(root,'dsm.cjs'),'serve',file,'0']);t.after(()=>proc.kill());
  const [buffer]=await once(proc.stdout,'data'),origin=buffer.toString().trim();assert.ok((await (await fetch(origin)).text()).includes('project-data'));
  const send=()=>fetch(origin+'/api/commit',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({project:doc.project,base:h.rev,actor:'qa',note:'browser',data:h.data})});
  assert.deepEqual((await Promise.all([send(),send()])).map(r=>r.status).sort(),[200,409]);
  const saved=R.readProject(file);B.invoke(file,'dsm_apply',{...patch,base:M.head(saved).rev});
  const live=await fetch(origin+'/api/project').then(r=>r.json());assert.equal(live.history.length,3);assert.equal(M.head(live).data.nodes.find(n=>n.id==='F03').release,'R2');
});
test('text agent uses configured model; preview, explicit apply and questions',async t=>{
  const {file,dir}=workspace(t),http=require('node:http');
  let request=null,questions=[];
  const srv=http.createServer(async(req,res)=>{const parts=[];for await(const b of req)parts.push(b);
    request=JSON.parse(Buffer.concat(parts).toString('utf8'));res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Перенос F03',questions,ops:patch.ops})}}]}));});
  srv.listen(0,'127.0.0.1');await once(srv,'listening');t.after(()=>srv.close());
  const env={...process.env,DSM_LLM_URL:'http://127.0.0.1:'+srv.address().port+'/v1/chat/completions',DSM_LLM_MODEL:'demo-model'};
  const run=async(...options)=>{const child=spawn(process.execPath,[path.join(root,'dsm.cjs'),'agent',file,'Разгрузи R1',...options],{env});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const [code]=await once(child,'close');return {code,stdout,stderr};};
  const proposal=path.join(dir,'p.json');const first=await run('--patch-out',proposal);
  assert.equal(first.code,0,first.stderr);assert.equal(R.readProject(file).history.length,1);
  assert.equal(JSON.parse(fs.readFileSync(proposal)).base,h.rev);assert.equal(request.model,'demo-model');
  assert.deepEqual(Object.keys(JSON.parse(request.messages[1].content)).sort(),['model','request','source']);
  questions=['Уточните выпуск'];assert.notEqual((await run('--apply')).code,0);assert.equal(R.readProject(file).history.length,1);
  questions=[];assert.equal((await run('--apply')).code,0);assert.equal(R.readProject(file).history.length,2);
});
