/* VIB1 uses little-endian fields and IEEE CRC-32 over the first 28 header bytes and payload. */
const Vibration=(()=>{
  const header=32,limit=32*1024*1024;
  const crcTable=Uint32Array.from({length:256},(_,i)=>{
    let v=i;for(let bit=0;bit<8;bit++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;
  });
  function crc(bytes,start,end){
    let v=0xffffffff;
    for(let i=start;i<end;i++){if(i>=start+28&&i<start+32)continue;v=crcTable[(v^bytes[i])&255]^(v>>>8);}
    return (v^0xffffffff)>>>0;
  }
  function layout(m,root,engine){
    const calc=engine.calculate(m,root),by=new Map(m.nodes.map(n=>[n.id,n])),fmt=by.get(calc.format).attrs,streams=[],ids=new Set();
    if(fmt.headerBytes!==header||fmt.blockSamples>65535)throw Error('VIB1 требует заголовок 32 байта и до 65535 отсчётов в блоке');
    if(calc.streams.reduce((sum,s)=>sum+s.count,0)>65535)throw Error('Слишком много потоков для VIB1');
    for(const s of calc.streams){const a=by.get(s.id).attrs;
      if(a.axes>255||a.bytesPerAxis!==2)throw Error('VIB1 поддерживает до 255 каналов и 16-битные отсчёты');
      const base=a.streamBase??(calc.streams.length===1?0:undefined);
      if(!Number.isInteger(base)||base<0||base+s.count>65536)throw Error('Укажите начальный номер потока streamBase для '+s.id);
      for(let i=0;i<s.count;i++){
        const id=base+i;
        if(ids.has(id))throw Error('Номер потока назначен повторно: '+id);
        ids.add(id);streams.push({id,sensor:s.id,number:i+1,axes:a.axes,hz:a.sampleHz,samples:s.samples});
      }
    }
    return {calc,block:fmt.blockSamples,streams};
  }
  function generate(m,root,engine){
    const {calc,block,streams}=layout(m,root,engine);
    if(calc.bytes>limit)throw Error('Тестовый файл превышает 32 МиБ');
    const bytes=new Uint8Array(calc.bytes),v=new DataView(bytes.buffer);
    let pos=0;
    for(const s of streams){
      for(let first=0,seq=0;first<s.samples;first+=block,seq++){
        const n=Math.min(block,s.samples-first),size=n*s.axes*2;
        v.setUint32(pos,0x56494231);v.setUint8(pos+4,1);v.setUint8(pos+5,s.axes);v.setUint8(pos+6,2);
        v.setUint16(pos+8,s.id,true);v.setUint16(pos+10,n,true);v.setUint32(pos+12,seq,true);
        v.setBigUint64(pos+16,BigInt(Math.floor(first*1000000/s.hz)),true);v.setUint32(pos+24,size,true);
        for(let i=0;i<n*s.axes;i++)v.setInt16(pos+header+i*2,(first*s.axes+i)%1024-512,true);
        v.setUint32(pos+28,crc(bytes,pos,pos+header+size),true);pos+=header+size;
      }
    }
    return bytes;
  }
  function inspect(m,root,bytes,engine){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit)throw Error('Выберите файл VIB1 от 1 байта до 32 МиБ');
    const {streams,block}=layout(m,root,engine),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const rows=streams.map(s=>({sensor:s.sensor,number:s.number,samples:0,blocks:0,expected:s.samples,lastTime:null,start:null}));
    const byId=new Map(streams.map((s,i)=>[s.id,i])),wave=[];
    let pos=0;
    while(pos<bytes.length){
      if(pos+header>bytes.length||v.getUint32(pos)!==0x56494231||v.getUint8(pos+4)!==1||v.getUint8(pos+7)!==0)throw Error('Некорректный заголовок VIB1 · байт '+pos);
      const id=v.getUint16(pos+8,true),index=byId.get(id),s=streams[index],r=rows[index],n=v.getUint16(pos+10,true),size=v.getUint32(pos+24,true),end=pos+header+size;
      if(!s||!n||n>block||s.axes!==v.getUint8(pos+5)||v.getUint8(pos+6)!==2||size!==n*s.axes*2||end>bytes.length)throw Error('Неверный размер или поток · байт '+pos);
      if(v.getUint32(pos+28,true)!==crc(bytes,pos,end))throw Error('Ошибка CRC · байт '+pos);
      const seq=v.getUint32(pos+12,true),time=v.getBigUint64(pos+16,true);
      if(seq!==r.blocks)throw Error('Нарушена последовательность · поток '+id+', ожидался блок '+r.blocks+', получен '+seq);
      if(r.blocks>0&&r.samples!==r.blocks*block)throw Error('Короткий блок разрешён только в конце потока '+id);
      if(r.lastTime!==null&&time<=r.lastTime)throw Error('Нарушен порядок времени · поток '+id);
      if(r.start===null)r.start=time;
      const nominal=BigInt(r.samples)*1000000n/BigInt(s.hz),delta=time-r.start-nominal,tolerance=BigInt(Math.ceil(1000000/s.hz));
      if(delta>tolerance||delta< -tolerance)throw Error('Метка времени расходится с частотой потока '+id);
      if(index===0)for(let i=0;i<n&&wave.length<256;i++)wave.push(v.getInt16(pos+header+i*s.axes*2,true));
      r.blocks++;r.samples+=n;r.lastTime=time;pos=end;
    }
    return {bytes:bytes.length,complete:rows.every(r=>r.samples===r.expected),wave,streams:rows.map(({lastTime,start,...r})=>r)};
  }
  return {generate,inspect};
})();
if(typeof module!=='undefined')module.exports=Vibration;
