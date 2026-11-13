import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, type MediaRow } from '../server/db.js';
import { SubtitleLibrary } from '../server/subtitleLibrary.js';
import { normalizeSubtitles, shiftWebVtt } from '../server/subtitles.js';
import { SubdlProvider, SubtitleProviderError, rankRelease, selectCandidates, subtitleDownloadUrl, boundedText } from '../server/subtitleProvider.js';
import type { Media } from '../shared/types.js';

const fileName='Example.S02E05.1080p.MAX.WEB-DL.x265-GROUP.mkv';
const media:Media={id:'episode',libraryId:'library',title:'Episode Five',sortTitle:'Episode Five',series:'Example',season:2,episode:5,duration:6,size:10,bitrate:100,container:'mkv',streams:[{index:0,type:'video',codec:'hevc',frameRate:23.976},{index:1,type:'subtitle',codec:'subrip',language:'eng'}],addedAt:0,available:true,position:0,completed:false,favorite:false};
const srt='1\n00:00:00,000 --> 00:00:01,000\nOpening caption\n\n2\n00:00:02,000 --> 00:00:04,000\nMiddle caption\n\n3\n00:00:05,000 --> 00:00:06,000\nClosing caption\n';
const payload=()=>({status:true,results:[{name:'Example',type:'tv',year:2020}],subtitles:[{release_name:fileName,season:2,episode:5,language:'EN',fps:'23.976',url:'/subtitle/test/file',subtitlePage:'/s/info/test/example'}]});

test('subtitle matching rejects wrong titles, episodes, frame rates, releases and unsafe URLs',()=>{
  assert.equal(rankRelease(fileName,fileName),100);
  assert.equal(rankRelease(fileName,'Example.S02E05.2160p.MAX.WEB-DL.x265-GROUP'),90);
  assert.equal(rankRelease(fileName,'Example.S02E05.1080p.BluRay.x265-GROUP'),0);
  assert.equal(rankRelease(fileName,'Example.S02E05.1080p.AMZN.WEB-DL.x265-GROUP'),0);
  assert.equal(rankRelease(fileName,'Different.Show.S02E05.1080p.MAX.WEB-DL.x265-GROUP'),0);
  assert.equal(rankRelease(fileName,'Example.S02E07.1080p.MAX.WEB-DL.x265-GROUP'),0);
  assert.equal(rankRelease('Margin.Call.2011.1080p.BluRay-GROUP','Inception.2010.1080p.BluRay-GROUP'),0);
  assert.equal(rankRelease('Margin.Call.2011.1080p.BluRay-GROUP','Margin.Call.2024.1080p.BluRay-GROUP'),0);
  assert.equal(selectCandidates(payload(),media,fileName).length,1);
  for(const change of [
    (p:any)=>p.results[0].name='Different Series',
    (p:any)=>p.subtitles[0].episode=7,
    (p:any)=>p.subtitles[0].release_name='Example.S02E07.1080p.MAX.WEB-DL.x265-GROUP',
    (p:any)=>p.subtitles[0].release_name='Different.Show.S02E05.1080p.MAX.WEB-DL.x265-GROUP',
    (p:any)=>p.subtitles[0].fps='25',
    (p:any)=>p.subtitles[0].fps='24',
    (p:any)=>p.subtitles[0].url='https://evil.example/subtitle/test',
    (p:any)=>p.subtitles[0].language='FA',
  ]){const p=payload();change(p);assert.deepEqual(selectCandidates(p,media,fileName),[]);}
  for(const url of ['http://dl.subdl.com/subtitle/test','https://dl.subdl.com.evil.example/subtitle/test','https://user@dl.subdl.com/subtitle/test','https://dl.subdl.com:444/subtitle/test','/subtitle/test?api_key=leak','/subtitle/../secret','https://127.0.0.1/subtitle/test'])assert.throws(()=>subtitleDownloadUrl(url));
});
test('season packs require the exact individual episode while using the pack release match',()=>{
  const p:any=payload();p.subtitles=[{release_name:'Example.S02.2160p.MAX.WEB-DL.x265-GROUP',full_season:true,language:'EN',season:2,unpack_files:[{name:'Example.S02E05.srt',season:2,episode:5,language:'EN',url:'/subtitle/pack/episode5'},{name:'Example.S02E07.srt',season:2,episode:7,language:'EN',url:'/subtitle/pack/episode7'}]}];
  assert.deepEqual(selectCandidates(p,media,fileName).map(x=>x.url),['https://dl.subdl.com/subtitle/pack/episode5']);
  const single:any=payload();single.subtitles[0].url='/subtitle/upload.zip';single.subtitles[0].unpack_files=[{name:fileName.replace('.mkv','.srt'),season:2,episode:5,language:'EN',url:'/subtitle/upload/raw'}];
  assert.deepEqual(selectCandidates(single,media,fileName).map(x=>x.url),['https://dl.subdl.com/subtitle/upload/raw']);
});
test('text normalization rejects empty, malformed, HTML and incompatible timelines',()=>{
  const vtt=normalizeSubtitles('\uFEFF'+srt.replaceAll('\n','\r\n'),6);assert.match(vtt,/^WEBVTT/);assert.match(vtt,/00:00:02.000 --> 00:00:04.000/);
  assert.match(shiftWebVtt(vtt,3),/00:00:00.000 --> 00:00:01.000\nMiddle caption/);
  for(const value of ['','<html>Download failed</html>','PK\x03\x04zip','1\n00:00:05,000 --> 00:00:02,000\nBad',srt.replace('00:00:06,000','01:00:00,000')])assert.throws(()=>normalizeSubtitles(value,6));
  assert.throws(()=>normalizeSubtitles(srt,3600),/partial/);
  assert.throws(()=>normalizeSubtitles('x'.repeat(2*1024*1024+1)),/valid/);
  assert.doesNotMatch(normalizeSubtitles(srt.replace('Opening caption','<font color="red"><b>Opening</b></font> caption')),/<font/);
});
test('provider bounds responses, preserves secret headers, refuses redirects and reports quota without credentials',async()=>{
  await assert.rejects(()=>boundedText(new Response('x'.repeat(40)),20),SubtitleProviderError);
  let calls=0;
  const provider=new SubdlProvider('private-test-key',async(input,options)=>{
    calls++;assert.equal(options?.redirect,'error');
    if(calls===1){assert.equal((options?.headers as any).Authorization,'Bearer private-test-key');assert.doesNotMatch(String(input),/private-test-key/);return new Response(JSON.stringify(payload()));}
    assert.equal((options?.headers as any).Authorization,undefined);return new Response(srt);
  });
  const [candidate]=await provider.search(media,fileName);assert.equal(await provider.download(candidate),srt);
  const limited=new SubdlProvider('private-test-key',async()=>new Response('private-test-key',{status:429,headers:{'retry-after':'120'}}));
  await assert.rejects(()=>limited.search(media,fileName),(e:any)=>e.kind==='quota'&&e.retryAfter===120&&!e.message.includes('private-test-key'));
});

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'kathrine-subtitles-')),library=join(root,'library');await mkdir(library);
  const path=join(library,fileName);await writeFile(path,'original video bytes');const info=await stat(path),db=openDatabase(join(root,'data'));
  db.prepare('INSERT INTO libraries VALUES(?,?,?,?)').run('library','TV',library,'shows');
  db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,1)').run(media.id,'library',path,info.mtimeMs,info.size,JSON.stringify({...media,size:info.size}),0);
  const row=()=>db.prepare('SELECT * FROM media WHERE id=?').get(media.id) as MediaRow;
  return {root,library,path,db,row,cleanup:async()=>{db.close();await rm(root,{recursive:true,force:true});}};
}
test('sidecar and downloaded subtitles remain authenticated file references, versioned independently of original media',async()=>{
  const f=await fixture();let calls=0;
  const provider=new SubdlProvider('key',async input=>{calls++;return new Response(String(input).includes('/search?')?JSON.stringify(payload()):srt);});
  const manager=new SubtitleLibrary(f.db,'key',true,provider);
  try {
    const before=await readFile(f.path);await writeFile(f.path.replace('.mkv','.en.srt'),srt);
    const outside=join(f.root,'secret.srt');await writeFile(outside,srt);await symlink(outside,f.path.replace('.mkv','.eng.srt'));
    const inventory=await manager.inventory(f.row());const local=inventory.tracks.filter(t=>t.source==='sidecar');assert.equal(local.length,1);
    assert.equal(JSON.stringify(inventory).includes(f.library),false);assert.match(await manager.content(f.row(),local[0].id),/^WEBVTT/);
    await assert.rejects(()=>manager.content(f.row(),'../../secret'));
    assert.equal(await manager.source(f.row()),'downloaded');assert.equal(await manager.source(f.row()),'cached');assert.equal(calls,2);
    assert.equal((await manager.inventory(f.row())).tracks[0].source,'subdl');assert.match(await manager.content(f.row(),'subdl'),/Closing caption/);assert.deepEqual(await readFile(f.path),before);
    await writeFile(f.path,'changed video bytes, different size');
    await assert.rejects(()=>manager.content(f.row(),'subdl'),/changed/);
    assert.equal(await manager.source(f.row(),true),'changed');
    assert.equal((await manager.audit()).accuracyVerified,false);
    f.db.prepare('DELETE FROM media WHERE id=?').run(media.id);assert.equal((f.db.prepare('SELECT count(*) n FROM subtitle_downloads').get() as any).n,0);
  } finally {await manager.close();await f.cleanup();}
});
test('automatic sourcing skips recent playback, retries at most daily and stops at provider quota',async()=>{
  const f=await fixture();let calls=0;
  const manager=new SubtitleLibrary(f.db,'key',true,new SubdlProvider('key',async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'120'}});}));
  try {
    manager.touchPlayback(media.id);assert.equal(manager.start(),true);while(manager.status.running)await new Promise(r=>setTimeout(r,5));assert.equal(calls,0);
    assert.equal(manager.start(media.id),true);while(manager.status.running)await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);assert.equal(manager.status.errors,1);assert.ok(manager.status.cooldownUntil>Date.now());
    assert.equal(await manager.source(f.row()),'quota');assert.equal(calls,1);
  } finally {await manager.close();await f.cleanup();}
});
