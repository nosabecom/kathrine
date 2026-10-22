import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

// Keep credentials private, and remove only the account named in the private bench file.
const remoteScript=String.raw`
import { DatabaseSync } from 'node:sqlite';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
const data=join(homedir(),'kathrine-data');
const credentialPath=join(data,'verification-session.json');
const credentials=JSON.parse(await readFile(credentialPath,'utf8'));
if(!credentials.user?.id||!/^verification-[0-9a-f]{8}$/.test(credentials.user?.username||''))throw new Error('Refusing cleanup: this is not a temporary verification account.');
const db=new DatabaseSync(join(data,'kathrine.sqlite'));
try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const user=db.prepare('SELECT username FROM users WHERE id=?').get(credentials.user.id);
  if(user&&user.username!==credentials.user.username)throw new Error('Refusing cleanup: account identity changed.');
  db.prepare('DELETE FROM users WHERE id=? AND username=?').run(credentials.user.id,credentials.user.username);
  await unlink(credentialPath);
  console.log('Temporary verification account, its sessions/history, and remote credentials removed.');
}finally{db.close();}
`;
const child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','ewaste','/home/nosa/.local/bin/node --input-type=module'],{stdio:['pipe','inherit','inherit']});
child.stdin.on('error',()=>{});
child.stdin.end(remoteScript);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',value=>resolve(value??1));});
if(code!==0){console.error('Verification cleanup did not finish. Local credentials retained for retry when Ewaste is reachable.');process.exitCode=Number(code);}
else{await rm('.artifacts/verification-session.json',{force:true});console.log('Local verification credentials removed.');}
