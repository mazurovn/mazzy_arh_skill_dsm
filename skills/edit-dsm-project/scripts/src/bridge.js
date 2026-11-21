const R=require('./runtime.js'),{Model:M}=R;
const str={type:'string'},ops={type:'array',minItems:1,items:{type:'object',properties:{op:{enum:['title','node','edge','removeNode','removeEdge']},id:str,value:{}},required:['op']}};
const shape=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const defs=[
  ['dsm_read','Прочитать текущую модель, ID проекта и исходную ревизию',shape({})],
  ['dsm_analyze','Вычислить кластеры и загрузку или показать маршрут указанного требования',shape({requirement:str},[])],
  ['dsm_history','Прочитать журнал снимков без дублирования полных моделей',shape({})],
  ['dsm_diff','Сравнить две ревизии',shape({from:str,to:str})],
  ['dsm_preview','Показать изменения и загрузку релизов до записи',shape({project:str,base:str,ops})],
  ['dsm_apply','Атомарно записать обоснованный патч к заданной ревизии',shape({project:str,base:str,ops,note:str,actor:str})],
  ['dsm_restore','Восстановить снимок новой ревизией',shape({project:str,base:str,revision:str,note:str,actor:str})]
];
function invoke(file,name,args={}){
  const doc=R.readProject(file),h=M.head(doc);
  const revision=id=>doc.history.find(x=>x.rev===id)||M.fail('Ревизия не найдена');
  const match=()=>{if(doc.project!==args.project||h.rev!==args.base)throw Error('Конфликт версии');};
  switch(name){
    case 'dsm_read':return R.current(doc);
    case 'dsm_analyze':return args.requirement?require('./delivery.js').chain(h.data,args.requirement):R.analyze(doc);
    case 'dsm_history':return doc.history.map(({data,...meta})=>meta);
    case 'dsm_diff':return M.diff(revision(args.from).data,revision(args.to).data);
    case 'dsm_preview':match();return R.preview(doc,{kind:'patch',...args});
    case 'dsm_apply':match();return R.current(R.update(file,args.project,args.base,args.note,args.actor,p=>M.patch(M.head(p).data,args.ops)));
    case 'dsm_restore':match();return R.current(R.update(file,args.project,args.base,args.note,args.actor,()=>revision(args.revision).data));
    default:throw Error('Неизвестный инструмент');
  }
}
function mcp(file){
  const rl=require('node:readline').createInterface({input:process.stdin,crlfDelay:Infinity});
  const reply=(id,obj)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...obj})+'\n');
  rl.on('line',line=>{
    let q;try{q=JSON.parse(line);}catch{reply(null,{error:{code:-32700,message:'Parse error'}});return;}
    if(q.jsonrpc!=='2.0'||typeof q.method!=='string'){reply(q.id??null,{error:{code:-32600,message:'Invalid Request'}});return;}
    if(q.id===undefined)return;
    if(q.method==='initialize'){reply(q.id,{result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'mazzy-dsm',version:'1.2.0'}}});return;}
    if(q.method==='ping'){reply(q.id,{result:{}});return;}
    if(q.method==='tools/list'){reply(q.id,{result:{tools:defs.map(([name,description,inputSchema])=>({name,description,inputSchema}))}});return;}
    if(q.method!=='tools/call'){reply(q.id,{error:{code:-32601,message:'Method not found'}});return;}
    const name=q.params?.name,args=q.params?.arguments??{},def=defs.find(v=>v[0]===name);
    if(!def||!args||typeof args!=='object'||def[2].required.some(k=>!(k in args))||Object.keys(args).some(k=>!(k in def[2].properties))){reply(q.id,{error:{code:-32602,message:'Invalid tool or arguments'}});return;}
    try{reply(q.id,{result:{content:[{type:'text',text:JSON.stringify(invoke(file,name,args))}]}});}
    catch(err){reply(q.id,{result:{isError:true,content:[{type:'text',text:err.message}]}});}
  });
}
async function jsonBody(req){
  const parts=[];let size=0;
  for await(const part of req){
    size+=part.length;
    if(size>16*1024*1024)throw Object.assign(Error('Файл превышает 16 МиБ'),{status:413});
    parts.push(part);
  }
  return size?JSON.parse(Buffer.concat(parts).toString('utf8')):{};
}
function serve(file,port){
  const http=require('node:http');
  const notebooks=require('./jupyter.js')(file);
  let stamp='',snapshot;
  function read(){
    const stat=require('node:fs').statSync(file,{bigint:true});
    const version=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join('/');
    if(version!==stamp){snapshot=R.readProject(file);stamp=version;}
    return snapshot;
  }
  const srv=http.createServer(async(req,res)=>{
    const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(data):data);};
    try{
      const host='127.0.0.1:'+srv.address().port;
      if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host){send(403,{error:'Несовпадение локального адреса'});return;}
      if(req.method==='GET'){
        const doc=read();
        if(req.url==='/'){send(200,R.html(doc),'text/html');return;}
        if(req.url==='/api/project'){send(200,doc);return;}
        if(req.url==='/api/head'){send(200,{project:doc.project,rev:M.head(doc).rev});return;}
      }
      if(req.method==='POST'&&req.url.startsWith('/api/notebooks/')){
        const origin='http://'+host;
        if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){send(403,{error:'Требуется локальный редактор'});return;}
        const [, , , action, id]=req.url.split('/');
        if(action==='start'&&!id){
          const book=await notebooks.start(R.readProject(file),origin,await jsonBody(req));
          if(res.destroyed)notebooks.stop(book.id);else send(200,book);
          return;
        }
        if(action==='list'&&!id){send(200,notebooks.list(R.readProject(file).project));return;}
        if(action==='download'&&id){send(200,notebooks.saved(R.readProject(file).project,id));return;}
        if(action==='read'&&id){send(200,notebooks.read(id));return;}
        if(action==='stop'&&id){notebooks.stop(id);send(200,{});return;}
      }
      if(req.method==='POST'&&req.url==='/api/commit'){
        if(req.headers.origin!=='http://'+host||req.headers['content-type']?.split(';')[0]!=='application/json'){send(403,{error:'Требуется локальный редактор'});return;}
        const b=await jsonBody(req);send(200,R.update(file,b.project,b.base,b.note,b.actor,()=>b.data));return;
      }
      send(404,{error:'Нет такого маршрута'});
    }catch(err){send(err.status||(/Конфликт|занят/.test(err.message)?409:400),{error:err.message});}
  });
  process.once('exit',notebooks.close);
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{notebooks.close();process.exit(0);});
  srv.listen(port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+srv.address().port));
}
module.exports={mcp,serve,invoke,defs};
