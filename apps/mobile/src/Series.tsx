import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Chip, Icon, ProgressBar, Text, useTheme } from 'react-native-paper';
import type { Media, SeriesDetail, SeriesSummary } from '../../../shared/types';
import { request, type Session } from './api';
import { Action, FocusCard, isTV } from './components';
import { artwork, duration, MetadataCredits } from './Library';

export function SeriesScreen({session,series,revision,season,onSeason,onSelect,onPlay,onError}:{session:Session;series:SeriesSummary;revision:number;season:string|undefined;onSeason:(value:string)=>void;onSelect:(media:Media)=>void;onPlay:(media:Media)=>void;onError:(message:string)=>void}) {
  const theme=useTheme(),[detail,setDetail]=useState<SeriesDetail|null>(null),[busy,setBusy]=useState(true);
  useEffect(()=>{let active=true;setBusy(true);void request<SeriesDetail>(session,`/api/series/${series.id}`).then(value=>{if(active)setDetail(value);}).catch(e=>{if(active)onError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[series.id,revision,session.server]);
  if(!detail)return <View style={{padding:40}}>{busy?<ActivityIndicator size="large"/>:<Action onPress={()=>onError('Return to your library and reopen this series to retry.')}>Series unavailable</Action>}</View>;
  const current=detail.seasons.find(s=>String(s.number)===season)||detail.seasons[0],next=detail.continueEpisode;
  const heading=<><Text variant="labelLarge" style={{color:theme.colors.primary}}>TV SERIES{detail.year?' · '+detail.year:''}</Text><Text variant={isTV?'displaySmall':'headlineLarge'}>{detail.title}</Text>{!!detail.genres?.length&&<Text variant="bodyMedium">{detail.genres.join(' · ')}</Text>}</>;
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}>
      <Image source={artwork(session,detail.imageMediaId,'backdrop',detail.artworkVersion)} resizeMode="contain" style={styles.banner}/>
      <View style={styles.heroHeading}>{heading}</View>
    </View>
    {detail.overview&&<Text variant="bodyLarge" style={{color:theme.colors.onSurfaceVariant}}>{detail.overview}</Text>}
    <View style={styles.row}><Chip icon="television">{detail.seasonCount} seasons</Chip><Chip>{detail.episodeCount} episodes</Chip>{detail.completedEpisodes>0&&<Chip icon="check">{detail.completedEpisodes} watched</Chip>}</View>
    <View style={styles.row}>
      {next&&<Action mode="contained" icon="play" onPress={()=>onPlay(next)}>{next.position>0?'Resume':'Continue'} · S{next.season??'?'} E{next.episode??'?'}{next.position>0?' · '+duration(next.position):''}</Action>}
      <Action mode="outlined" icon="restart" onPress={()=>onPlay({...detail.firstEpisode,position:0,completed:false})}>Start from beginning</Action>
    </View>
    <Text variant="bodyMedium" style={{color:theme.colors.onSurfaceVariant}}>Choose a season and episode, or start with the first episode.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row,{flexWrap:'nowrap'}]}>{detail.seasons.map(s=><Action key={String(s.number)} mode={current.number===s.number?'contained-tonal':'outlined'} onPress={()=>onSeason(String(s.number))}>{s.title}</Action>)}</ScrollView>
    <View style={styles.seasonHeading}><Image source={artwork(session,current.imageMediaId||current.episodes[0].id,'season',detail.artworkVersion)} style={{width:isTV?96:70,aspectRatio:2/3,borderRadius:12,backgroundColor:theme.colors.surfaceVariant}}/><View style={{gap:10}}><Text variant="titleLarge">{current.title}</Text><Text variant="bodyMedium">{current.episodes.length} episodes</Text></View></View>
    {current.episodes.map(media=><FocusCard key={media.id} label={`Episode ${media.episode??'?'} · ${media.title}${media.completed?' · Watched':media.position>0?' · Resume '+duration(media.position):''}`} onPress={()=>onSelect(media)}>
      <View style={styles.episode}><Image source={artwork(session,media.id,'still',media.artworkVersion)} style={{width:isTV?200:110,aspectRatio:16/9,borderRadius:10,backgroundColor:theme.colors.surfaceVariant}}/><View style={{flex:1,gap:7}}><Text variant="labelLarge" style={{color:theme.colors.primary}}>EPISODE {media.episode??'—'}</Text><Text variant={isTV?'titleLarge':'titleMedium'}>{media.title}</Text><Text variant="bodySmall" style={{color:theme.colors.onSurfaceVariant}}>{duration(media.duration)}{media.completed?' · Watched':media.position>0?' · Resume '+duration(media.position):''}</Text>{media.overview&&<Text variant="bodyMedium" numberOfLines={isTV?2:3}>{media.overview}</Text>}{media.position>0&&!media.completed&&<ProgressBar progress={Math.min(1,media.position/media.duration)}/>}</View><Icon source={media.completed?'check-circle':'chevron-right'} size={26} color={theme.colors.primary}/></View>
    </FocusCard>)}
    <MetadataCredits sources={detail.metadataSources} onError={onError}/>
  </ScrollView>;
}
const styles=StyleSheet.create({content:{padding:isTV?32:20,paddingBottom:40,gap:20},hero:{gap:isTV?32:20,flexDirection:isTV?'row':'column',alignItems:isTV?'center':'stretch'},banner:{width:isTV?'60%':'100%',aspectRatio:16/9,borderRadius:24,backgroundColor:'#25232b'},heroHeading:{gap:12,...(isTV?{flex:1}:{})},seasonHeading:{flexDirection:'row',gap:20,alignItems:'center'},row:{flexDirection:'row',flexWrap:'wrap',gap:10,alignItems:'center'},episode:{padding:14,flexDirection:'row',gap:16,alignItems:'center'}});
