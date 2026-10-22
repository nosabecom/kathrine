import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import { mkdir, stat, realpath, access, readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpus, freemem, totalmem, hostname, loadavg, uptime } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { openDatabase, mediaSelect, publicMedia, type MediaRow } from './db.js';
import { registerAuth } from './auth.js';
import { Scanner, checkedPath } from './library.js';
import { negotiate, parseRange, capabilitySchema } from './playback.js';
import { Conversions } from './conversions.js';
import { shiftWebVtt } from './subtitles.js';
import { buildSeries, catalog } from './catalog.js';
import { MetadataEnricher } from './metadata.js';
import { ArtworkStore, fileImageType } from './artwork.js';

const exec=promisify(execFile);
export async function createApp(options: Partial<typeof config> = {}) {
  const cfg={...config,...options};
  const app=Fastify({logger:process.env.NODE_ENV!=='test' ? { redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie'], serializers:{req:r=>({method:r.method,url:r.url.split('?')[0],remoteAddress:r.ip})} }:false,bodyLimit:64*1024,trustProxy:false});
  const db=openDatabase(cfg.dataDir);
  await app.register(cookie);
  await app.register(rateLimit,{max:3000,timeWindow:'1 minute'});
  const {authenticate,admin}=registerAuth(app,db,cfg.dataDir,cfg.secureCookie);
  const scanner=new Scanner(db,cfg.ffprobe,new MetadataEnricher(join(cfg.dataDir,'metadata')),cfg.metadataEnabled);
  const artwork=new ArtworkStore(join(cfg.dataDir,'images','artwork'));
  const conversions=new Conversions({root:join(cfg.dataDir,'streams'),ffmpeg:cfg.ffmpeg,max:cfg.maxConversions,cacheLimit:cfg.cacheLimit});
  await conversions.initialize();
  await mkdir(join(cfg.dataDir,'images'),{recursive:true});
  const thumbs=new Map<string,Promise<string>>();
  let thumbnailTail=Promise.resolve();
  const getRow=(id:string) => db.prepare('SELECT * FROM media WHERE id=?').get(id) as MediaRow | undefined;
  const getMedia=(id:string,userId:string) => db.prepare(mediaSelect+' WHERE m.id=?').get(userId,id) as MediaRow | undefined;
  async function mediaFile(row:MediaRow) {
    const library=db.prepare('SELECT path FROM libraries WHERE id=?').get(row.library_id) as {path:string}|undefined;
    if(!library || !row.available)throw Object.assign(new Error('This media file is unavailable.'),{statusCode:404});
    try{return await checkedPath(row.path,library.path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw Object.assign(new Error('The media file is no longer available.'),{statusCode:404});throw e;}
  }
  const mediaParam=z.object({id:z.string().max(100)});
  app.addHook('onSend',async(_req,reply,payload)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return payload;
  });
  app.setErrorHandler((error,req,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
    const e=error as Error & {statusCode?:number};
    const code=e.statusCode && e.statusCode>=400 && e.statusCode<600 ? e.statusCode : 500;
    if(code===500) req.log.error(error);
    reply.code(code).send({error:code===500?'The server could not complete the request. Check its logs.':e.message});
  });
  app.get('/api/health',async()=>({name:'Kathrine',version:'0.1.0',ok:true}));
  app.get('/api/libraries',{preHandler:authenticate},async req=>db.prepare(`SELECT l.id,l.name,l.kind,${req.user.admin?'l.path,':''}count(m.id) as count FROM libraries l LEFT JOIN media m ON m.library_id=l.id AND m.available=1 GROUP BY l.id ORDER BY l.name`).all());
  app.post('/api/libraries',{preHandler:admin},async(req,reply)=>{
    const body=z.object({name:z.string().trim().min(1).max(80),path:z.string().min(1).max(4096),kind:z.enum(['movies','shows','mixed'])}).parse(req.body);
    const path=await realpath(body.path).catch(()=>null);
    if(!path || !(await stat(path)).isDirectory())return reply.code(400).send({error:'That library folder does not exist or is not readable.'});
    // Refuse system directories as library roots.
    if(['/','/etc','/proc','/sys','/dev','/boot','/run'].some(p=>path===p || (p!=='/'&&path.startsWith(p+'/'))))return reply.code(400).send({error:'Choose a media folder rather than a system directory.'});
    const library={id:randomUUID(),...body,path};
    try{db.prepare('INSERT INTO libraries VALUES(?,?,?,?)').run(library.id,library.name,path,library.kind);}catch{return reply.code(409).send({error:'That folder is already a library.'});}
    scanner.start(); return library;
  });
  app.delete('/api/libraries/:id',{preHandler:admin},async(req,reply)=>{
    if(scanner.status.running)return reply.code(409).send({error:'Wait for the library scan to finish.'});
    const {id}=mediaParam.parse(req.params);db.prepare('DELETE FROM libraries WHERE id=?').run(id);return {ok:true};
  });
  app.post('/api/scan',{preHandler:admin},async(_req,reply)=>{reply.code(202);return{started:scanner.start(),...scanner.status};});
  app.get('/api/scan',{preHandler:admin},async()=>scanner.status);
  app.get('/api/catalog',{preHandler:authenticate},async req=>{
    const q=z.object({library:z.string().optional(),q:z.string().max(200).optional(),view:z.enum(['all','continue','favorites','movies','shows']).default('all'),limit:z.coerce.number().int().min(1).max(1000).default(250),offset:z.coerce.number().int().min(0).default(0)}).parse(req.query);
    const clauses=['m.available=1'],params:(string|number)[]=[req.user.id];
    if(q.library){clauses.push('m.library_id=?');params.push(q.library);}
    if(q.view==='shows')clauses.push("(m.library_id IN (SELECT id FROM libraries WHERE kind='shows') OR length(trim(COALESCE(json_extract(m.metadata,'$.series'),'')))>0)");
    if(q.view==='movies')clauses.push("m.library_id IN (SELECT id FROM libraries WHERE kind IN ('movies','mixed')) AND length(trim(COALESCE(json_extract(m.metadata,'$.series'),'')))=0");
    const rows=db.prepare(mediaSelect+' WHERE '+clauses.join(' AND ')).all(...params) as unknown as MediaRow[];
    return catalog(rows.map(publicMedia),q);
  });
  app.get('/api/series/:id',{preHandler:authenticate},async(req,reply)=>{
    const {id}=mediaParam.parse(req.params);
    const rows=db.prepare(mediaSelect+' WHERE m.available=1').all(req.user.id) as unknown as MediaRow[];
    const series=buildSeries(rows.map(publicMedia)).find(s=>s.id===id);
    return series||reply.code(404).send({error:'Series not found.'});
  });
  app.get('/api/media',{preHandler:authenticate},async req=>{
    const q=z.object({library:z.string().optional(),q:z.string().max(200).optional(),view:z.enum(['all','continue','favorites','movies','shows']).default('all'),limit:z.coerce.number().int().min(1).max(1000).default(250),offset:z.coerce.number().int().min(0).default(0)}).parse(req.query);
    const clauses=['m.available=1'], params:(string|number)[]=[req.user.id];
    if(q.library){clauses.push('m.library_id=?');params.push(q.library);}
    if(q.q){clauses.push("(json_extract(m.metadata,'$.title') LIKE ? ESCAPE '\\' OR json_extract(m.metadata,'$.series') LIKE ? ESCAPE '\\')");const escaped='%'+q.q.replace(/[\\%_]/g,'\\$&')+'%';params.push(escaped,escaped);}
    if(q.view==='continue')clauses.push('p.position>0 AND p.completed=0');
    if(q.view==='favorites')clauses.push('p.favorite=1');
    if(q.view==='movies'||q.view==='shows'){clauses.push('m.library_id IN (SELECT id FROM libraries WHERE kind=?)');params.push(q.view);}
    const where=' WHERE '+clauses.join(' AND ');
    const total=db.prepare('SELECT count(*) as total FROM media m LEFT JOIN progress p ON p.media_id=m.id AND p.user_id=?'+where).get(...params) as {total:number};
    const rows=db.prepare(mediaSelect+where+(q.view==='continue'?' ORDER BY p.updated_at DESC':" ORDER BY json_extract(m.metadata,'$.sortTitle') COLLATE NOCASE")+' LIMIT ? OFFSET ?').all(...params,q.limit,q.offset) as unknown as MediaRow[];
    return{items:rows.map(publicMedia),total:total.total};
  });
  app.get('/api/media/:id',{preHandler:authenticate},async(req,reply)=>{const{id}=mediaParam.parse(req.params);const row=getMedia(id,req.user.id);return row?publicMedia(row):reply.code(404).send({error:'Media not found.'});});
  app.put('/api/media/:id/progress',{preHandler:authenticate},async(req,reply)=>{
    const{id}=mediaParam.parse(req.params),row=getRow(id);if(!row)return reply.code(404).send({error:'Media not found.'});
    const body=z.object({position:z.number().finite().nonnegative().optional(),completed:z.boolean().optional(),favorite:z.boolean().optional()}).parse(req.body);
    const old=db.prepare('SELECT * FROM progress WHERE user_id=? AND media_id=?').get(req.user.id,id) as {position:number;completed:number;favorite:number}|undefined;
    const duration=publicMedia(row).duration;
    const position=Math.min(body.position??old?.position??0,duration||Number.MAX_SAFE_INTEGER);
    const completed=body.completed??(body.position===undefined?!!old?.completed:duration>0&&position/duration>=0.95);
    db.prepare('INSERT INTO progress VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,completed=excluded.completed,favorite=excluded.favorite,updated_at=excluded.updated_at').run(req.user.id,id,position,Number(completed),Number(body.favorite??!!old?.favorite),Date.now());return{ok:true};
  });
  app.get('/api/media/:id/image',{preHandler:authenticate},async(req,reply)=>{
    const{id}=mediaParam.parse(req.params),row=getRow(id);if(!row)return reply.code(404).send({error:'Media not found.'});
    const file=await mediaFile(row),metadata=JSON.parse(row.metadata);
    const {kind}=z.object({kind:z.enum(['auto','poster','backdrop','still','season']).default('auto')}).parse(req.query);
    const requested=kind==='auto'?(metadata.series?'still':'poster'):kind;
    const library=db.prepare('SELECT path FROM libraries WHERE id=?').get(row.library_id) as {path:string};
    const found=await artwork.resolve(file,library.path,metadata,requested);
    if(found){const type=await fileImageType(found);if(type){reply.type(type).header('Cache-Control','private, max-age=86400');return reply.send(createReadStream(found));}}
    const image=join(cfg.dataDir,'images',`${id}-${Math.floor(row.mtime)}.jpg`);
    if(!existsSync(image)) {
      if(!thumbs.has(id)) {
        let done!:()=>void;const previous=thumbnailTail;thumbnailTail=new Promise<void>(r=>{done=r;});
        const work=(async()=>{await previous;try{await exec(cfg.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-threads','1','-filter_threads','1','-ss',String(Math.min(30,publicMedia(row).duration/3)),'-i',file,'-frames:v','1','-vf','scale=480:-2','-q:v','5','-y',image],{timeout:30_000});return image;}finally{done();thumbs.delete(id);}})();thumbs.set(id,work);
      }
      try{await thumbs.get(id);}catch{return reply.code(404).send({error:'No artwork is available.'});}
    }
    // A temporary provider failure must not pin a generated frame in the client cache.
    reply.type('image/jpeg').header('Cache-Control','private, no-cache');return reply.send(createReadStream(image));
  });
  app.post('/api/media/:id/playback',{preHandler:authenticate},async(req,reply)=>{
    const{id}=mediaParam.parse(req.params),row=getMedia(id,req.user.id);if(!row)return reply.code(404).send({error:'Media not found.'});
    const body=z.object({capabilities:capabilitySchema,allowCompatibility:z.boolean().default(false),audioIndex:z.number().int().optional(),startAt:z.number().finite().nonnegative().default(0)}).parse(req.body);
    const media=publicMedia(row),file=await mediaFile(row);
    const plan=negotiate(media,body.capabilities,{audioIndex:body.audioIndex,allowCompatibility:body.allowCompatibility,allowVideoTranscode:cfg.allowVideoTranscode});
    if(plan.mode==='unsupported')return{plan,url:null};
    if(plan.mode==='direct')return{plan,url:`/stream/${id}/original`,offset:0,resumeAt:body.startAt,mimeType:media.container==='mkv'?'video/x-matroska':media.container==='ts'?'video/mp2t':`video/${media.container}`};
    const offset=Math.min(body.startAt,Math.max(0,media.duration-1));
    const job=await conversions.start(req.user.id,media,file,plan,offset);
    try{await conversions.ready(job);}catch(e){await conversions.stop(job.id);throw e;}
    return{plan,url:`/stream/hls/${job.id}/index.m3u8`,sessionId:job.id,offset,mimeType:'application/x-mpegURL',resumeAt:0};
  });
  app.route({method:['GET','HEAD'],url:'/stream/:id/original',preHandler:authenticate,handler:async(req,reply)=>{
    const{id}=mediaParam.parse(req.params),row=getRow(id);if(!row)return reply.code(404).send({error:'Media not found.'});
    const file=await mediaFile(row),info=await stat(file);
    const etag=`"${row.id}-${info.size}-${Math.floor(info.mtimeMs)}"`;
    const useRange=!req.headers['if-range']||req.headers['if-range']===etag;
    const range=parseRange(useRange?req.headers.range:undefined,info.size);
    reply.header('Accept-Ranges','bytes').header('ETag',etag).header('Cache-Control','private, no-store');
    if(!range){reply.header('Content-Range',`bytes */${info.size}`);return reply.code(416).send();}
    const media=publicMedia(row);
    const mime:Record<string,string>={mkv:'video/x-matroska',mp4:'video/mp4',webm:'video/webm',ts:'video/mp2t',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg'};
    reply.type(mime[media.container]||'application/octet-stream').header('Content-Length',info.size===0?0:range.end-range.start+1);
    if(range.partial)reply.code(206).header('Content-Range',`bytes ${range.start}-${range.end}/${info.size}`);
    if(req.method==='HEAD'||info.size===0)return reply.send();
    return reply.send(createReadStream(file,{start:range.start,end:range.end}));
  }});
  app.get('/stream/hls/:session/:file',{preHandler:authenticate},async(req,reply)=>{
    const {session,file}=z.object({session:z.string().uuid(),file:z.string().regex(/^(index\.m3u8|init\.mp4|segment-\d{6}\.m4s)$/)}).parse(req.params);
    const job=conversions.jobs.get(session);
    if(!job || job.userId!==req.user.id)return reply.code(404).send({error:'Playback session has expired.'});
    job.touched=Date.now();if(job.error)return reply.code(422).send({error:'Conversion failed: '+job.error.slice(-500)});
    const path=join(job.dir,file);try{await access(path);}catch{return reply.code(404).send({error:'That segment is not ready.'});}
    reply.header('Cache-Control','private, no-store').type(file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp4');return reply.send(createReadStream(path));
  });
  app.delete('/api/playback/:id',{preHandler:authenticate},async(req,reply)=>{const{id}=mediaParam.parse(req.params);const job=conversions.jobs.get(id);if(job&&job.userId!==req.user.id)return reply.code(403).send({error:'This session belongs to someone else.'});await conversions.stop(id);return{ok:true};});
  app.get('/api/media/:id/subtitles/:index',{preHandler:authenticate},async(req,reply)=>{
    const{id,index}=z.object({id:z.string(),index:z.coerce.number().int().nonnegative()}).parse(req.params),row=getRow(id);if(!row)return reply.code(404).send({error:'Media not found.'});
    const {offset}=z.object({offset:z.coerce.number().finite().nonnegative().max(1e9).default(0)}).parse(req.query);
    const stream=publicMedia(row).streams.find(s=>s.index===index&&s.type==='subtitle');
    if(!stream || !['subrip','ass','ssa','webvtt','mov_text','text'].includes(stream.codec))return reply.code(422).send({error:'This subtitle format needs the native player.'});
    const file=await mediaFile(row);
    const{stdout}=await exec(cfg.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',file,'-map',`0:${index}`,'-f','webvtt','-'],{timeout:30_000,maxBuffer:10*1024*1024});
    reply.type('text/vtt').header('Cache-Control','private, max-age=3600');return shiftWebVtt(stdout,offset);
  });
  app.get('/api/status',{preHandler:authenticate},async()=>({
    name:'Kathrine',hostname:hostname(),uptime:uptime(),cpu:cpus()[0]?.model,cores:cpus().length,load:loadavg()[0],memory:{total:totalmem(),free:freemem()},
    mediaCount:(db.prepare('SELECT count(*) as n FROM media WHERE available=1').get() as{n:number}).n,
    conversions:[...conversions.jobs.values()].map(j=>({id:j.id,mediaId:j.mediaId,mode:j.plan.mode,done:j.done,error:j.error?true:false})),videoTranscodeEnabled:cfg.allowVideoTranscode,scan:scanner.status,
  }));
  app.get('/api/network-test',{preHandler:authenticate,config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async(_req,reply)=>{reply.type('application/octet-stream').header('Cache-Control','no-store');return Buffer.alloc(8*1024*1024,0x73);});
  const downloadDir=join(cfg.dataDir,'downloads');await mkdir(downloadDir,{recursive:true});
  await app.register(staticFiles,{root:downloadDir,prefix:'/downloads/',decorateReply:false,list:false,index:false,allowedPath:path=>/^kathrine-(phone|tv)\.apk$/.test(basename(path))});
  if(existsSync(cfg.webDir)) {
    await app.register(staticFiles,{root:cfg.webDir,prefix:'/',wildcard:false});
    app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')||req.url.startsWith('/stream/')||req.url.startsWith('/downloads/')?reply.code(404).send({error:'Not found.'}):reply.sendFile('index.html'));
  }
  const autoScan=setInterval(()=>scanner.start(),30*60_000);autoScan.unref();
  app.addHook('onClose',async()=>{clearInterval(autoScan);await scanner.close();await Promise.allSettled(thumbs.values());await conversions.close();db.close();});
  return {app,db,scanner,conversions,cfg};
}
