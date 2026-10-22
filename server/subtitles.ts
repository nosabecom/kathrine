// Compatibility streams start their timeline at zero, even when resuming a source.
export function shiftWebVtt(source:string,offset:number) {
  if(offset===0)return source;
  const seconds=(value:string)=>value.split(':').reduce((total,part)=>total*60+Number(part),0);
  const timestamp=(value:number)=>{
    const ms=Math.max(0,Math.round(value*1000));
    return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
  };
  return source.split(/\r?\n\r?\n/).flatMap(block=>{
    const timing=/^([\d:.]+) --> ([\d:.]+)([^\r\n]*)$/m.exec(block);
    if(!timing)return [block];
    const start=seconds(timing[1])-offset,end=seconds(timing[2])-offset;
    if(end<=0)return [];
    return [block.replace(timing[0],`${timestamp(start)} --> ${timestamp(end)}${timing[3]}`)];
  }).join('\n\n');
}
