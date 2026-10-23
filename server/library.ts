import { readdir, stat, realpath, readFile } from 'node:fs/promises';
import { extname, basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { DB, MediaRow } from './db.js';
import type { Media, MediaStream, ScanStatus } from '../shared/types.js';
import { MetadataEnricher, type MetadataRecord } from './metadata.js';
import { checkedPath } from './paths.js';
export { checkedPath } from './paths.js';

const execute = promisify(execFile);
const extensions = new Set(['.mkv','.mp4','.m4v','.webm','.avi','.mov','.ts','.m2ts','.mpg','.mpeg']);
const text = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
const number = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const xml = new XMLParser({ ignoreAttributes: true, processEntities: false });

export async function probe(file: string, ffprobe: string, root = dirname(file)): Promise<Omit<Media, 'id'|'libraryId'|'addedAt'|'available'|'position'|'completed'|'favorite'>> {
  const { stdout } = await execute(ffprobe, ['-v','error','-show_format','-show_streams','-of','json',file], { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  const streams: MediaStream[] = (data.streams || []).filter((s: any) => ['video','audio','subtitle'].includes(s.codec_type) && !s.disposition?.attached_pic).map((s: any) => {
    const [a,b] = (s.avg_frame_rate || '0/1').split('/').map(Number);
    const side = s.side_data_list || [];
    const dovi = side.find((v:any) => /dovi/i.test(v.side_data_type));
    const hdrFallbacks = dovi?.dv_bl_signal_compatibility_id === 1 ? ['hdr10'] : dovi?.dv_bl_signal_compatibility_id === 4 ? ['hlg'] : dovi?.dv_bl_signal_compatibility_id === 2 ? ['sdr'] : undefined;
    const hdr = side.some((v: any) => /dovi/i.test(v.side_data_type)) ? 'dolby-vision' : s.color_transfer === 'smpte2084' ? 'hdr10' : s.color_transfer === 'arib-std-b67' ? 'hlg' : undefined;
    return { index: s.index, codec: s.codec_name || 'unknown', type: s.codec_type, profile: s.profile, width: s.width, height: s.height, frameRate: b ? a/b : undefined, bitDepth: number(s.bits_per_raw_sample) || (/10|12/.test(s.pix_fmt || '') ? Number((s.pix_fmt as string).match(/(10|12)/)?.[1]) : 8), channels: s.channels, channelLayout: s.channel_layout, language: text(s.tags?.language), title: text(s.tags?.title), hdr, hdrFallbacks, dolbyVisionProfile:dovi?.dv_profile, default: !!s.disposition?.default, forced: !!s.disposition?.forced };
  });
  if (!streams.some(s => s.type === 'video')) throw new Error('No video stream found.');
  const stem = basename(file, extname(file));
  const episode = stem.match(/S(\d{1,2})E(\d{1,3})/i);
  const year = stem.match(/(?:^|[. (])((?:19|20)\d{2})(?:[. )]|$)/)?.[1];
  let title = stem.replace(/[._]/g,' ').replace(/\s+/g,' ').trim();
  const marker = title.search(/\b(?:19\d{2}|20\d{2}|2160p|1080p|720p|4320p|WEB[- ]?DL|BluRay|x26[45])\b/i);
  if (marker > 0) title = title.slice(0,marker).replace(/[ (.-]+$/,'');
  let nfo: any = {};
  for (const candidate of [join(dirname(file), stem+'.nfo'), join(dirname(file),'movie.nfo')]) {
    try {
      const checked = await checkedPath(candidate, root);
      if ((await stat(checked)).size > 2 * 1024 * 1024) continue;
      const parsed = xml.parse(await readFile(checked,'utf8')); nfo = parsed.movie || parsed.episodedetails || {}; if (nfo.title) break;
    } catch { /* Sidecar metadata is optional and must remain inside the library. */ }
  }
  const duration = number(data.format?.duration) || Math.max(...streams.map(() => 0));
  const size = number(data.format?.size);
  const ext = extname(file).slice(1).toLowerCase();
  return { title: text(nfo.title) || title, sortTitle: text(nfo.sorttitle) || text(nfo.title) || title, overview: text(nfo.plot), year: number(nfo.year) || (year ? Number(year) : undefined), series: text(nfo.showtitle) || (episode ? stem.slice(0,episode.index).replace(/[._]/g,' ').trim() : undefined), season: number(nfo.season) || (episode ? Number(episode[1]) : undefined), episode: number(nfo.episode) || (episode ? Number(episode[2]) : undefined), duration, size, bitrate: number(data.format?.bit_rate) || (duration ? size*8/duration : 0), container: ['m4v','mov'].includes(ext) ? 'mp4' : ext === 'm2ts' ? 'ts' : ext, streams };
}

export class Scanner {
  status: ScanStatus = { running:false, scanned:0, added:0, errors:[], startedAt:null, finishedAt:null };
  private work?: Promise<void>;
  private stopped = false;
  constructor(private db: DB, private ffprobe: string, private metadata:MetadataEnricher, private onlineMetadata=true) {}
  start() {
    if (this.status.running) return false;
    this.status = { running:true, scanned:0, added:0, errors:[], startedAt:Date.now(), finishedAt:null };
    this.metadata.beginScan();
    this.work = this.scan().finally(() => { this.status.running=false; this.status.finishedAt=Date.now(); });
    return true;
  }
  async close() { this.stopped=true; await this.work; }
  private async scan() {
    for (const library of this.db.prepare('SELECT * FROM libraries').all() as unknown as {id:string;path:string}[]) {
      if(this.stopped) return;
      const found = new Set<string>();
      let complete = true;
      const walk = async (directory: string): Promise<void> => {
        let entries;
        try { entries = await readdir(directory, {withFileTypes:true}); }
        catch { complete=false; this.error(`Cannot read library folder: ${directory}`); return; }
        for(const entry of entries) {
          if(this.stopped) return;
          if(entry.name.startsWith('.') || (entry.isDirectory() && /^(sample|samples|extras|featurettes|behind the scenes)$/i.test(entry.name))) continue;
          const file = join(directory,entry.name);
          if(entry.isDirectory()) { await walk(file); continue; }
          // Symlinks are intentionally not followed: library roots define the access boundary.
          if(!entry.isFile() || !extensions.has(extname(file).toLowerCase()) || /(?:^|[. _-])sample(?:[. _-]|$)/i.test(basename(file,extname(file)))) continue;
          found.add(file);
          this.status.scanned++;
          try {
            const info = await stat(file);
            const old = this.db.prepare('SELECT * FROM media WHERE path=?').get(file) as MediaRow | undefined;
            const unchanged=old && old.mtime===info.mtimeMs && old.size===info.size;
            const previous:MetadataRecord|undefined=unchanged?JSON.parse(old.metadata):undefined;
            if(previous?.metadataVersion===3 && (previous.metadataRefreshAfter||0)>Date.now()) { this.db.prepare('UPDATE media SET available=1 WHERE id=?').run(old!.id); continue; }
            const technical=previous && [2,3].includes(previous.metadataVersion||0)?previous:await probe(file,this.ffprobe,library.path);
            const meta=await this.metadata.enrich(technical,file,library.path,this.onlineMetadata);
            if(this.stopped) return;
            const id = old?.id || createHash('sha256').update(file).digest('hex').slice(0,32);
            this.db.prepare('INSERT INTO media(id,library_id,path,mtime,size,metadata,added_at,available) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET mtime=excluded.mtime,size=excluded.size,metadata=excluded.metadata,available=1').run(id,library.id,file,info.mtimeMs,info.size,JSON.stringify({...meta,metadataVersion:3}),old?.added_at || Date.now());
            this.status.added++;
          } catch(e) { this.error(`${basename(file)}: ${(e as Error).message.slice(0,240)}`); }
        }
      };
      await walk(library.path);
      if(complete && !this.stopped) for(const row of this.db.prepare('SELECT id,path FROM media WHERE library_id=?').all(library.id) as unknown as {id:string;path:string}[]) {
        if(!found.has(row.path)) this.db.prepare('UPDATE media SET available=0 WHERE id=?').run(row.id);
      }
    }
  }
  private error(message: string) { if(this.status.errors.length < 100) this.status.errors.push(message); }
}
