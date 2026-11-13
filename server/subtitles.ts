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

// Only text cues are accepted. This also rejects HTML/error pages and archives
// returned in place of a subtitle download before they can enter the cache.
export function normalizeSubtitles(input:string,duration?:number) {
  if(input.length>2*1024*1024||/<(?:!doctype|html|script)\b/i.test(input))throw new Error('Not a valid text subtitle file.');
  const text=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  const blocks=text.split(/\n\s*\n/),cues:string[]=[];
  let last=-1,end=0;
  const seconds=(value:string)=>value.replace(',','.').split(':').reduce((total,part)=>total*60+Number(part),0);
  for(let block of blocks) {
    if(/^WEBVTT(?:\s|$)/.test(block)||/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block))continue;
    const lines=block.split('\n');if(!lines[0].includes('-->'))lines.shift();
    const timing=/^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3}) --> ((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:[ \t].*)?$/.exec(lines.shift()||'');
    if(!timing)throw new Error('The subtitle file contains malformed cues.');
    const start=seconds(timing[1]),finish=seconds(timing[2]);
    if(!Number.isFinite(start)||finish<=start||start<last)throw new Error('The subtitle timestamps are invalid.');
    const caption=lines.join('\n').replace(/<(?!\/?(?:b|i|u)\b)[^>]*>/gi,'').trim();
    if(!caption)continue;
    last=start;end=Math.max(end,finish);
    cues.push(`${timing[1].replace(',','.')} --> ${timing[2].replace(',','.')}\n${caption}`);
  }
  if(!cues.length)throw new Error('The subtitle file has no readable cues.');
  if(duration!==undefined&&duration>0) {
    if(end>duration+Math.max(15,Math.min(90,duration*.02)))throw new Error('The subtitle timestamps do not fit this video.');
    if(duration>300&&(end<duration*.6||cues.length<20))throw new Error('This appears to be a partial subtitle track.');
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
