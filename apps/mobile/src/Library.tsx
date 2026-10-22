import { useEffect, useState } from 'react';
import { FlatList, Image, Linking, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Card, Chip, Divider, Icon, List, ProgressBar, Searchbar, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import type { CatalogItem, Media, SeriesSummary } from '../../../shared/types';
import { request, updateProgress, type Session } from './api';
import { Action, Empty, FocusCard, isTV } from './components';
// RN TV 0.86 forwards Android image headers for array sources; object sources drop them.
export const artwork=(session:Session,id:string,kind:'auto'|'poster'|'backdrop'|'still'|'season'='auto',version?:string)=>[{uri:session.server+`/api/media/${id}/image?kind=${kind}${version?'&v='+encodeURIComponent(version):''}`,headers:{Authorization:'Bearer '+session.token}}];
export const duration=(value:number)=>`${Math.floor(value/3600)?Math.floor(value/3600)+'h ':''}${Math.floor(value%3600/60)}m`;
export function quality(media:Media){const v=media.streams.find(s=>s.type==='video');return (v?.height||0)>=4000?'8K':(v?.height||0)>=2000?'4K':(v?.height||0)>=1000?'1080p':`${v?.height||'—'}p`;}
const labels:Record<string,string>={all:'Your collection',movies:'Movies',shows:'TV shows',favorites:'Favorites',continue:'Continue watching'};
export function LibraryScreen({session,view,revision,onSelect,onSeries,onError}:{session:Session;view:string;revision:number;onSelect:(m:Media)=>void;onSeries:(s:SeriesSummary)=>void;onError:(m:string)=>void}){
  const {width}=useWindowDimensions(),theme=useTheme();
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[items,setItems]=useState<CatalogItem[]>([]),[total,setTotal]=useState(0),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const columns=isTV?5:width>=900?4:width>=600?3:2,actualView=view==='all'&&filter==='continue'?'continue':view;
  const contentWidth=width-(isTV?190:0)-32;
  const path=`/api/catalog?view=${actualView}&q=${encodeURIComponent(query)}&limit=200`;
  useEffect(()=>{setQuery('');setFilter('all');},[view]);
  useEffect(()=>{let active=true;const timer=setTimeout(async()=>{setBusy(true);try{const data=await request<{items:CatalogItem[];total:number}>(session,path);if(active){setItems(data.items);setTotal(data.total);}}catch(e){if(active)onError((e as Error).message);}finally{if(active)setBusy(false);}},200);return()=>{active=false;clearTimeout(timer);};},[path,revision,refresh,session.server]);
  return <View style={{flex:1}}>
    <View style={styles.heading}><Text variant={isTV?'headlineLarge':'headlineMedium'}>{labels[actualView]||'Your collection'}</Text><Text variant="bodyMedium" style={{color:theme.colors.onSurfaceVariant}}>{total} {actualView==='continue'?'episodes and films':'titles'} · From your server</Text><Searchbar placeholder="Search titles and series" value={query} onChangeText={setQuery} style={styles.search}/>{view==='all'&&<SegmentedButtons value={filter} onValueChange={setFilter} buttons={[{value:'all',label:'All titles',icon:'view-grid-outline'},{value:'continue',label:'Continue watching',icon:'play-circle-outline'}]}/>}</View>
    {busy&&!items.length?<ActivityIndicator size="large" style={{padding:40}}/>:<FlatList key={columns} data={items} numColumns={columns} keyExtractor={m=>m.id} contentContainerStyle={styles.grid} refreshControl={<RefreshControl refreshing={busy} onRefresh={()=>setRefresh(n=>n+1)} tintColor={theme.colors.primary}/>} ListEmptyComponent={<Empty title={query?'No matching titles':view==='favorites'?'Keep your favorites close':'Your next story starts here'} description={query?'Try a different title or series name.':view==='favorites'?'Open a title and tap the heart to save it here.':'Add your existing movie and TV folders in the server’s browser settings, then scan your library.'}/>} renderItem={({item})=>{
      const media=item.kind==='media'?item.media:null,series=item.kind==='series'?item.series:null;
      const title=series?.title||media!.title,id=series?.imageMediaId||media!.id;
      return <FocusCard style={{width:contentWidth/columns-8,margin:4}} label={title+(series?` · ${series.seasonCount} seasons · ${series.episodeCount} episodes`:media!.position>0?' · Continue watching':'')} onPress={()=>series?onSeries(series):onSelect(media!)}>
        <View><Image source={artwork(session,id,series||!media?.series?'poster':'still',series?.artworkVersion||media?.artworkVersion)} style={{width:'100%',aspectRatio:2/2.8,backgroundColor:theme.colors.surfaceVariant}} resizeMode="cover"/>{series&&<Chip compact style={styles.quality}>TV series</Chip>}{(series?series.completedEpisodes===series.episodeCount:media!.completed)&&<View style={styles.watched}><Icon source="check-circle" size={25} color={theme.colors.primary}/></View>}{media&&media.position>0&&!media.completed&&<ProgressBar progress={Math.min(1,media.position/media.duration)} color={theme.colors.primary} style={{height:4}}/>}</View>
        <View style={styles.cardText}><Text variant="titleSmall" numberOfLines={2}>{title}</Text><Text variant="bodySmall" style={{color:theme.colors.onSurfaceVariant}}>{series?`${series.seasonCount} seasons · ${series.episodeCount} episodes`:`${media!.episode!==undefined?`S${media!.season??'?'} · E${media!.episode}`:media!.year||'Film'} · ${duration(media!.duration)}`}</Text></View>
      </FocusCard>;
    }} ListFooterComponent={items.length<total?<Action loading={busy} onPress={async()=>{setBusy(true);try{const data=await request<{items:CatalogItem[]}>(session,path+`&offset=${items.length}`);setItems(old=>[...old,...data.items]);}catch(e){onError((e as Error).message);}finally{setBusy(false);}}}>Load more titles</Action>:<View style={{height:24}}/>}/>}</View>;
}
export function MetadataCredits({sources,onError}:{sources:Media['metadataSources'];onError:(message:string)=>void}){
  if(!sources?.length)return null;
  return <View style={styles.chips}><Text variant="bodySmall">Information from</Text>{sources.map(source=><Action key={source.url} compact icon="open-in-new" onPress={()=>void Linking.openURL(source.url).catch(e=>onError(e.message))}>{source.name}{source.name==='TVmaze'?' · CC BY-SA':''}</Action>)}</View>;
}
export function DetailScreen({session,media,onPlay,onChange,onError}:{session:Session;media:Media;onPlay:(m:Media)=>void;onChange:(m:Media)=>void;onError:(message:string)=>void}){
  const theme=useTheme(),video=media.streams.find(s=>s.type==='video');const {width}=useWindowDimensions();
  async function favorite(){try{await updateProgress(session,media.id,{favorite:!media.favorite});onChange({...media,favorite:!media.favorite});}catch(e){onError((e as Error).message);}}
  return <ScrollView contentContainerStyle={[styles.detail,isTV&&{padding:32}]}>
    <Image source={artwork(session,media.id,media.series?'still':'backdrop',media.artworkVersion)} style={{width:'100%',aspectRatio:isTV||width>700?2.5:16/9,borderRadius:24,backgroundColor:theme.colors.surfaceVariant}} resizeMode="cover"/>
    <View style={{gap:20}}>{media.series&&<Text variant="labelLarge" style={{color:theme.colors.primary}}>{media.series} · Season {media.season??'?'} · Episode {media.episode??'?'}</Text>}
      <Text variant={isTV?'displaySmall':'headlineLarge'}>{media.title}</Text>
      <Text variant="bodyMedium" style={{color:theme.colors.onSurfaceVariant}}>{[media.year,duration(media.duration),...(media.genres||[])].filter(Boolean).join(' · ')}</Text>
      {media.overview&&<Text variant="bodyLarge" style={{color:theme.colors.onSurfaceVariant}}>{media.overview}</Text>}
      <View style={styles.chips}><Action mode="contained" icon="play" onPress={()=>onPlay(media)}>{media.position>0&&!media.completed?'Resume · '+duration(media.position):'Watch now'}</Action><Action mode="outlined" icon={media.favorite?'heart':'heart-outline'} onPress={()=>void favorite()}>{media.favorite?'Saved':'Favorite'}</Action>{media.position>0&&<Action onPress={()=>onPlay({...media,position:0,completed:false})}>Start from beginning</Action>}</View>
      <Action icon={media.completed?'check-circle':'check-circle-outline'} onPress={async()=>{try{await updateProgress(session,media.id,{completed:!media.completed,position:media.completed?0:media.duration});onChange({...media,completed:!media.completed,position:media.completed?0:media.duration});}catch(e){onError((e as Error).message);}}}>{media.completed?'Mark unwatched':'Mark watched'}</Action>
      <List.Accordion title="Playback and file details" left={props=><List.Icon {...props} icon="file-video-outline"/>}>
        <View style={{gap:16,padding:12}}><View style={styles.chips}><Chip icon="high-definition">{quality(media)}</Chip>{video?.hdr&&<Chip>{video.hdr.toUpperCase()}</Chip>}<Chip>{(media.size/1024**3).toFixed(1)} GB</Chip></View>
        {media.streams.map(s=><List.Item key={s.index} title={`${s.codec.toUpperCase()}${s.profile?' · '+s.profile:''}`} description={s.type==='video'?`${s.width} × ${s.height} · ${s.bitDepth}-bit · ${Math.round(s.frameRate||0)} fps`:`${s.language||'und'}${s.channels?' · '+s.channels+' channels':''}${s.title?' · '+s.title:''}`} left={props=><List.Icon {...props} icon={s.type==='video'?'filmstrip':s.type==='audio'?'surround-sound':'subtitles-outline'}/>}/>)}
        <Text variant="bodySmall" style={{color:theme.colors.onSurfaceVariant}}>{(media.bitrate/1e6).toFixed(1)} Mb/s source. Original playback preserves the file’s video and audio. Decoding and sound output depend on your device and connected equipment.</Text></View>
      </List.Accordion>
      <MetadataCredits sources={media.metadataSources} onError={onError}/>
    </View>
  </ScrollView>;
}
const styles=StyleSheet.create({heading:{padding:20,gap:10},search:{marginVertical:8},grid:{padding:12,paddingTop:0},quality:{position:'absolute',top:8,left:8},watched:{position:'absolute',right:10,top:10},cardText:{padding:12,gap:7,minHeight:84},detail:{padding:20,paddingBottom:40,gap:24},chips:{flexDirection:'row',gap:8,flexWrap:'wrap'}});
