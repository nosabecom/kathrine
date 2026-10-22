import type { Capabilities, Media } from '../shared/types';
export async function api<T=any>(url:string,init?:RequestInit):Promise<T> {
  const headers=new Headers(init?.headers);
  if(typeof init?.body==='string'&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const response=await fetch(url,{...init,headers,credentials:'same-origin'});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export const post=<T=any>(url:string,body:unknown={})=>api<T>(url,{method:'POST',body:JSON.stringify(body)});
export const progress=(id:string,body:unknown)=>api(`/api/media/${id}/progress`,{method:'PUT',body:JSON.stringify(body),keepalive:true});
export async function browserCapabilities(media:Media):Promise<Capabilities> {
  const element=document.createElement('video');
  const video=media.streams.find(s=>s.type==='video'&&s.default)||media.streams.find(s=>s.type==='video');
  const caps:Capabilities={client:'browser',device:navigator.userAgent.slice(0,200),containers:[],video:[],audio:[],passthrough:[],hdr:[]};
  for(const [container,mime] of [['mp4','video/mp4'],['webm','video/webm'],['mkv','video/x-matroska']])if(element.canPlayType(mime))caps.containers.push(container);
  if(video) {
    const codec:Record<string,string>={h264:'avc1.640033',hevc:video.bitDepth===10?'hvc1.2.4.L153.B0':'hvc1.1.6.L153.B0',av1:video.bitDepth===10?'av01.0.13M.10':'av01.0.13M.08',vp9:video.bitDepth===10?'vp09.02.51.10':'vp09.00.51.08',vp8:'vp8'};
    const code=codec[video.codec];
    if(code) {
      const contentType=`video/${['vp8','vp9'].includes(video.codec)?'webm':'mp4'}; codecs="${code}"`;
      let supported=!!element.canPlayType(contentType);
      if(navigator.mediaCapabilities?.decodingInfo)try{supported=(await navigator.mediaCapabilities.decodingInfo({type:'file',video:{contentType,width:video.width||1920,height:video.height||1080,bitrate:media.bitrate||10_000_000,framerate:video.frameRate||24}})).supported;}catch{/*Use canPlayType when the API rejects a codec descriptor.*/}
      if(supported)caps.video.push({codec:video.codec,maxWidth:video.width||1920,maxHeight:video.height||1080,maxBitDepth:video.bitDepth||8,maxFrameRate:video.frameRate||60});
    }
  }
  for(const [codec,mime] of [['aac','audio/mp4; codecs="mp4a.40.2"'],['mp3','audio/mpeg'],['opus','audio/webm; codecs="opus"'],['vorbis','audio/webm; codecs="vorbis"'],['flac','audio/flac'],['ac3','audio/mp4; codecs="ac-3"'],['eac3','audio/mp4; codecs="ec-3"']])if(element.canPlayType(mime))caps.audio.push(codec);
  if(matchMedia('(dynamic-range: high)').matches)caps.hdr.push('hdr10','hlg');
  return caps;
}
