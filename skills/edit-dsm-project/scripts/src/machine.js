const Machine=(M=>{
  const products=m=>m.nodes.filter(n=>n.kind==='product'&&n.attrs?.workbench==='cnc');
  function parts(m,root){
    if(!products(m).some(n=>n.id===root))throw Error('Выберите изделие с атрибутом workbench=cnc');
    const children=new Map();
    for(const n of m.nodes){if(!children.has(n.parent))children.set(n.parent,[]);children.get(n.parent).push(n);}
    const list=[...children.get(root)||[]];
    for(const n of list)list.push(...children.get(n.id)||[]);
    return list;
  }
  function one(list,role){const rows=list.filter(n=>n.attrs?.machineRole===role);if(rows.length!==1)throw Error('Требуется ровно одна карточка роли '+role);return rows[0];}
  function integer(n,k,min=1,max=Number.MAX_SAFE_INTEGER){
    const v=n.attrs?.[k];if(!Number.isSafeInteger(v)||v<min||v>max)throw Error(n.id+' · проверьте '+k);return v;
  }
  function calculate(m,root){
    const list=parts(m,root),req=one(list,'capture'),format=one(list,'format'),sensors=list.filter(n=>n.attrs?.machineRole==='sensor');
    if(!sensors.length)throw Error('Добавьте хотя бы один поток датчика');
    const duration=integer(req,'durationSeconds'),block=integer(format,'blockSamples'),header=integer(format,'headerBytes',0),reserve=integer(format,'reservePercent',0,99);
    const streams=sensors.map(n=>{
      const samples=integer(n,'sampleHz')*duration,count=integer(n,'quantity');
      const payload=samples*integer(n,'axes')*integer(n,'bytesPerAxis'),blocks=Math.ceil(samples/block);
      return {id:n.id,count,samples,blocks,total:count*(payload+blocks*header)};
    });
    const bytes=streams.reduce((s,x)=>s+x.total,0);
    if(!Number.isSafeInteger(bytes))throw Error('Объём превышает диапазон точного расчёта');
    const options=list.filter(n=>n.attrs?.machineRole==='storage').map(n=>{
      const capacity=integer(n,'capacityBytes');
      const usable=Number(BigInt(capacity)*BigInt(100-reserve)/100n);
      return {id:n.id,capacity,usable,margin:usable-bytes};
    }).sort((a,b)=>a.capacity-b.capacity||(a.id<b.id?-1:a.id>b.id?1:0));
    if(!options.length)throw Error('Добавьте вариант накопителя');
    return {root,requirement:req.id,format:format.id,duration,reserve,streams,bytes,options,selected:options.find(o=>o.margin>=0)?.id??null};
  }
  function architecture(m,root){
    const nodes=parts(m,root).filter(n=>['system','component','module','actor'].includes(n.kind)),ids=new Set(nodes.map(n=>n.id));
    const edges=m.edges.filter(e=>ids.has(e.from)&&ids.has(e.to));
    return {nodes,edges};
  }
  function envelope(m,root){const n=one(parts(m,root),'envelope');return ['xMm','yMm','zMm'].map(k=>integer(n,k));}
  function simulate(program,limits){
    if(typeof program!=='string'||program.length>128000)throw Error('Размер программы до 128 000 символов');
    let mm=false,absolute=false,feed=null,at=[0,0,0],length=0;
    const moves=[],lines=program.split(/\r?\n/);
    for(const [i,row] of lines.entries()){
      const error=reason=>{throw Error('Строка '+(i+1)+' · '+reason);};
      const line=row.split(';')[0].trim().toUpperCase();if(!line)continue;
      const words=line.match(/[A-Z][+-]?(?:\d+(?:\.\d*)?|\.\d+)/g);
      if(!words||words.join('')!==line.replace(/\s+/g,''))error('Неподдержанный синтаксис');
      const [command,...args]=words;
      if(command==='G21'||command==='G90'){if(args.length)error('Команда режима должна быть на отдельной строке');if(command==='G21')mm=true;else absolute=true;continue;}
      if(!['G0','G00','G1','G01'].includes(command))error('Поддерживаются G21, G90, G0 и G1');
      if(!mm||!absolute)error('Сначала задайте G21 и G90');
      const next=[...at],seen=new Set();
      for(const w of args){
        const k=w[0],v=Number(w.slice(1));if(!Number.isFinite(v)||seen.has(k)||!'XYZF'.includes(k))error('Некорректное слово '+w);
        seen.add(k);
        if(k==='F'){if(v<=0)error('Подача должна быть положительной');feed=v;continue;}
        const ix='XYZ'.indexOf(k);if(v<0||v>limits[ix])error(k+' вне рабочего диапазона 0…'+limits[ix]+' мм');next[ix]=v;
      }
      if(!'XYZ'.split('').some(k=>seen.has(k)))error('Укажите координату перемещения');
      const rapid=command==='G0'||command==='G00';if(!rapid&&feed===null)error('Для G1 нужна подача F');
      const distance=Math.hypot(...next.map((v,j)=>v-at[j]));length+=distance;
      moves.push({line:i+1,from:at,to:next,rapid,feed:rapid?null:feed,distance});at=next;
    }
    if(!moves.length)throw Error('В программе нет перемещений');
    return {moves,length};
  }
  function receipt(doc,input){
    const h=M.head(doc);
    if(doc.project!==input.project||h.rev!==input.base)throw Error('Конфликт версии расчёта. База '+input.base+', текущая '+h.rev+'. Выполните новый блокнот.');
    const calc=calculate(h.data,input.root),expected=[calc.bytes,calc.selected,calc.streams.map(s=>[s.id,s.count,s.samples,s.blocks,s.total]),calc.options.map(o=>[o.id,o.usable,o.margin])];
    if(JSON.stringify(expected)!==JSON.stringify(input.values))throw Error('Результат ядра расходится с моделью станка');
    let seq=1;while(h.data.nodes.some(n=>n.id==='CALC-'+seq))seq++;
    return M.patch(h.data,[{op:'node',value:{id:'CALC-'+seq,kind:'artifact',parent:calc.root,name:'Расчёт памяти · '+calc.duration+' с',state:'done',attrs:{machineRole:'calculation',base:h.rev,bytes:calc.bytes,selected:calc.selected??'',durationSeconds:calc.duration},
      refs:[calc.requirement,calc.format,...calc.streams.map(s=>s.id),...calc.options.map(o=>o.id)],relations:[['verifies',calc.requirement]],note:calc.selected?'Расчёт Python по исходной версии. Выбран минимальный подходящий накопитель.':'Расчёт Python по исходной версии. Требуемое окно превышает доступную ёмкость всех вариантов.'}}]);
  }
  return {products,parts,calculate,architecture,envelope,simulate,receipt};
})(typeof DSM!=='undefined'?DSM:require('./model.js'));
if(typeof module!=='undefined')module.exports=Machine;
