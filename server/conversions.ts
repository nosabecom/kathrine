import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, rm, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Media, PlaybackPlan } from '../shared/types.js';

export type Conversion = { id:string; userId:string; mediaId:string; dir:string; process:ChildProcess; touched:number; created:number; done:boolean; error?:string; stderr:string; offset:number; plan:PlaybackPlan };
export class Conversions {
  jobs = new Map<string,Conversion>();
  private timer: NodeJS.Timeout;
  private reaping = false;
  private starting = 0;
  constructor(private options:{root:string;ffmpeg:string;max:number;cacheLimit:number}) {
    this.timer=setInterval(()=>void this.reap(),30_000); this.timer.unref();
  }
  async initialize() { await mkdir(this.options.root,{recursive:true,mode:0o700}); for(const name of await readdir(this.options.root)) if(/^[\da-f-]{36}$/.test(name)) await rm(join(this.options.root,name),{recursive:true,force:true}); }
  async start(userId:string, media:Media, file:string, plan:PlaybackPlan, offset=0) {
    if(this.starting+[...this.jobs.values()].filter(j=>!j.done).length>=this.options.max) throw Object.assign(new Error('The server is already converting a stream. Direct play is still available.'),{statusCode:429});
    this.starting++;
    const id=randomUUID(), dir=join(this.options.root,id);
    try {await mkdir(dir,{mode:0o700});}catch(e){this.starting--;throw e;}
    const video=media.streams.find(s=>s.index===plan.videoIndex);
    const args=['-hide_banner','-loglevel','warning','-nostdin','-threads','2','-filter_threads','2'];
    if(offset>0) args.push('-ss',String(offset));
    // Prepare ahead without racing through a whole large source and competing with direct streams for disk IO.
    args.push('-readrate','1.5','-i',file,'-map',`0:${plan.videoIndex}`);
    if(plan.audioIndex!==undefined) args.push('-map',`0:${plan.audioIndex}`);
    if(plan.mode==='transcode') {
      const filter=video?.hdr ? "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p" : "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p";
      args.push('-c:v','libx264','-preset','veryfast','-crf','22','-maxrate','8M','-bufsize','16M','-vf',filter,'-force_key_frames','expr:gte(t,n_forced*4)','-threads','2');
    } else { args.push('-c:v','copy'); if(video?.codec==='hevc') args.push('-tag:v','hvc1'); }
    if(plan.audioIndex!==undefined) args.push(...(plan.audioPreserved?['-c:a','copy']:['-c:a','aac','-ac','2','-b:a','192k']));
    args.push('-sn','-dn','-max_muxing_queue_size','4096','-f','hls','-hls_time','4','-hls_segment_type','fmp4','-hls_playlist_type','event','-hls_flags','independent_segments+temp_file','-hls_segment_filename',join(dir,'segment-%06d.m4s'),join(dir,'index.m3u8'));
    const process=spawn(this.options.ffmpeg,args,{stdio:['ignore','ignore','pipe']});
    const job:Conversion={id,userId,mediaId:media.id,dir,process,touched:Date.now(),created:Date.now(),done:false,stderr:'',offset,plan};
    this.jobs.set(id,job);
    this.starting--;
    process.stderr?.on('data',chunk=>{job.stderr=(job.stderr+chunk.toString()).slice(-4000);});
    process.on('error',e=>{job.done=true;job.error=e.message;});
    process.on('exit',(code,signal)=>{job.done=true; if(code!==0&&!signal) job.error=job.stderr || `FFmpeg exited ${code}.`;});
    return job;
  }
  async ready(job:Conversion) {
    const deadline=Date.now()+20_000;
    while(Date.now()<deadline) {
      if(job.error) throw Object.assign(new Error('Compatibility conversion failed: '+job.error.slice(-500)),{statusCode:422});
      try { const content=await readFile(join(job.dir,'index.m3u8'),'utf8'); if(content.includes('#EXTINF')) return; } catch { /* Waiting for first segment. */ }
      await new Promise(r=>setTimeout(r,200));
    }
    await this.stop(job.id);
    throw Object.assign(new Error('The server could not prepare the first segment within 20 seconds. Try original playback on the Android app.'),{statusCode:504});
  }
  async stop(id:string) {
    const job=this.jobs.get(id); if(!job)return;
    this.jobs.delete(id);
    if(!job.done) {
      const exited = new Promise<void>(r=>job.process.once('exit',()=>r()));
      job.process.kill('SIGTERM');
      const hard=setTimeout(()=>job.process.kill('SIGKILL'),2000); hard.unref();
      await Promise.race([exited,new Promise(r=>setTimeout(r,2500))]); clearTimeout(hard);
    }
    await rm(job.dir,{recursive:true,force:true});
  }
  private async reap() {
    if(this.reaping)return; this.reaping=true;
    try {
      let total=0;
      for(const job of [...this.jobs.values()].sort((a,b)=>a.created-b.created)) {
        let size=0;
        try { for(const f of await readdir(job.dir)) size+=(await stat(join(job.dir,f))).size; }catch {continue;}
        total+=size;
        if(Date.now()-job.touched>15*60_000 || total>this.options.cacheLimit) await this.stop(job.id);
      }
    } finally {this.reaping=false;}
  }
  async close() {clearInterval(this.timer); await Promise.all([...this.jobs.keys()].map(id=>this.stop(id)));}
}
