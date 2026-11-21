// Deterministic synthetic architecture and revision history for browser benchmarks.
const fs = require('node:fs');
const Model = require('../skills/edit-dsm-project/scripts/src/model.js');

function enterpriseCatalog(count, versions) {
  if (!Number.isSafeInteger(count) || count < 32 || !Number.isSafeInteger(versions) || versions < 1)
    throw Error('At least 32 objects and one revision are required');
  const kinds = ['domain','cluster','server','system','component','service','data','requirement','feature','component','service','project'];
  const id = i => 'EA-' + String(i).padStart(5,'0');
  const nodes = Array.from({length:count}, (_,i) => {
    const offset=i%kinds.length, start=i-offset;
    const node={id:id(i), kind:kinds[offset], name:kinds[offset]+' '+i, segment:'Домен '+(1+Math.floor(i/12)%24)};
    if(offset)node.parent=id(start);
    if(offset===4||offset===5)node.relations=[['deployedOn',id(start+2)]];
    if(offset===7){node.attrs={when:'сервис запущен',then:'контракт доступен'};node.note='Проверить доступность сервиса';}
    return node;
  });
  const edges=[];
  for(let i=0;i<count;i++){
    for(const gap of [1,11])if(i+gap<count)edges.push({from:id(i),to:id(i+gap),layer:'flow',weight:1,reason:'Передача заявки'});
    if(i%2===0&&i+3<count)edges.push({from:id(i),to:id(i+3),layer:'risk',weight:2,reason:'Совместная приёмка'});
  }
  nodes[11]={...nodes[11],kind:'scenario',name:'Передача заявки',steps:Array.from({length:Math.min(180,count-1)},(_,i)=>[id(i),id(i+1)])};
  const history=[];
  let data=Model.validate({title:'Каталог испытательного предприятия',nodes,edges});
  for(let i=0;i<versions;i++){
    if(i){
      const target=i%3===0?count-1:i%count;
      data={...data,nodes:data.nodes.map((n,j)=>j===target?{...n,note:'Приёмка '+i}:n)};
    }
    history.push({rev:'rev-'+i,parent:i?'rev-'+(i-1):null,actor:'Архитектор '+(i%4),note:'Приёмка итерации '+i,at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),data});
  }
  return {schema:'dsm-project/1',project:'enterprise-benchmark',history};
}
if(require.main===module)fs.writeFileSync(process.argv[4],JSON.stringify(enterpriseCatalog(Number(process.argv[2]),Number(process.argv[3]))),{flag:'wx'});
module.exports=enterpriseCatalog;
