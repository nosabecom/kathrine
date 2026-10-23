import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MetadataEnricher, type MetadataRecord } from '../server/metadata.js';
import { localArtwork, plainText } from '../server/localMetadata.js';
import { ArtworkStore, trustedImageUrl, fileImageType } from '../server/artwork.js';
import { openDatabase, publicMedia } from '../server/db.js';
import { Scanner, probe } from '../server/library.js';

const base:MetadataRecord={title:'industry s01e01 dv hdr',sortTitle:'industry s01e01 dv hdr',series:'industry',season:1,episode:1,duration:1800,size:10,bitrate:100,container:'mkv',streams:[]};
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1cAAAAASUVORK5CYII=','base64');
async function fixture(run:(root:string,file:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'kathrine-metadata-'));try{const file=join(root,'Industry.S01E01.mkv');await writeFile(file,'source');await run(root,file);}finally{await rm(root,{recursive:true,force:true});}}

test('local episode/ancestor show metadata and dedicated artwork take priority over internet lookups',async()=>fixture(async(root)=>{
  const season=join(root,'Season 1');await mkdir(season);const file=join(season,'Example.S01E01.mkv');await writeFile(file,'source');
  await writeFile(join(season,'Example.S01E01.nfo'),'<episodedetails><title>Local episode</title><plot>Local episode plot.</plot></episodedetails>');
  await writeFile(join(root,'tvshow.nfo'),'<tvshow><title>Local show</title><plot>Series &amp; description.</plot><year>2020</year><genre>Drama</genre></tvshow>');
  for(const name of ['folder.jpg','backdrop.jpg','season01-poster.jpg'])await writeFile(join(root,name),png);
  await writeFile(join(season,'Example.S01E01-thumb.jpg'),png);
  const enrich=new MetadataEnricher(join(root,'cache'),async()=>{throw new Error('Complete local metadata must not make network requests.');});
  const result=await enrich.enrich(base,file,root);
  assert.equal(result.title,'Local episode');assert.equal(result.series,'Local show');assert.equal(result.overview,'Local episode plot.');assert.equal(result.seriesOverview,'Series & description.');assert.deepEqual(result.genres,['Drama']);
  assert.equal(await localArtwork(file,root,'poster',1),join(root,'folder.jpg'));
  assert.equal(await localArtwork(file,root,'season',1),join(root,'season01-poster.jpg'));
  assert.equal(await localArtwork(file,root,'still',1),join(season,'Example.S01E01-thumb.jpg'));
  assert.equal(await localArtwork(file,root,'backdrop',1),join(root,'backdrop.jpg'));
}));
test('missing TV metadata populates canonical show/episode names, summaries and original artwork with one cached show lookup',async()=>fixture(async(root,file)=>{
  const calls:string[]=[];
  const fetcher:typeof fetch=async input=>{const url=String(input);calls.push(url);
    if(url.includes('/search/shows'))return json([{show:{id:45501,name:'Industry',premiered:'2020-11-09',summary:'<p>A show about <b>finance</b>.</p>',genres:['Drama'],image:{original:'https://static.tvmaze.com/poster.jpg'}}}]);
    if(url.endsWith('/seasons'))return json([{number:1,image:{original:'https://static.tvmaze.com/season1.jpg'}}]);
    if(url.includes('/episodes'))return json([{season:1,number:1,name:'Induction',summary:'<p>The first episode.</p>',image:{original:'https://static.tvmaze.com/episode.jpg'}},{season:1,number:2,name:'Quiet and Nice',summary:'The second episode.'}]);
    return json([{type:'background',resolutions:{original:{url:'https://static.tvmaze.com/backdrop.jpg',width:1920,height:1080}}}]);};
  const enrich=new MetadataEnricher(join(root,'cache'),fetcher);
  const first=await enrich.enrich(base,file,root),second=await enrich.enrich({...base,episode:2},file,root);
  assert.equal(first.title,'Induction');assert.equal(first.series,'Industry');assert.equal(first.seriesOverview,'A show about finance.');assert.equal(first.overview,'The first episode.');assert.equal(second.title,'Quiet and Nice');assert.equal(calls.length,4);
  assert.equal(first.remoteArtwork?.seasonPoster,'https://static.tvmaze.com/season1.jpg');assert.equal(first.remoteArtwork?.backdrop,'https://static.tvmaze.com/backdrop.jpg');assert.equal(first.remoteArtwork?.still,'https://static.tvmaze.com/episode.jpg');assert.equal(first.metadataSources?.[0].name,'TVmaze');
  enrich.beginScan();await enrich.enrich(base,file,root);assert.equal(calls.length,4,'A fresh scan reuses the persistent metadata cache.');
}));
test('ambiguous or fuzzy-only names never silently attach the wrong show',async()=>fixture(async(root,file)=>{
  for(const results of [[{show:{id:1,name:'Industry Awards'}}],[{show:{id:1,name:'Industry'}},{show:{id:2,name:'Industry'}}]]){
    const enrich=new MetadataEnricher(join(root,String(results.length)),async()=>json(results));
    const result=await enrich.enrich(base,file,root);assert.equal(result.series,'industry');assert.equal(result.title,'Episode 1');assert.deepEqual(result.metadataSources,[]);assert.deepEqual(result.remoteArtwork,{});
  }
}));
test('network failure preserves enriched titles and descriptions and backs off across service restarts',async()=>fixture(async(root,file)=>{
  let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw new Error('Offline');};
  const directory=join(root,'cache'),input={...base,title:'Induction',enrichmentVersion:1,overview:'Existing correct plot.'};
  const first=await new MetadataEnricher(directory,fetcher).enrich(input,file,root);
  const second=await new MetadataEnricher(directory,fetcher).enrich(input,file,root);
  assert.equal(first.title,'Induction');assert.equal(second.title,first.title);assert.equal(first.overview,'Existing correct plot.');assert.equal(second.overview,first.overview);assert.equal(calls,1);assert.ok(first.metadataRefreshAfter!>Date.now());
}));
test('automatic movie lookup uses exact title/year and returns artwork plus description',async()=>fixture(async(root,file)=>{
  const requests:string[]=[];const fetcher:typeof fetch=async input=>{const url=String(input);requests.push(url);return url.includes('/catalog/')?json({metas:[{id:'tt1615147',name:'Margin Call',releaseInfo:'2011'},{id:'tt123',name:'Margin Call',releaseInfo:'2020'}]}):json({meta:{name:'Margin Call',description:'A financial drama.',year:'2011',genres:['Drama'],poster:'https://images.metahub.space/poster/small/tt1615147/img',background:'https://images.metahub.space/background/medium/tt1615147/img'}});};
  const result=await new MetadataEnricher(join(root,'cache'),fetcher).enrich({...base,title:'Margin Call',series:undefined,season:undefined,episode:undefined,year:2011},file,root);
  assert.equal(result.title,'Margin Call');assert.equal(result.overview,'A financial drama.');assert.equal(result.year,2011);assert.equal(result.metadataSources?.[0].name,'Cinemeta');assert.match(requests[1],/tt1615147/);
}));
test('artwork caches image bytes, validates formats, and never forwards private authentication',async()=>fixture(async(root,file)=>{
  let calls=0;const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal(new Headers(init?.headers).has('authorization'),false);return new Response(png,{headers:{'Content-Type':'image/png'}});};
  const store=new ArtworkStore(join(root,'cache'),fetcher),metadata={...base,remoteArtwork:{poster:'https://static.tvmaze.com/poster.jpg'}};
  const first=await store.resolve(file,root,metadata,'poster'),second=await store.resolve(file,root,metadata,'poster');
  assert.equal(first,second);assert.ok(first);assert.equal(await fileImageType(first!),'image/png');assert.equal(calls,1);
}));
test('artwork rejects private hosts, credential URLs, untrusted redirects and library-escaping sidecars',async()=>fixture(async(root,file)=>{
  for(const url of ['http://static.tvmaze.com/x','https://127.0.0.1/x','https://static.tvmaze.com.evil.test/x','https://secret@static.tvmaze.com/x','https://static.tvmaze.com:8080/x'])assert.equal(trustedImageUrl(url),false);
  let calls=0;const store=new ArtworkStore(join(root,'cache'),async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});});
  assert.equal(await store.resolve(file,root,{...base,remoteArtwork:{poster:'https://static.tvmaze.com/x'}},'poster'),undefined);assert.equal(calls,1);
  const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'secret.jpg'),png);const library=join(root,'library');await mkdir(library);const movie=join(library,'movie.mkv');await writeFile(movie,'source');await symlink(join(outside,'secret.jpg'),join(library,'folder.jpg'));assert.equal(await localArtwork(movie,library,'poster'),undefined);
}));
test('HTML metadata is plain text and internal download/cache fields never enter public media',()=>{
  assert.equal(plainText('<p>A &amp; B<br>Next &#x1F3AC;</p><script>bad()</script>'),'A & B\nNext 🎬');
  const result=publicMedia({id:'x',library_id:'tv',path:'/private/file',mtime:0,size:1,added_at:0,available:1,metadata:JSON.stringify({...base,metadataVersion:3,enrichmentVersion:1,enrichedAt:123,metadataRefreshAfter:456,remoteArtwork:{poster:'https://static.tvmaze.com/x'}})});
  for(const field of ['path','metadataVersion','enrichmentVersion','enrichedAt','metadataRefreshAfter','remoteArtwork'])assert.equal((result as any)[field],undefined);
});
test('existing files enrich without re-probing or changing media identity and watch progress',async()=>fixture(async(root,file)=>{
  const db=openDatabase(join(root,'data')),info=await stat(file);
  try{
    db.prepare('INSERT INTO libraries VALUES(?,?,?,?)').run('tv','Shows',root,'shows');
    db.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?,1)').run('stable-id','tv',file,info.mtimeMs,info.size,JSON.stringify({...base,metadataVersion:2}),1);
    db.prepare('INSERT INTO users VALUES(?,?,?,0)').run('viewer','fixture-viewer','fixture-password-hash');
    db.prepare('INSERT INTO progress VALUES(?,?,?,?,?,?)').run('viewer','stable-id',900,0,1,1);
    const scanner=new Scanner(db,'/deliberately/missing/ffprobe',new MetadataEnricher(join(root,'cache')),false);scanner.start();while(scanner.status.running)await new Promise(r=>setTimeout(r,10));await scanner.close();
    assert.deepEqual(scanner.status.errors,[]);const row=db.prepare('SELECT * FROM media WHERE id=?').get('stable-id') as any;assert.equal(JSON.parse(row.metadata).metadataVersion,3);assert.equal((db.prepare('SELECT position FROM progress WHERE media_id=?').get('stable-id') as any).position,900);
  }finally{db.close();}
}));

test('initial metadata probing rejects NFO symlinks outside the library and oversized sidecars',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kathrine-probe-'));
  try {
    const library=join(root,'library');await mkdir(library);
    const file=join(library,'Example.2024.mkv'),nfo=join(library,'Example.2024.nfo');
    const fakeProbe=join(root,'ffprobe');
    await writeFile(fakeProbe,'#!/bin/sh\nprintf \'%s\' \'{"streams":[{"codec_type":"video","codec_name":"h264"}],"format":{}}\'\n',{mode:0o700});
    const outside=join(root,'private.nfo');await writeFile(outside,'<movie><title>Private outside title</title></movie>');
    await symlink(outside,nfo);
    assert.equal((await probe(file,fakeProbe,library)).title,'Example');
    await rm(nfo);await writeFile(nfo,'<movie><title>Too large</title>'+ ' '.repeat(2*1024*1024) +'</movie>');
    assert.equal((await probe(file,fakeProbe,library)).title,'Example');
    await writeFile(nfo,'<movie><title>Allowed title</title></movie>');
    assert.equal((await probe(file,fakeProbe,library)).title,'Allowed title');
  } finally { await rm(root,{recursive:true,force:true}); }
});
