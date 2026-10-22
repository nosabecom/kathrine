import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { checkedPath } from './paths.js';

const xml=new XMLParser({ignoreAttributes:false,processEntities:false});
export type ImageKind='poster'|'backdrop'|'still'|'season';
export function plainText(value:unknown):string|undefined {
  if(typeof value!=='string'&&typeof value!=='number')return;
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(value).replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,'').replace(/<\s*br\s*\/?>|<\/p\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_all,key:string)=>{
    if(key[0]!=='#')return entities[key.toLowerCase()]||' ';
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
    return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
  }).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim().slice(0,20_000)||undefined;
}
export function ancestorDirectories(file:string,root:string) {
  const result:string[]=[];let dir=dirname(file);
  for(let i=0;i<12;i++){
    const rel=relative(root,dir);if(rel==='..'||rel.startsWith('..'+sep))break;
    result.push(dir);if(dir===root)break;
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
  return result;
}
async function readNfo(path:string,root:string) {
  try{const checked=await checkedPath(path,root);if((await stat(checked)).size>2*1024*1024)return {};const data=xml.parse(await readFile(checked,'utf8'));return data.episodedetails||data.movie||data.tvshow||data.season||{};}catch{return {};}
}
const array=(value:unknown)=>Array.isArray(value)?value:value===undefined?[]:[value];
function ids(nfo:any) {
  const unique=array(nfo.uniqueid);
  const imdb=plainText(nfo.imdbid)||plainText(unique.find((v:any)=>v?.['@_type']==='imdb')?.['#text']);
  const tvdb=plainText(nfo.tvdbid)||plainText(unique.find((v:any)=>v?.['@_type']==='tvdb')?.['#text']);
  return {imdb:imdb&&/^tt\d+$/.test(imdb)?imdb:undefined,tvdb:tvdb&&/^\d+$/.test(tvdb)?tvdb:undefined};
}
export async function readLocalMetadata(file:string,root:string,series:boolean) {
  const stem=basename(file,extname(file));
  let item=await readNfo(join(dirname(file),stem+'.nfo'),root);
  if(!series&&!item.title)item=await readNfo(join(dirname(file),'movie.nfo'),root);
  let show:any={};
  if(series)for(const dir of ancestorDirectories(file,root)){
    show=await readNfo(join(dir,'tvshow.nfo'),root);if(show.title||show.plot)break;
  }
  return {title:plainText(item.title),overview:plainText(item.plot),seriesTitle:plainText(item.showtitle)||plainText(show.title),seriesOverview:plainText(show.plot),year:Number(item.year)||undefined,seriesYear:Number(show.year)||undefined,genres:array(show.genre||item.genre).map(plainText).filter((v):v is string=>!!v),externalIds:ids(series?show:item)};
}
export async function localArtwork(file:string,root:string,kind:ImageKind,season?:number):Promise<string|undefined> {
  const stem=basename(file,extname(file)),dirs=ancestorDirectories(file,root);
  for(const dir of dirs){
    const same=dir===dirname(file);
    const names=kind==='still'?(same?[stem+'-thumb.jpg',stem+'-thumb.png',stem+'.jpg',stem+'-landscape.jpg']:[]):kind==='season'&&season!==undefined?[`season${String(season).padStart(2,'0')}-poster.jpg`,`season${String(season).padStart(2,'0')}-poster.png`]:kind==='backdrop'?['backdrop.jpg','fanart.jpg','landscape.jpg','background.jpg','backdrop.png']:['poster.jpg','folder.jpg','poster.png','folder.png'];
    if(kind==='poster'&&same)names.unshift(stem+'-poster.jpg',stem+'-poster.png');
    for(const name of names)try{const path=await checkedPath(join(dir,name),root);if((await stat(path)).isFile())return path;}catch{/*Try another sidecar within this library.*/}
  }
}
