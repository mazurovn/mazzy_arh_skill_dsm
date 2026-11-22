/* Pure sampled SIL controller. Both the portable worker and the Node process execute it. */
const AxisController=(()=>{
  function execute(packet,parse){
    const {program,limits,settings:s,fault}=packet;
    const {moves}=parse(program,limits);
    const ix=['X','Y','Z'].indexOf(fault.axis);
    if(fault.axis!=='none'&&ix<0)throw Error('Выберите ось X, Y, Z или штатный режим');
    if(fault.atMs!==null&&(!Number.isSafeInteger(fault.atMs)||fault.atMs<0))throw Error('Время отказа должно быть целым числом миллисекунд ≥ 0');
    const rows=[[0,moves[0].line,0,0,0,0,0,0,'RUN']];
    let ticks=0,injected=null,alarm=null,axis=null,alarmLine=null,frozen=0;
    const streak=[0,0,0];
    for(const move of moves){
      if(!move.distance)continue;
      const speed=move.rapid?s.rapidMmMin:move.feed;
      const steps=Math.max(1,Math.ceil(move.distance/speed*60000/s.periodMs));
      if(!Number.isSafeInteger(steps)||steps+ticks>8000)throw Error('Программа превышает 8000 тактов стенда. Сократите задание или увеличьте период.');
      for(let j=1;j<=steps;j++){
        const ms=++ticks*s.periodMs;
        const plan=move.from.map((v,i)=>Number((v+(move.to[i]-v)*j/steps).toFixed(6)));
        const counts=plan.map(v=>Math.round(v*s.countsPerMm));
        if(ix>=0&&injected===null&&(fault.atMs===null?move.from[ix]!==move.to[ix]:ms>=fault.atMs)){
          injected=ms;frozen=rows.at(-1)[5+ix];
        }
        if(injected!==null)counts[ix]=frozen;
        for(let a=0;a<3;a++)streak[a]=Math.abs(plan[a]-counts[a]/s.countsPerMm)>s.toleranceMm+1e-9?streak[a]+1:0;
        const tripped=streak.findIndex(n=>n>=s.tripSamples);
        rows.push([ms,move.line,...plan,...counts,tripped>=0?'ALARM':'RUN']);
        if(tripped>=0){
          alarm=ms;axis='XYZ'[tripped];alarmLine=move.line;
          for(let k=1;k<=2;k++)rows.push([ms+k*s.periodMs,move.line,...plan,...counts,'HOLD']);
          break;
        }
      }
      if(alarm!==null)break;
    }
    return {protocol:'axis-sil/1',rows,injected,alarm,axis,alarmLine};
  }
  return {execute};
})();
if(typeof module!=='undefined')module.exports=AxisController;
