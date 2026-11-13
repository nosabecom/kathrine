import { basename } from 'node:path';
import type { Media } from '../shared/types.js';

export const subtitleLimit = 2 * 1024 * 1024;
export type SubtitleCandidate = { url:string; sourceUrl:string; release:string; fps?:number; score:number };
export class SubtitleProviderError extends Error {
  constructor(public kind:'unavailable'|'quota'|'credentials'|'invalid', public retryAfter=0) {
    super({unavailable:'The subtitle provider is unavailable. Try again later.',quota:'The subtitle provider quota is exhausted. Try again after the cooldown.',credentials:'Check the server’s SubDL API key.',invalid:'The subtitle provider returned an invalid response.'}[kind]);
  }
}
export async function boundedText(response:Response,limit=subtitleLimit) {
  if(Number(response.headers.get('content-length'))>limit)throw new SubtitleProviderError('invalid');
  const reader=response.body?.getReader();if(!reader)throw new SubtitleProviderError('invalid');
  const chunks:Uint8Array[]=[];let length=0;
  try { for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new SubtitleProviderError('invalid');chunks.push(value);} }
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const bytes=Buffer.concat(chunks);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('windows-1252').decode(bytes);}
}
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,'');
const stem=(value:string)=>basename(value).replace(/\.(mkv|mp4|srt|vtt|zip)$/i,'');
function releaseHints(value:string) {
  const lower=value.toLowerCase();
  const group=/-([a-z0-9]+)(?:\[[^\]]*\])?$/i.exec(stem(value))?.[1]?.toLowerCase();
  const source=/blu[ .-]?ray|bdrip|brrip/i.test(lower)?'bluray':/web[ .-]?(?:dl|rip)|\bweb\b/i.test(lower)?'web':undefined;
  const service=/\b(max|hmax|amzn|nf|dsnp|atvp|hulu)\b/i.exec(lower)?.[1]?.replace('hmax','max');
  return {group,source,service};
}
function releaseIdentity(value:string) {
  const name=stem(value),marker=/(?:^|[ ._-])(?:s\d{1,2}(?:e\d{1,3})?|(?:19|20)\d{2}|(?:720|1080|2160|4320)p|blu[ .-]?ray|web[ .-]?(?:dl|rip))(?=[ ._-]|$)/i.exec(name);
  return marker&&marker.index>0?normalized(name.slice(0,marker.index)):undefined;
}
export function rankRelease(file:string,release:string) {
  if(normalized(stem(file))===normalized(stem(release)))return 100;
  const identityA=releaseIdentity(file),identityB=releaseIdentity(release);
  if(identityA&&identityB&&identityA!==identityB)return 0;
  const episodeA=/s(\d{1,2})(?:e(\d{1,3}))?/i.exec(file),episodeB=/s(\d{1,2})(?:e(\d{1,3}))?/i.exec(release);
  if(episodeA&&episodeB&&(Number(episodeA[1])!==Number(episodeB[1])||episodeA[2]&&episodeB[2]&&Number(episodeA[2])!==Number(episodeB[2])))return 0;
  const yearA=/\b((?:19|20)\d{2})\b/.exec(file)?.[1],yearB=/\b((?:19|20)\d{2})\b/.exec(release)?.[1];
  if(yearA&&yearB&&yearA!==yearB)return 0;
  const a=releaseHints(file),b=releaseHints(release);
  if(a.source&&b.source&&a.source!==b.source||a.service&&b.service&&a.service!==b.service)return 0;
  // Same release group AND source/service is required for unattended selection.
  if(a.group&&a.group===b.group&&a.source&&a.source===b.source)return 90;
  return 0;
}
export function subtitleDownloadUrl(input:string) {
  const url=new URL(input,'https://dl.subdl.com');
  // Search responses append the account key even to public raw-file URLs.
  // Discard it before validation, storage or download; never forward it to the CDN.
  url.searchParams.delete('api_key');
  if(url.protocol!=='https:'||url.hostname!=='dl.subdl.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/subtitle\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/.test(url.pathname))throw new SubtitleProviderError('invalid');
  return url.href;
}
export function selectCandidates(payload:unknown,media:Media,file:string):SubtitleCandidate[] {
  if(!payload||typeof payload!=='object')throw new SubtitleProviderError('invalid');
  const data=payload as any;
  if(data.status===false||!Array.isArray(data.results)||!Array.isArray(data.subtitles))throw new SubtitleProviderError('invalid');
  const title=media.series||media.title,first=data.results[0];
  if(!first||normalized(String(first.name||''))!==normalized(title))return [];
  if(media.series&&first.type!=='tv'||!media.series&&first.type!=='movie')return [];
  const year=media.series?media.seriesYear:media.year;
  if(year&&first.year&&Number(first.year)!==year)return [];
  const output:SubtitleCandidate[]=[];
  for(const entry of data.subtitles.slice(0,100)) {
    const files=Array.isArray(entry.unpack_files)&&entry.unpack_files.length?entry.unpack_files:entry.full_season?[]:[entry];
    for(const item of files.slice(0,100)) {
      if(String(item.language||entry.language||'').toLowerCase()!=='en'&&String(item.language||entry.language||'').toLowerCase()!=='english')continue;
      const release=String(item.release_name||item.name||'');
      if(!release||!item.url||/\bforced\b/i.test(release))continue;
      if(media.series) {
        if(media.season===undefined||media.episode===undefined||Number(item.season??entry.season)!==media.season||Number(item.episode??entry.episode)!==media.episode)continue;
        const markers=[...`${release} ${item.name||''}`.matchAll(/s(\d{1,2})e(\d{1,3})/gi)];
        if(markers.some(m=>Number(m[1])!==media.season||Number(m[2])!==media.episode))continue;
      }
      const fps=Number(item.fps||entry.fps)||undefined,sourceFps=media.streams.find(s=>s.type==='video')?.frameRate;
      if(fps&&sourceFps&&Math.abs(fps-sourceFps)>.01)continue;
      if(releaseIdentity(release)&&releaseIdentity(file)&&releaseIdentity(release)!==releaseIdentity(file))continue;
      const score=Math.max(rankRelease(file,release),rankRelease(file,String(entry.release_name||'')),...(Array.isArray(entry.releases)?entry.releases.slice(0,100).map((r:unknown)=>typeof r==='string'?rankRelease(file,r):0):[0]));
      if(score<90)continue;
      try{output.push({url:subtitleDownloadUrl(String(item.url)),sourceUrl:`https://subdl.com${typeof entry.subtitlePage==='string'&&/^\/s\/info\/[a-zA-Z0-9/_-]+$/.test(entry.subtitlePage)?entry.subtitlePage:'/'}`,release,fps,score});}catch{/*Untrusted provider URLs are never fetched.*/}
    }
  }
  return output.sort((a,b)=>b.score-a.score).filter((item,index,all)=>all.findIndex(v=>v.url===item.url)===index).slice(0,3);
}
export class SubdlProvider {
  constructor(private key:string,private fetcher:typeof fetch=fetch) {}
  private async request(url:string,authenticated:boolean,signal?:AbortSignal) {
    let response:Response;
    try{response=await this.fetcher(url,{headers:{Accept:authenticated?'application/json':'text/plain',...(authenticated?{Authorization:`Bearer ${this.key}`}:{})},redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20_000),...(signal?[signal]:[])])});}
    catch{throw new SubtitleProviderError('unavailable');}
    if(!response.ok){await response.body?.cancel();if(response.status===401||response.status===403)throw new SubtitleProviderError('credentials');if(response.status===429)throw new SubtitleProviderError('quota',Math.min(86400,Math.max(60,Number(response.headers.get('retry-after'))||3600)));throw new SubtitleProviderError('unavailable');}
    return boundedText(response);
  }
  async search(media:Media,file:string,signal?:AbortSignal) {
    const params=new URLSearchParams({film_name:media.series||media.title,file_name:basename(file),type:media.series?'tv':'movie',languages:'en',unpack:'1',releases:'1',subs_per_page:'30'});
    if(media.series){params.set('season',String(media.season));params.set('episode',String(media.episode));}else if(media.year)params.set('year',String(media.year));
    let data:unknown;try{data=JSON.parse(await this.request('https://api.subdl.com/api/v2/subtitles/search?'+params,true,signal));}catch(e){if(e instanceof SubtitleProviderError)throw e;throw new SubtitleProviderError('invalid');}
    return selectCandidates(data,media,file);
  }
  download(candidate:SubtitleCandidate,signal?:AbortSignal) {return this.request(subtitleDownloadUrl(candidate.url),false,signal);}
}
