// Keep TV seeking in source time. Converted streams can start partway through
// the file and must never seek before their prepared offset.
export function playbackTime(value:number){
  const seconds=Math.max(0,Math.floor(Number.isFinite(value)?value:0));
  return seconds>=3600?`${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

export function seekPosition(position:number,delta:number,offset:number,duration:number){
  return Math.max(offset,Math.min(Math.max(offset,duration),position+delta));
}

// Android TV emits ordinary D-pad events on ACTION_UP by default. Long presses
// start on ACTION_DOWN; their matching release must not apply the seek twice.
export function isTVKeyPress(event:{eventType:string;eventKeyAction?:number}){
  return event.eventType.startsWith('long')?event.eventKeyAction!==1:event.eventKeyAction!==0;
}
