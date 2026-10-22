import { mkdir, access, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { localArtwork, type ImageKind } from './localMetadata.js';
import { readLimited, type MetadataRecord } from './metadata.js';

const imageHosts=new Set(['static.tvmaze.com','images.metahub.space','image.tmdb.org','m.media-amazon.com','artworks.thetvdb.com','images.fanart.tv']);
export function trustedImageUrl(value:string) {
  try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&imageHosts.has(u.hostname);}catch{return false;}
}
export function imageType(bytes:Uint8Array) {
  const b=Buffer.from(bytes);
  if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return 'image/webp';
  return undefined;
}
export async function fileImageType(path:string) {
  const file=await open(path,'r');try{const bytes=Buffer.alloc(16);const {bytesRead}=await file.read(bytes,0,16,0);return imageType(bytes.subarray(0,bytesRead));}finally{await file.close();}
}
export class ArtworkStore {
  private work=new Map<string,Promise<string|undefined>>();
  constructor(private directory:string,private fetcher:typeof fetch=fetch){}
  async resolve(file:string,root:string,metadata:MetadataRecord,kind:ImageKind) {
    const local=await localArtwork(file,root,kind,metadata.season);if(local)return local;
    const url=kind==='season'?metadata.remoteArtwork?.seasonPoster||metadata.remoteArtwork?.poster:metadata.remoteArtwork?.[kind];
    if(!url||!trustedImageUrl(url))return;
    if(!this.work.has(url))this.work.set(url,this.download(url).catch(()=>undefined).finally(()=>this.work.delete(url)));
    return this.work.get(url);
  }
  private async download(url:string) {
    await mkdir(this.directory,{recursive:true});
    const path=join(this.directory,createHash('sha256').update(url).digest('hex')+'.img');
    try{await access(path);if(await fileImageType(path))return path;await unlink(path);}catch{/*Download only on the first artwork request.*/}
    let current=url;
    for(let count=0;count<4;count++){
      if(!trustedImageUrl(current))throw new Error('Untrusted artwork host.');
      const response=await this.fetcher(current,{redirect:'manual',headers:{'User-Agent':'Kathrine/0.3 artwork cache'},signal:AbortSignal.timeout(20_000)});
      if([301,302,303,307,308].includes(response.status)){
        const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new Error('Invalid artwork redirect.');current=new URL(next,current).href;continue;
      }
      if(!response.ok){await response.body?.cancel();throw new Error('Artwork download failed.');}
      const bytes=await readLimited(response,12*1024*1024);if(!imageType(bytes))throw new Error('Unsupported artwork format.');
      const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes,{mode:0o600});await rename(temp,path);return path;
    }
    throw new Error('Too many artwork redirects.');
  }
}
