import { useEffect, useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, TVFocusGuideView, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Icon, ProgressBar, Searchbar, Text } from 'react-native-paper';
import type { CatalogItem, Media, SeriesSummary } from '../../../shared/types';
import { request, type Session } from './api';
import { Action, Empty, FocusCard } from './components';
import { artwork, duration } from './mediaDisplay';

type Props={session:Session;view:string;revision:number;onSelect:(media:Media)=>void;onSeries:(series:SeriesSummary)=>void;onError:(message:string)=>void;initialFocus?:string};
const labels:Record<string,string>={all:'Your evening, sorted.',movies:'Movies',shows:'TV shows',favorites:'Favorites'};

export function TVLibrary({session,view,revision,onSelect,onSeries,initialFocus}:Props){
  const {width}=useWindowDimensions(),[items,setItems]=useState<CatalogItem[]>([]),[continuing,setContinuing]=useState<Media[]>([]),[total,setTotal]=useState(0),[query,setQuery]=useState(''),[searching,setSearching]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const columns=width>=1400?5:4,cardWidth=(width-96-56)/columns-10;
  const path=`/api/catalog?view=${view}&q=${encodeURIComponent(query)}&limit=200`;
  useEffect(()=>{setQuery('');setSearching(false);},[view]);
  useEffect(()=>{
    let active=true;setBusy(true);setError('');
    const timer=setTimeout(()=>{void(async()=>{
      try{
        const [catalog,history]=await Promise.all([request<{items:CatalogItem[];total:number}>(session,path),view==='all'&&!query?request<{items:CatalogItem[]}>(session,'/api/catalog?view=continue&limit=12'):Promise.resolve({items:[]})]);
        if(active){setItems(catalog.items);setTotal(catalog.total);setContinuing(history.items.flatMap(item=>item.kind==='media'?[item.media]:[]));}
      }catch(e){if(active)setError((e as Error).message);}finally{if(active)setBusy(false);}
    })();},200);
    return()=>{active=false;clearTimeout(timer);};
  },[path,revision,refresh,session.server]);
  function select(item:CatalogItem){if(item.kind==='series')onSeries(item.series);else onSelect(item.media);}
  const featured=items[0],featureTitle=featured?.kind==='series'?featured.series.title:featured?.media.title;
  const feature=featured?.kind==='series'?featured.series:featured?.media,featureId=featured?.kind==='series'?featured.series.imageMediaId:featured?.media.id;
  const header=<View style={styles.header}>
    <View style={styles.heading}><View style={{gap:5,flex:1}}><Text style={styles.eyebrow}>KATHRINE / {view==='all'?'HOME':(labels[view]||'LIBRARY').toUpperCase()}</Text><Text style={styles.headingText}>{query?'Search results':labels[view]||'Your collection'}</Text></View><Action icon={searching?'close':'magnify'} onPress={()=>{setSearching(value=>!value);setQuery('');}}>{searching?'Close':'Search'}</Action></View>
    {searching&&<Searchbar autoFocus placeholder="Search your collection" value={query} onChangeText={setQuery} style={styles.search}/>}
    {busy&&<ActivityIndicator style={{alignSelf:'flex-start'}}/>}
    {error?<View style={styles.error}><Text variant="titleMedium">Couldn't load your collection</Text><Text>{error}</Text><Action icon="reload" mode="contained" onPress={()=>setRefresh(value=>value+1)}>Try again</Action></View>:<>
      {view==='all'&&!query&&featured&&<View style={styles.hero}>
        <View style={styles.heroCopy}><Text style={styles.eyebrow}>{featured.kind==='series'?'A SERIES FROM YOUR COLLECTION':'FROM YOUR COLLECTION'}</Text><Text numberOfLines={2} style={styles.heroTitle}>{featureTitle}</Text><Text style={styles.meta}>{[feature?.year,...(feature?.genres||[]).slice(0,2)].filter(Boolean).join(' · ')}</Text>{!!feature?.overview&&<Text numberOfLines={3} style={styles.overview}>{feature.overview}</Text>}<View style={{alignSelf:'flex-start'}}><Action mode="contained" icon={featured.kind==='series'?'television-play':'play-outline'} onPress={()=>select(featured)}>{featured.kind==='series'?'Explore series':'View film'}</Action></View></View>
        <Image source={artwork(session,featureId!,'backdrop',feature?.artworkVersion)} resizeMode="contain" style={styles.heroArt}/>
      </View>}
      {view==='all'&&!query&&continuing.length>0&&<View style={styles.shelf}><Text style={styles.sectionTitle}>Pick up where you left off</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.continueRow}>{continuing.map(media=><FocusCard key={media.id} style={{width:260}} label={`Continue ${media.series?media.series+' · ':''}${media.title}`} onPress={()=>onSelect(media)}><Image source={artwork(session,media.id,media.series?'still':'backdrop',media.artworkVersion)} style={{width:'100%',aspectRatio:16/9}}/><ProgressBar progress={media.duration>0?Math.min(1,media.position/media.duration):0} color="#DBE9FF" style={{height:3}}/><View style={styles.cardText}><Text numberOfLines={1} style={styles.cardTitle}>{media.series||media.title}</Text><Text numberOfLines={1} style={styles.meta}>{media.series?`S${media.season??'—'} E${media.episode??'—'} · `:''}{duration(Math.max(0,media.duration-media.position))} left</Text></View></FocusCard>)}</ScrollView></View>}
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{view==='all'&&!query?'Your collection':query?'Matching titles':labels[view]}</Text><Text style={styles.meta}>{total} {total===1?'title':'titles'}</Text></View>
    </>}
  </View>;
  return <TVFocusGuideView autoFocus style={{flex:1}}><FlatList key={`${view}-${columns}`} data={error?[]:items} numColumns={columns} keyExtractor={item=>item.id} showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid} ListHeaderComponent={header} ListEmptyComponent={!busy&&!error?<Empty title={query?'No matching titles':view==='favorites'?'Your favorites live here':'Your collection is waiting'} description={query?'Try a different title or series name.':view==='favorites'?'Save a film or episode from its details to find it here.':'Add a media folder in the server settings to get started.'}/>:null} renderItem={({item})=>{
    const series=item.kind==='series'?item.series:null,media=item.kind==='media'?item.media:null,title=series?.title||media!.title;
    return <FocusCard preferred={initialFocus===item.id||initialFocus===media?.id||initialFocus===series?.id} label={title} style={{width:cardWidth,margin:5,marginBottom:15}} onPress={()=>select(item)}>
      <View><Image source={artwork(session,series?.imageMediaId||media!.id,'poster',series?.artworkVersion||media?.artworkVersion)} resizeMode="cover" style={styles.poster}/>{(series?series.completedEpisodes===series.episodeCount:media!.completed)&&<View style={styles.watched}><Icon source="check-circle" size={22} color="#DBE9FF"/></View>}{media&&media.position>0&&!media.completed&&<ProgressBar progress={media.duration>0?Math.min(1,media.position/media.duration):0} style={{height:3}}/>}</View>
      <View style={styles.cardText}><Text style={styles.cardTitle} numberOfLines={1}>{title}</Text><Text numberOfLines={1} style={styles.meta}>{series?`${series.seasonCount} seasons · ${series.episodeCount} episodes`:[media!.year,duration(media!.duration)].filter(Boolean).join(' · ')}</Text></View>
    </FocusCard>;
  }} ListFooterComponent={!error&&items.length<total?<Action loading={busy} onPress={async()=>{setBusy(true);try{const page=await request<{items:CatalogItem[]}>(session,path+`&offset=${items.length}`);setItems(old=>[...old,...page.items]);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>More titles</Action>:<View style={{height:24}}/>}/></TVFocusGuideView>;
}
const styles=StyleSheet.create({grid:{padding:23,paddingTop:28},header:{paddingHorizontal:5},heading:{flexDirection:'row',alignItems:'center',gap:20,marginBottom:24},eyebrow:{fontSize:10,fontWeight:'700',letterSpacing:2,color:'#95A9C4'},headingText:{fontSize:28,fontWeight:'700',color:'#F3F5F9'},search:{marginBottom:20,backgroundColor:'#1B2533'},hero:{flexDirection:'row',gap:26,alignItems:'center',paddingBottom:28},heroCopy:{flex:1,gap:10},heroTitle:{fontSize:32,fontWeight:'700',color:'#F3F5F9'},heroArt:{width:'49%',aspectRatio:16/9,borderRadius:10,backgroundColor:'#131A24'},overview:{fontSize:14,lineHeight:21,color:'#B4BECD'},meta:{fontSize:12,color:'#99A8BD'},sectionHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12,marginTop:4},sectionTitle:{fontSize:19,fontWeight:'600',color:'#E7EDF7'},shelf:{gap:12,marginBottom:22},continueRow:{gap:10,padding:4},poster:{width:'100%',aspectRatio:2/3,backgroundColor:'#1C2634'},cardText:{padding:11,gap:5},cardTitle:{fontSize:14,fontWeight:'600',color:'#EEF2F8'},watched:{position:'absolute',top:9,right:9,backgroundColor:'#0C1017CC',borderRadius:20,padding:4},error:{padding:24,gap:16,alignItems:'flex-start'}});
