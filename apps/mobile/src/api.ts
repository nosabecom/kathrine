import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { Capabilities, Media, User } from '../../../shared/types';
export type Session={server:string;token:string;user:User};
const key='kathrine.session';
export async function restoreSession():Promise<Session|null>{
  if(Platform.OS==='web')return null;
  const value=await SecureStore.getItemAsync(key);if(!value)return null;
  try{return JSON.parse(value);}catch{await SecureStore.deleteItemAsync(key);return null;}
}
export async function saveSession(session:Session|null){if(Platform.OS==='web')return;if(session)await SecureStore.setItemAsync(key,JSON.stringify(session));else await SecureStore.deleteItemAsync(key);}
export function serverAddress(input:string){
  const url=new URL(input.trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Enter the server root address, starting with http:// or https://.');
  const ip=url.hostname.split('.').map(Number),isIp=/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)&&ip.every(n=>n>=0&&n<=255);
  const local=isIp&&(ip[0]===10||ip[0]===127||ip[0]===192&&ip[1]===168||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===100&&ip[1]>=64&&ip[1]<=127);
  if(url.protocol==='http:'&&!local&&url.hostname!=='localhost'&&!url.hostname.endsWith('.ts.net'))throw new Error('Use HTTPS for public servers, or a LAN/Tailscale address for HTTP.');
  return url.origin;
}
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export async function request<T=any>(session:Pick<Session,'server'> & {token?:string},path:string,method='GET',body?:unknown):Promise<T>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35_000);
  try{
    const response=await fetch(session.server+path,{method,headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(session.token?{Authorization:'Bearer '+session.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
    const data=await response.json();if(!response.ok)throw new ApiError(data.error||`Server returned ${response.status}`,response.status);return data;
  }finally{clearTimeout(timer);}
}
const native=requireOptionalNativeModule<{inspect(media:string):Promise<string>}>('KathrinePlayback');
export async function capabilities(media:Media):Promise<Capabilities>{
  if(native)return JSON.parse(await native.inspect(JSON.stringify(media)));
  // Preview and Expo Go are conservative. Installed builds inspect actual Android hardware.
  return{client:'android',device:Platform.OS==='web'?'Web preview':'Uninspected development device',containers:['mp4','mkv','webm','ts'],video:[{codec:'h264',maxWidth:1920,maxHeight:1080,maxFrameRate:30,maxBitDepth:8}],audio:['aac','mp3','opus','flac'],passthrough:[],hdr:[]};
}
export function updateProgress(session:Session,id:string,body:{position?:number;completed?:boolean;favorite?:boolean}){return request(session,`/api/media/${id}/progress`,'PUT',body);}
