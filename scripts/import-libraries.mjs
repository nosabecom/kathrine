import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/server/app.js';
const {app,db}=await createApp();
try {
  const inputs=process.argv.slice(2);
  for(let index=0;index<inputs.length;index++) {
    let input=inputs[index],explicitKind;
    if(input==='--shows'||input==='--movies'){explicitKind=input.slice(2);input=inputs[++index];if(!input)throw new Error('A library folder must follow the library kind.');}
    const path=await realpath(input);
    if(!(await stat(path)).isDirectory())throw new Error('Not a folder: '+path);
    const kind=explicitKind||(/tv|show/i.test(basename(path))?'shows':'movies');
    const name=kind==='shows'?(basename(path)==='downloads'?'TV downloads':'TV shows'):'Movies';
    db.prepare('INSERT INTO libraries VALUES(?,?,?,?) ON CONFLICT(path) DO NOTHING').run(randomUUID(),name,path,kind);
    console.log('Library registered: '+path);
  }
} finally { await app.close(); }
