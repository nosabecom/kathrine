import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, open, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app.js';
process.env.NODE_ENV='test';
const execute=promisify(execFile);
test('server authentication, library, original playback, compatibility, and isolation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kathrine-')),data=join(root,'data'),library=join(root,'library');await mkdir(library);
  const file=join(library,'Example.2024.1080p.mkv');
  const subtitles=join(root,'captions.srt');await writeFile(subtitles,'1\n00:00:00,000 --> 00:00:01,000\nBefore resume\n\n2\n00:00:02,000 --> 00:00:04,000\nSpans resume\n\n3\n00:00:05,000 --> 00:00:06,000\nAfter resume\n');
  await execute('ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-i',subtitles,'-map','0:v:0','-map','1:a:0','-map','1:a:0','-map','2:s:0','-c:s','srt','-t','6','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a:0','eac3','-c:a:1','aac','-b:a','192k',file]);
  await writeFile(join(library,'Example.2024.1080p.nfo'),'<movie><title>Example from NFO</title><year>2024</year><plot>Local metadata works.</plot></movie>');
  await mkdir(join(library,'Sample'));
  await copyFile(file,join(library,'Sample','preview.mkv'));
  await copyFile(file,join(library,'Example.sample.mkv'));
  const {app,db,scanner,conversions}=await createApp({dataDir:data,webDir:join(root,'missing'),maxConversions:1,metadataEnabled:false});
  let token='',viewerToken='',id='',media:any;
  const request=async(method:'GET'|'POST'|'PUT'|'DELETE'|'HEAD',url:string,payload?:any,auth=token,headers:Record<string,string>={})=>app.inject({method,url,payload,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...headers}});
  try{
    await t.test('health is public; library and original streams require authentication',async()=>{assert.equal((await request('GET','/api/health')).statusCode,200);assert.equal((await request('GET','/api/media')).statusCode,401);assert.equal((await request('GET','/api/catalog')).statusCode,401);assert.equal((await request('GET','/api/series/unknown')).statusCode,401);assert.equal((await request('GET','/stream/unknown/original')).statusCode,401);});
    await t.test('server setup requires the private bootstrap code',async()=>{const denied=await request('POST','/api/auth/setup',{username:'owner',password:'test password long enough',code:'wrong'});assert.equal(denied.statusCode,403);const setup=await request('POST','/api/auth/setup',{username:'owner',password:'test password long enough',code:await readFile(join(data,'bootstrap-code'),'utf8'),native:true});assert.equal(setup.statusCode,200,setup.body);token=setup.json().token;assert.ok(token);assert.match(String(setup.headers['set-cookie']),/HttpOnly/i);assert.equal((await request('POST','/api/auth/setup',{})).statusCode,409);});
    await t.test('cookies authenticate browser sessions, cross-origin writes are rejected',async()=>{const login=await request('POST','/api/auth/login',{username:'owner',password:'test password long enough'});assert.equal(login.json().token,undefined);const cookie=String(login.headers['set-cookie']).split(';')[0];assert.equal((await app.inject({url:'/api/auth/me',headers:{cookie}})).statusCode,200);assert.equal((await request('POST','/api/scan',{},token,{origin:'https://evil.example'})).statusCode,403);});
    await t.test('malformed origins are rejected before authentication',async()=>{
      assert.equal((await request('POST','/api/scan',{},token,{origin:'null'})).statusCode,403);
      assert.equal((await request('POST','/api/scan',{},token,{origin:'https://localhost:80',host:'localhost:80'})).statusCode,403);
    });
    await t.test('scan reads real ffprobe streams and local NFO metadata',async()=>{const response=await request('POST','/api/libraries',{name:'Movies',path:library,kind:'movies'});assert.equal(response.statusCode,200,response.body);while(scanner.status.running)await new Promise(r=>setTimeout(r,25));assert.deepEqual(scanner.status.errors,[]);const list=await request('GET','/api/media');assert.equal(list.json().total,1);media=list.json().items[0];id=media.id;assert.equal(media.title,'Example from NFO');assert.equal(media.streams.find((s:any)=>s.type==='audio').codec,'eac3');assert.equal(media.overview,'Local metadata works.');assert.equal(media.path,undefined);});
    await t.test('authenticated artwork variants serve the real sidecars instead of generated frames',async()=>{
      const header=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=','base64');
      const variants=[['poster','folder.jpg'],['backdrop','backdrop.jpg'],['still','Example.2024.1080p-thumb.jpg']] as const;
      try{
        for(const [kind,name] of variants){const bytes=Buffer.concat([header,Buffer.from(kind)]);await writeFile(join(library,name),bytes);const response=await request('GET',`/api/media/${id}/image?kind=${kind}`);assert.equal(response.statusCode,200,response.body);assert.match(String(response.headers['content-type']),/^image\/png/);assert.deepEqual(response.rawPayload,bytes);}
        assert.equal((await request('GET',`/api/media/${id}/image?kind=poster`,undefined,'')).statusCode,401);
        assert.equal((await request('GET',`/api/media/${id}/image?kind=not-an-image-kind`)).statusCode,400);
      }finally{for(const [,name] of variants)await rm(join(library,name),{force:true});}
      const fallback=await request('GET',`/api/media/${id}/image?kind=backdrop`);
      assert.equal(fallback.statusCode,200);
      assert.match(String(fallback.headers['cache-control']),/no-cache/);
    });
    await t.test('subtitles remain aligned after resuming a compatibility stream',async()=>{
      const index=media.streams.find((s:any)=>s.type==='subtitle').index;
      const original=await request('GET',`/api/media/${id}/subtitles/${index}`);
      assert.equal(original.statusCode,200,original.body);
      const resumed=await request('GET',`/api/media/${id}/subtitles/${index}?offset=3`);
      assert.equal(resumed.statusCode,200,resumed.body);
      const seconds=(value:string)=>value.split(':').reduce((sum,part)=>sum*60+Number(part),0);
      const cues=(vtt:string)=>[...vtt.matchAll(/([\d:.]+) --> ([\d:.]+)\n([^\n]+)/g)].map(m=>({start:seconds(m[1]),end:seconds(m[2]),text:m[3]}));
      const source=cues(original.body),shifted=cues(resumed.body);
      assert.deepEqual(shifted.map(c=>c.text),['Spans resume','After resume']);
      for(const cue of shifted){
        const before=source.find(c=>c.text===cue.text)!;
        assert.ok(Math.abs(cue.start-Math.max(0,before.start-3))<0.001);
        assert.ok(Math.abs(cue.end-(before.end-3))<0.001);
      }
      assert.equal((await request('GET',`/api/media/${id}/subtitles/${index}?offset=-1`)).statusCode,400);
    });
    await t.test('range playback, suffixes, HEAD, If-Range, and invalid ranges use real source bytes',async()=>{const bytes=await readFile(file);const response=await request('GET',`/stream/${id}/original`,undefined,token,{range:'bytes=16-79'});assert.equal(response.statusCode,206);assert.deepEqual(response.rawPayload,bytes.subarray(16,80));assert.equal(response.headers['content-range'],`bytes 16-79/${bytes.length}`);const suffix=await request('GET',`/stream/${id}/original`,undefined,token,{range:'bytes=-32'});assert.deepEqual(suffix.rawPayload,bytes.subarray(-32));const head=await request('HEAD',`/stream/${id}/original`);assert.equal(head.body,'');assert.equal(Number(head.headers['content-length']),bytes.length);const invalid=await request('GET',`/stream/${id}/original`,undefined,token,{range:'bytes=999999999999-'});assert.equal(invalid.statusCode,416);const stale=await request('GET',`/stream/${id}/original`,undefined,token,{range:'bytes=16-79','if-range':'"stale"'});assert.equal(stale.statusCode,200);assert.deepEqual(stale.rawPayload,bytes);});
    await t.test('sparse files seek beyond 4 GB without loading the file into memory',async()=>{const sparse=join(library,'large.mkv'),handle=await open(sparse,'w');const offset=5*1024**3;await handle.truncate(offset+4);await handle.write(Buffer.from('8K!!'),0,4,offset);await handle.close();db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,1)').run('large',media.libraryId,sparse,0,offset+4,JSON.stringify({...media,size:offset+4}),Date.now());const r=await request('GET','/stream/large/original',undefined,token,{range:`bytes=${offset}-${offset+3}`});assert.equal(r.statusCode,206);assert.equal(r.body,'8K!!');db.prepare('DELETE FROM media WHERE id=?').run('large');});
    await t.test('playback planning returns original media without a server conversion',async()=>{const caps={client:'android',device:'test',containers:['mkv'],video:[{codec:'h264',maxWidth:1920,maxHeight:1080,maxFrameRate:60,maxBitDepth:8}],audio:['eac3','aac'],passthrough:[],hdr:[]};const r=await request('POST',`/api/media/${id}/playback`,{capabilities:caps,startAt:2});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().plan.mode,'direct');assert.equal(r.json().resumeAt,2);assert.equal(r.json().offset,0);assert.equal(conversions.jobs.size,0);});
    await t.test('per-user progress and favorites persist and remain isolated',async()=>{assert.equal((await request('PUT',`/api/media/${id}/progress`,{position:2,favorite:true})).statusCode,200);const v=await request('POST','/api/users',{username:'viewer',password:'another test password'});assert.equal(v.statusCode,200,v.body);const login=await request('POST','/api/auth/login',{username:'viewer',password:'another test password',native:true});viewerToken=login.json().token;const owner=await request('GET','/api/media?view=favorites');assert.equal(owner.json().total,1);const viewer=await request('GET','/api/media?view=favorites',undefined,viewerToken);assert.equal(viewer.json().total,0);assert.equal((await request('POST','/api/scan',{},viewerToken)).statusCode,403);const libs=await request('GET','/api/libraries',undefined,viewerToken);assert.equal(libs.json()[0].path,undefined);});
    await t.test('series catalog groups before pagination and preserves ordered, private episode history',async()=>{
      const shows=join(root,'shows');await mkdir(shows);
      db.prepare('INSERT INTO libraries VALUES(?,?,?,?)').run('series-test','TV shows',shows,'shows');
      try {
        for(const [season,episode] of [[2,1],[1,10],[1,2],[1,1],[0,1]]){
          const episodeId=`series-${season}-${episode}`,path=join(shows,episodeId+'.mkv');await copyFile(file,path);
          db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,1)').run(episodeId,'series-test',path,0,media.size,JSON.stringify({...media,title:`Episode ${episode}`,sortTitle:`Episode ${episode}`,series:'Silicon Valley',season,episode}),Date.now());
        }
        db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,0)').run('missing-episode','series-test',join(shows,'missing.mkv'),0,0,JSON.stringify({...media,series:'Silicon Valley',season:3,episode:1}),Date.now());
        await request('PUT','/api/media/series-1-1/progress',{completed:true,position:6});
        await request('PUT','/api/media/series-1-2/progress',{position:2,favorite:true});
        const list=await request('GET','/api/catalog?view=shows&limit=1');assert.equal(list.statusCode,200,list.body);
        assert.equal(list.json().total,1);const summary=list.json().items[0].series;
        assert.equal(summary.episodeCount,5);assert.equal(summary.seasonCount,2);
        const detail=await request('GET','/api/series/'+summary.id);assert.equal(detail.statusCode,200,detail.body);
        assert.deepEqual(detail.json().seasons.map((s:any)=>s.title),['Season 1','Season 2','Specials']);
        assert.deepEqual(detail.json().seasons[0].episodes.map((e:any)=>e.episode),[1,2,10]);
        assert.equal(detail.json().firstEpisode.id,'series-1-1');assert.equal(detail.json().continueEpisode.id,'series-1-2');
        assert.equal(detail.json().continueEpisode.position,2);assert.equal(detail.json().continueEpisode.path,undefined);
        const viewer=await request('GET','/api/series/'+summary.id,undefined,viewerToken);
        assert.equal(viewer.json().completedEpisodes,0);assert.equal(viewer.json().continueEpisode.id,'series-1-1');assert.equal(viewer.json().continueEpisode.position,0);
        assert.equal((await request('GET','/api/media?view=shows')).json().total,5,'Legacy raw media endpoint remains compatible.');
        const search=await request('GET','/api/catalog?view=shows&q=Episode%2010');assert.equal(search.json().items[0].series.episodeCount,5);
        const favorites=await request('GET','/api/catalog?view=favorites');assert.equal(favorites.json().items.find((i:any)=>i.kind==='series').series.episodeCount,5);
        assert.equal((await request('GET','/api/catalog?view=shows&offset=1')).json().items.length,0);
        assert.equal((await request('GET','/api/series/unknown')).statusCode,404);
      } finally {db.prepare('DELETE FROM libraries WHERE id=?').run('series-test');}
    });
    await t.test('pairing requires signed-in approval and is single use',async()=>{const pairing=await request('POST','/api/pairing',{device:'Android TV'},'');const {code,pollToken}=pairing.json();assert.equal((await request('POST','/api/pairing/poll',{code,pollToken},'')).json().pending,true);assert.equal((await request('POST','/api/pairing/approve',{code},'')).statusCode,401);assert.equal((await request('POST','/api/pairing/approve',{code})).statusCode,200);const polled=await request('POST','/api/pairing/poll',{code,pollToken},'');assert.ok(polled.json().token);assert.equal((await request('POST','/api/pairing/poll',{code,pollToken},'')).statusCode,410);});
    await t.test('audio fallback makes playable AAC HLS while copying the video',async()=>{const caps={client:'browser',device:'test',containers:['mp4'],video:[{codec:'h264',maxWidth:1920,maxHeight:1080,maxFrameRate:60,maxBitDepth:8}],audio:['aac'],passthrough:[],hdr:[]};const denied=await request('POST',`/api/media/${id}/playback`,{capabilities:caps});assert.equal(denied.json().plan.mode,'unsupported');const response=await request('POST',`/api/media/${id}/playback`,{capabilities:caps,allowCompatibility:true});assert.equal(response.statusCode,200,response.body);const playback=response.json();assert.equal(playback.plan.mode,'audio');assert.equal(playback.plan.videoPreserved,true);const manifest=await request('GET',playback.url);assert.match(manifest.body,/#EXTM3U/);assert.equal((await request('GET',playback.url,undefined,viewerToken)).statusCode,404);const job=conversions.jobs.get(playback.sessionId)!;while(!job.done)await new Promise(r=>setTimeout(r,20));assert.equal(job.error,undefined,job.stderr);const init=await readFile(join(job.dir,'init.mp4')),segment=await readFile(join(job.dir,'segment-000000.m4s'));const output=join(root,'result.mp4');await writeFile(output,Buffer.concat([init,segment]));const {stdout}=await execute('ffprobe',['-v','error','-show_streams','-of','json',output]);const streams=JSON.parse(stdout).streams;assert.equal(streams.find((s:any)=>s.codec_type==='video').codec_name,'h264');assert.equal(streams.find((s:any)=>s.codec_type==='audio').codec_name,'aac');assert.equal(streams.find((s:any)=>s.codec_type==='audio').channels,2);
      const hashes=async(path:string)=>{const {stdout}=await execute('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-c','copy','-f','streamhash','-hash','sha256','-']);return stdout.trim();};assert.equal(await hashes(output),await hashes(file),'Compressed video packets must be identical.');assert.equal((await request('DELETE','/api/playback/'+playback.sessionId)).statusCode,200);assert.equal(conversions.jobs.size,0);});
    await t.test('library file symlinks cannot escape the allowed root',async()=>{const outside=join(root,'secret.mkv');await writeFile(outside,'secret');const linked=join(library,'escape.mkv');await symlink(outside,linked);db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,1)').run('escape',media.libraryId,linked,0,6,JSON.stringify(media),Date.now());assert.equal((await request('GET','/stream/escape/original')).statusCode,403);});
    await t.test('browser audio selection outputs the selected original AAC track',async()=>{const caps={client:'browser',device:'test',containers:['mkv'],video:[{codec:'h264',maxWidth:1920,maxHeight:1080,maxFrameRate:60,maxBitDepth:8}],audio:['aac','eac3'],passthrough:[],hdr:[]};const response=await request('POST',`/api/media/${id}/playback`,{capabilities:caps,audioIndex:2,allowCompatibility:true});assert.equal(response.statusCode,200,response.body);const playback=response.json();assert.equal(playback.plan.mode,'remux');assert.equal(playback.plan.audioPreserved,true);const job=conversions.jobs.get(playback.sessionId)!;while(!job.done)await new Promise(r=>setTimeout(r,20));const output=join(root,'selected-audio.mp4');await writeFile(output,Buffer.concat([await readFile(join(job.dir,'init.mp4')),await readFile(join(job.dir,'segment-000000.m4s'))]));const hash=async(path:string,map:string)=>{const {stdout}=await execute('ffmpeg',['-v','error','-i',path,'-map',map,'-c','copy','-f','streamhash','-hash','sha256','-']);return stdout.trim();};assert.equal(await hash(output,'0:a:0'),await hash(file,'0:a:1'));await request('DELETE','/api/playback/'+playback.sessionId);});
    await t.test('logging out revokes the bearer session',async()=>{assert.equal((await request('POST','/api/auth/logout',{},viewerToken)).statusCode,200);assert.equal((await request('GET','/api/auth/me',undefined,viewerToken)).statusCode,401);});
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
