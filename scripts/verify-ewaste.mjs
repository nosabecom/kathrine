// Run from the deployed release on Ewaste. Credentials remain in a mode-0600 file.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { passwordHash } from '../dist/server/auth.js';
const data=process.env.KATHRINE_DATA||join(process.env.HOME,'kathrine-data');
const credentialPath=join(data,'verification-session.json');
const db=new DatabaseSync(join(data,'kathrine.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
if(process.argv.includes('--cleanup')){
  const credentials=JSON.parse(await readFile(credentialPath,'utf8'));db.prepare('DELETE FROM users WHERE id=?').run(credentials.user.id);await unlink(credentialPath);db.close();console.log('Temporary verification account and sessions removed.');process.exit(0);
}
const user={id:randomUUID(),username:'verification-'+randomBytes(4).toString('hex'),admin:true},password=randomBytes(32).toString('base64url');
const token=randomBytes(32).toString('base64url');
db.prepare('INSERT INTO users VALUES(?,?,?,1)').run(user.id,user.username,await passwordHash(password));
db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.id,Date.now()+3600_000);
await writeFile(credentialPath,JSON.stringify({user,password,token}),{mode:0o600,flag:'wx'});
const base='http://127.0.0.1:8765',headers={Authorization:'Bearer '+token};
const json=async(path,body)=>{const r=await fetch(base+path,{headers:{...headers,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw new Error(JSON.stringify(v));return v;};
const items=(await json('/api/media?limit=1000')).items;
if(!items.length)throw new Error('The scan has not indexed media yet. Retry after checking the server scan.');
const chosen=items.find(m=>m.streams.some(s=>s.type==='video'&&s.height>=2160))||items[0];
const video=chosen.streams.find(s=>s.type==='video'),audio=chosen.streams.find(s=>s.type==='audio'&&s.default)||chosen.streams.find(s=>s.type==='audio');
const capabilities={client:'android',device:'Server protocol verification, not physical device certification',containers:[chosen.container],video:[{codec:video.codec,maxWidth:video.width,maxHeight:video.height,maxBitDepth:video.bitDepth,maxFrameRate:video.frameRate+1}],audio:audio?[audio.codec]:[],passthrough:[],hdr:video.hdr?[video.hdr]:[]};
const plan=await json('/api/media/'+chosen.id+'/playback',{capabilities});if(plan.plan.mode!=='direct')throw new Error('Expected original playback.');
const source=db.prepare('SELECT path FROM media WHERE id=?').get(chosen.id).path;
const count=32*1024*1024,offset=Math.min(5*1024**3,Math.max(0,chosen.size-count));
const started=performance.now();const response=await fetch(base+plan.url,{headers:{...headers,Range:`bytes=${offset}-${offset+count-1}`}});const bytes=Buffer.from(await response.arrayBuffer());const elapsed=(performance.now()-started)/1000;
if(response.status!==206)throw new Error('Range request failed.');
const file=await open(source,'r'),actual=Buffer.alloc(bytes.length);await file.read(actual,0,bytes.length,offset);await file.close();
const hash=b=>createHash('sha256').update(b).digest('hex');if(hash(actual)!==hash(bytes))throw new Error('Original range differs from the media file.');
const result={indexedTitles:items.length,source:{title:chosen.title,width:video.width,height:video.height,codec:video.codec,bitDepth:video.bitDepth,hdr:video.hdr,audio:audio?.codec,bitrateMb:Number((chosen.bitrate/1e6).toFixed(1))},original:{mode:plan.plan.mode,offset,bytes:bytes.length,packetBytesIdentical:true,localServerThroughputMb:Number((bytes.length*8/elapsed/1e6).toFixed(1))},status:await json('/api/status')};
// Exercise the audio-only HLS path against a real 4K title, then stop the job.
if(audio&&audio.codec!=='aac'){
  const started=performance.now();const converted=await json('/api/media/'+chosen.id+'/playback',{capabilities:{...capabilities,audio:['aac']},allowCompatibility:true});
  if(converted.sessionId){const manifest=await fetch(base+converted.url,{headers});if(!manifest.ok||!(await manifest.text()).includes('#EXTINF'))throw new Error('Real media HLS preparation failed.');result.audioFallback={mode:converted.plan.mode,videoPreserved:converted.plan.videoPreserved,audioPreserved:converted.plan.audioPreserved,firstSegmentSeconds:Number(((performance.now()-started)/1000).toFixed(2))};await fetch(base+'/api/playback/'+converted.sessionId,{method:'DELETE',headers});}
}
await writeFile(join(data,'verification-report.json'),JSON.stringify(result,null,2));db.close();console.log(JSON.stringify(result,null,2));
