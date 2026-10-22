import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Media } from '../shared/types.js';
import { localArtwork, plainText, readLocalMetadata } from './localMetadata.js';

export type MetadataRecord=Omit<Media,'id'|'libraryId'|'addedAt'|'available'|'position'|'completed'|'favorite'> & {
  remoteArtwork?:Partial<Record<'poster'|'backdrop'|'still'|'seasonPoster',string>>;
  enrichmentVersion?:number; enrichedAt?:number; metadataRefreshAfter?:number; metadataVersion?:number;
};
type RemoteDetails={title:string;overview?:string;year?:number;genres:string[];poster?:string;backdrop?:string;source:{name:string;url:string};seasons?:{number:number;poster?:string}[];episodes?:{season:number;number:number;title:string;overview?:string;image?:string}[]};
export const normalizedTitle=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en').replace(/&/g,'and').replace(/[^\p{L}\p{N}]/gu,'');
export async function readLimited(response:Response,max:number) {
  if(Number(response.headers.get('content-length'))>max)throw new Error('Metadata response exceeds its size limit.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty metadata response.');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)throw new Error('Metadata response exceeds its size limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export class MetadataEnricher {
  private memory=new Map<string,Promise<RemoteDetails|undefined>>();
  private lastRequest=0;
  constructor(private directory:string,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now){}
  beginScan(){this.memory.clear();}
  async enrich(input:MetadataRecord,file:string,root:string,online=true):Promise<MetadataRecord> {
    const series=!!input.series,local=await readLocalMetadata(file,root,series);
    const [poster,backdrop,still]=await Promise.all([localArtwork(file,root,'poster',input.season),localArtwork(file,root,'backdrop',input.season),series?localArtwork(file,root,'still',input.season):Promise.resolve(undefined)]);
    const complete=!!local.title&&!!local.overview&&(!series||!!local.seriesOverview)&&!!poster&&!!backdrop&&(!series||!!still);
    const rawName=local.seriesTitle||input.series||local.title||input.title;
    const yearFromName=rawName.match(/\s+\(?((?:19|20)\d{2})\)?$/)?.[1];
    const name=rawName.replace(/\s+\(?(?:19|20)\d{2}\)?$/,'').trim();
    const year=series?(local.seriesYear||(yearFromName?Number(yearFromName):undefined)):(local.year||input.year);
    const remote=online&&!complete?await this.lookup(series?'series':'movie',name,year,local.externalIds):undefined;
    const episode=series?remote?.episodes?.find(e=>e.season===input.season&&e.number===input.episode):undefined;
    const seasonPoster=series?remote?.seasons?.find(s=>s.number===input.season)?.poster:undefined;
    const remoteArtwork={...input.remoteArtwork,...(remote?.poster?{poster:remote.poster}:{}),...(remote?.backdrop?{backdrop:remote.backdrop}:{}),...(episode?.image?{still:episode.image}:{}),...(seasonPoster?{seasonPoster}:{})};
    const title=local.title||(series?episode?.title:remote?.title)||(input.enrichmentVersion?input.title:series&&input.episode!==undefined?`Episode ${input.episode}`:input.title);
    return {...input,title,sortTitle:title,overview:local.overview||episode?.overview||(!series?remote?.overview:undefined)||input.overview,
      series:series?local.seriesTitle||remote?.title||input.series:undefined,seriesOverview:local.seriesOverview||(series?remote?.overview:undefined)||input.seriesOverview,
      year:local.year||(!series?remote?.year:undefined)||input.year,seriesYear:local.seriesYear||(series?remote?.year:undefined)||input.seriesYear,
      genres:local.genres.length?local.genres:remote?.genres||input.genres||[],remoteArtwork,
      metadataSources:remote?[remote.source]:input.metadataSources||[],artworkVersion:createHash('sha256').update(JSON.stringify([poster,backdrop,still,remoteArtwork])).digest('hex').slice(0,12),
      enrichmentVersion:1,enrichedAt:this.now(),metadataRefreshAfter:this.now()+(online&&!complete&&!remote?3600_000:7*24*3600_000)};
  }
  private lookup(type:'series'|'movie',name:string,year:number|undefined,ids:{imdb?:string;tvdb?:string}) {
    const key=JSON.stringify([type,normalizedTitle(name),year,ids.imdb,ids.tvdb]);
    if(!this.memory.has(key))this.memory.set(key,this.cached(key,()=>type==='series'?this.tv(name,year,ids):this.movie(name,year,ids.imdb)));
    return this.memory.get(key)!;
  }
  private async cached(key:string,load:()=>Promise<RemoteDetails|undefined>) {
    const path=join(this.directory,createHash('sha256').update(key).digest('hex')+'.json');
    try{const saved=JSON.parse(await readFile(path,'utf8'));if(saved.expires>this.now())return saved.data||undefined;}catch{/*First lookup or an expired cache.*/}
    let data:RemoteDetails|undefined,ttl=24*3600_000;
    try{data=await load();if(data)ttl=7*24*3600_000;}catch{ttl=3600_000;}
    try{await mkdir(this.directory,{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({expires:this.now()+ttl,data:data||null}),{mode:0o600});await rename(temp,path);}catch{/*A cache write failure must not make media unavailable.*/}
    return data;
  }
  private async json(url:string):Promise<any> {
    for(let attempt=0;attempt<2;attempt++){
      const pause=Math.max(0,550-(this.now()-this.lastRequest));if(pause)await new Promise(r=>setTimeout(r,pause));this.lastRequest=this.now();
      const response=await this.fetcher(url,{headers:{'User-Agent':'Kathrine/0.3 (personal media metadata cache)'},signal:AbortSignal.timeout(12_000)});
      if(response.status===429&&attempt===0){await response.body?.cancel();await new Promise(r=>setTimeout(r,1500));continue;}
      if(!response.ok){await response.body?.cancel();throw new Error('Metadata lookup failed.');}
      return JSON.parse((await readLimited(response,2*1024*1024)).toString('utf8'));
    }
  }
  private async tv(name:string,year:number|undefined,ids:{imdb?:string;tvdb?:string}):Promise<RemoteDetails|undefined> {
    let show:any;
    if(ids.imdb||ids.tvdb)show=await this.json('https://api.tvmaze.com/lookup/shows?'+(ids.imdb?'imdb='+ids.imdb:'thetvdb='+ids.tvdb));
    else{
      const results=await this.json('https://api.tvmaze.com/search/shows?q='+encodeURIComponent(name));
      const exact=(Array.isArray(results)?results:[]).map(v=>v.show).filter(v=>v&&normalizedTitle(v.name)===normalizedTitle(name));
      const candidates=year&&exact.length>1?exact.filter(v=>Number(v.premiered?.slice(0,4))===year):exact;
      if(candidates.length!==1)return;show=candidates[0];
    }
    if(!Number.isInteger(show?.id))return;
    const episodes=await this.json(`https://api.tvmaze.com/shows/${show.id}/episodes?specials=1`);
    let images:any[]=[];try{const result=await this.json(`https://api.tvmaze.com/shows/${show.id}/images`);if(Array.isArray(result))images=result;}catch{/*A primary poster can still be used.*/}
    let seasons:any[]=[];try{const result=await this.json(`https://api.tvmaze.com/shows/${show.id}/seasons`);if(Array.isArray(result))seasons=result;}catch{/*Show posters remain a useful fallback.*/}
    const image=(type:string)=>images.filter(i=>i.type===type&&i.resolutions?.original?.url).sort((a,b)=>Number(!!b.main)-Number(!!a.main)||(b.resolutions.original.width||0)*(b.resolutions.original.height||0)-(a.resolutions.original.width||0)*(a.resolutions.original.height||0))[0]?.resolutions.original.url;
    return {title:show.name,overview:plainText(show.summary),year:Number(show.premiered?.slice(0,4))||undefined,genres:Array.isArray(show.genres)?show.genres.filter((g:unknown)=>typeof g==='string'):[],poster:image('poster')||show.image?.original,backdrop:image('background')||image('banner'),source:{name:'TVmaze',url:`https://www.tvmaze.com/shows/${show.id}`},seasons:seasons.filter(s=>Number.isInteger(s.number)).map(s=>({number:s.number,poster:s.image?.original})),episodes:(Array.isArray(episodes)?episodes:[]).filter(e=>Number.isInteger(e.season)&&Number.isInteger(e.number)).map(e=>({season:e.season,number:e.number,title:plainText(e.name)||`Episode ${e.number}`,overview:plainText(e.summary),image:e.image?.original}))};
  }
  private async movie(name:string,year:number|undefined,imdb?:string):Promise<RemoteDetails|undefined> {
    if(!imdb){
      const result=await this.json(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(name)}.json`);
      const candidates=(result.metas||[]).filter((v:any)=>normalizedTitle(v.name||'')===normalizedTitle(name)&&(!year||String(v.releaseInfo||v.year||'').slice(0,4)===String(year)));
      if(candidates.length!==1||!/^tt\d+$/.test(candidates[0].id))return;imdb=candidates[0].id;
    }
    const {meta}=await this.json(`https://v3-cinemeta.strem.io/meta/movie/${imdb}.json`);
    if(!meta?.name)return;
    return {title:meta.name,overview:plainText(meta.description),year:Number(String(meta.releaseInfo||meta.year).slice(0,4))||undefined,genres:Array.isArray(meta.genres)?meta.genres.filter((g:unknown)=>typeof g==='string'):[],poster:typeof meta.poster==='string'?meta.poster.replace('images.metahub.space/poster/small/','images.metahub.space/poster/medium/'):undefined,backdrop:meta.background,source:{name:'Cinemeta',url:'https://www.stremio.com/'}};
  }
}
