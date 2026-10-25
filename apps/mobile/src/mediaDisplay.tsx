import { Linking, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { Media } from '../../../shared/types';
import type { Session } from './api';
import { Action } from './components';

// RN TV 0.86 forwards Android image headers for array sources; object sources drop them.
export const artwork=(session:Session,id:string,kind:'auto'|'poster'|'backdrop'|'still'|'season'='auto',version?:string)=>[{uri:session.server+`/api/media/${id}/image?kind=${kind}${version?'&v='+encodeURIComponent(version):''}`,headers:{Authorization:'Bearer '+session.token}}];
export const duration=(value:number)=>`${Math.floor(value/3600)?Math.floor(value/3600)+'h ':''}${Math.floor(value%3600/60)}m`;
export function quality(media:Media){const video=media.streams.find(stream=>stream.type==='video');return (video?.height||0)>=4000?'8K':(video?.height||0)>=2000?'4K':(video?.height||0)>=1000?'1080p':`${video?.height||'—'}p`;}
export function MetadataCredits({sources,onError}:{sources:Media['metadataSources'];onError:(message:string)=>void}){
  if(!sources?.length)return null;
  return <View style={{flexDirection:'row',gap:8,flexWrap:'wrap',alignItems:'center'}}><Text variant="bodySmall">Information from</Text>{sources.map(source=><Action key={source.url} compact icon="open-in-new" onPress={()=>void Linking.openURL(source.url).catch(error=>onError(error.message))}>{source.name}{source.name==='TVmaze'?' · CC BY-SA':''}</Action>)}</View>;
}
