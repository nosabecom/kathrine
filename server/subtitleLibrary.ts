import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DB, MediaRow } from './db.js';
import { publicMedia } from './db.js';
import { checkedPath } from './paths.js';
import { normalizeSubtitles } from './subtitles.js';
import { SubdlProvider, SubtitleProviderError, subtitleLimit } from './subtitleProvider.js';
import type { Media, SubtitleFile, SubtitleInventory } from '../shared/types.js';

const textCodecs=new Set(['subrip','ass','ssa','webvtt','mov_text','text']);
const english=(value?:string)=>['en','eng','english'].includes((value||'').toLowerCase());
const version=(row:MediaRow)=>`${row.mtime}:${row.size}`;
type Download={version:string;language:string;label:string;source_url:string;content:string;added_at:number};
type SourceResult='downloaded'|'cached'|'no-match'|'invalid'|'unavailable'|'quota'|'credentials'|'changed';
export class SubtitleLibrary {
  readonly status={running:false,checked:0,downloaded:0,unmatched:0,errors:0,lastError:'',startedAt:0,finishedAt:0,cooldownUntil:0};
  private task?:Promise<void>;
  private stopped=false;
  private abort=new AbortController();
  private activeMedia=new Map<string,number>();
  private provider?:SubdlProvider;
  constructor(private db:DB,key:string,readonly automatic:boolean,provider?:SubdlProvider) {this.provider=provider||(key?new SubdlProvider(key):undefined);}
  get configured(){return !!this.provider;}
  touchPlayback(id:string) {this.activeMedia.set(id,Date.now());}
  private async file(row:MediaRow) {
    const library=this.db.prepare('SELECT path FROM libraries WHERE id=?').get(row.library_id) as {path:string}|undefined;
    if(!library||!row.available)throw Object.assign(new Error('Media is unavailable.'),{statusCode:404});
    const file=await checkedPath(row.path,library.path),info=await stat(file);
    if(info.size!==row.size||Math.abs(info.mtimeMs-row.mtime)>1)throw Object.assign(new Error('The file changed. Scan the library before downloading subtitles.'),{statusCode:409});
    return {file,root:library.path};
  }
  private cached(row:MediaRow) {
    const cached=this.db.prepare('SELECT * FROM subtitle_downloads WHERE media_id=?').get(row.id) as Download|undefined;
    return cached?.version===version(row)?cached:undefined;
  }
  private async sidecars(row:MediaRow) {
    const {file,root}=await this.file(row),stem=basename(file,extname(file));
    const names=await readdir(dirname(file));
    const output:{track:SubtitleFile;file:string}[]=[];
    for(const name of names.sort()) {
      const extension=extname(name).toLowerCase();if(!['.srt','.vtt'].includes(extension))continue;
      const base=name.slice(0,-extension.length);if(base!==stem&&!base.startsWith(stem+'.'))continue;
      try {
        const path=await checkedPath(join(dirname(file),name),root),info=await stat(path);if(!info.isFile()||info.size>subtitleLimit)continue;
        normalizeSubtitles(await readFile(path,'utf8'));
        const language=base===stem?'und':base.slice(stem.length+1).split('.')[0].toLowerCase();
        const id='local-'+createHash('sha256').update(name).digest('hex').slice(0,16);
        output.push({track:{id,language,label:`${language==='und'?'Local subtitles':english(language)?'English':language} · ${name.slice(stem.length+1)}`,source:'sidecar',url:`/api/media/${row.id}/subtitle-files/${id}`},file:path});
      } catch {/*Untrusted or unreadable sidecars are not exposed.*/}
    }
    return output;
  }
  async inventory(row:MediaRow):Promise<SubtitleInventory> {
    const m=publicMedia(row);
    const tracks:SubtitleFile[]=m.streams.filter(s=>s.type==='subtitle').map(s=>({id:`embedded-${s.index}`,language:s.language||'und',label:[s.title,s.language||'Unknown language',`Track ${s.index}`].filter(Boolean).join(' · '),source:'embedded',embeddedIndex:s.index,nativeOnly:!textCodecs.has(s.codec),url:`/api/media/${row.id}/subtitles/${s.index}?v=${encodeURIComponent(version(row))}`}));
    const local=await this.sidecars(row);tracks.push(...local.map(s=>s.track));
    const cached=this.cached(row);if(cached)tracks.unshift({id:'subdl',language:cached.language,label:cached.label,source:'subdl',sourceUrl:cached.source_url,url:`/api/media/${row.id}/subtitle-files/subdl?v=${cached.added_at}`});
    return {tracks,providerConfigured:this.configured};
  }
  async content(row:MediaRow,id:string) {
    await this.file(row);
    if(id==='subdl'){const cached=this.cached(row);if(cached)return cached.content;}
    else {const found=(await this.sidecars(row)).find(s=>s.track.id===id);if(found){const info=await stat(found.file);if(info.size>subtitleLimit)throw new Error('Subtitle file is too large.');return normalizeSubtitles(await readFile(found.file,'utf8'));}}
    throw Object.assign(new Error('Subtitle file not found.'),{statusCode:404});
  }
  async source(row:MediaRow,force=false):Promise<SourceResult> {
    if(!this.provider)throw Object.assign(new Error('Configure the server’s SubDL API key first.'),{statusCode:409});
    if(!force&&this.cached(row))return 'cached';
    if(this.status.cooldownUntil>Date.now())return 'quota';
    let result:SourceResult='no-match';
    try {
      const {file}=await this.file(row),media=publicMedia(row);
      const candidates=await this.provider.search(media,file,this.abort.signal);
      for(const candidate of candidates) {
        const text=await this.provider.download(candidate,this.abort.signal);
        let content:string;try{content=normalizeSubtitles(text,media.duration);}catch{result='invalid';continue;}
        await this.file(row);
        const current=this.db.prepare('SELECT mtime,size FROM media WHERE id=?').get(row.id) as MediaRow|undefined;
        if(!current||version(current)!==version(row))return 'changed';
        this.db.prepare('INSERT INTO subtitle_downloads VALUES(?,?,?,?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET version=excluded.version,language=excluded.language,label=excluded.label,source_url=excluded.source_url,content=excluded.content,added_at=excluded.added_at').run(row.id,version(row),'en','English · SubDL · release match',candidate.sourceUrl,content,Date.now());
        result='downloaded';break;
      }
    } catch(e) {
      if(this.stopped)return 'unavailable';
      if(e instanceof SubtitleProviderError){result=e.kind==='invalid'?'invalid':e.kind;this.status.lastError=e.message;if(e.kind==='quota')this.status.cooldownUntil=Date.now()+e.retryAfter*1000;}
      else if((e as {statusCode?:number}).statusCode===409)result='changed';
      else {result='unavailable';this.status.lastError='Subtitle sourcing could not finish. Check the library file and provider configuration.';}
    }
    // A concurrent library removal must not create an orphan or fail shutdown.
    if(this.db.prepare('SELECT id FROM media WHERE id=?').get(row.id))this.db.prepare('INSERT INTO subtitle_attempts VALUES(?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET version=excluded.version,attempted_at=excluded.attempted_at,status=excluded.status').run(row.id,version(row),Date.now(),result);
    return result;
  }
  start(id?:string,force=false) {
    if(this.status.running||!this.provider||this.stopped)return false;
    Object.assign(this.status,{running:true,checked:0,downloaded:0,unmatched:0,errors:0,lastError:'',startedAt:Date.now(),finishedAt:0});
    this.task=this.run(id,force).catch(()=>{this.status.errors++;this.status.lastError='Subtitle sourcing stopped unexpectedly.';}).finally(()=>{this.status.running=false;this.status.finishedAt=Date.now();});
    return true;
  }
  private async run(id?:string,force=false) {
    const rows=(id?this.db.prepare('SELECT * FROM media WHERE id=? AND available=1').all(id):this.db.prepare('SELECT * FROM media WHERE available=1 ORDER BY added_at DESC').all()) as MediaRow[];
    for(const row of rows) {
      if(this.stopped||this.status.checked>=20||this.status.cooldownUntil>Date.now())break;
      // Maintenance yields for actively streamed media and recent watch progress.
      // Downloads stay separate and never change the active player's track list.
      const recent=this.db.prepare('SELECT MAX(updated_at) AS updated FROM progress WHERE media_id=?').get(row.id) as {updated:number|null};
      if(!id&&Math.max(this.activeMedia.get(row.id)||0,recent.updated||0)>Date.now()-120_000)continue;
      const old=this.db.prepare('SELECT * FROM subtitle_attempts WHERE media_id=?').get(row.id) as {version:string;attempted_at:number}|undefined;
      if(!force&&(this.cached(row)||old?.version===version(row)&&old.attempted_at>Date.now()-86400_000))continue;
      const result=await this.source(row,force);this.status.checked++;
      if(result==='downloaded')this.status.downloaded++;else if(result==='no-match'||result==='invalid')this.status.unmatched++;else if(result!=='cached')this.status.errors++;
      if(result==='quota'||result==='credentials')break;
    }
  }
  async audit() {
    const rows=this.db.prepare('SELECT * FROM media WHERE available=1').all() as MediaRow[];
    const items=[];
    for(const row of rows) {
      const media=publicMedia(row),tracks=media.streams.filter(s=>s.type==='subtitle'&&english(s.language));
      let localEnglish=false,error:string|undefined;
      try{localEnglish=(await this.sidecars(row)).some(s=>english(s.track.language));}catch{error='File unavailable or changed; scan the library.';}
      const downloaded=!!this.cached(row),text=tracks.some(s=>textCodecs.has(s.codec));
      items.push({id:row.id,title:media.title,series:media.series,season:media.season,episode:media.episode,embeddedEnglish:tracks.length,textEnglish:text,sidecarEnglish:localEnglish,downloaded,needsEnglish:!tracks.length&&!localEnglish&&!downloaded,browserNeedsText:!text&&!localEnglish&&!downloaded,error});
    }
    return {total:items.length,missingEnglish:items.filter(x=>x.needsEnglish).length,browserNeedsText:items.filter(x=>x.browserNeedsText).length,accuracyVerified:false,items};
  }
  async close(){this.stopped=true;this.abort.abort();await this.task;}
}
