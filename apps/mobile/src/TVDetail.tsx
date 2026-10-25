import { Image, ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { Chip, List, Text } from 'react-native-paper';
import type { Media } from '../../../shared/types';
import { updateProgress, type Session } from './api';
import { Action } from './components';
import { artwork, duration, MetadataCredits, quality } from './mediaDisplay';

export function TVDetail({session,media,onPlay,onChange,onError}:{session:Session;media:Media;onPlay:(media:Media)=>void;onChange:(media:Media)=>void;onError:(message:string)=>void}){
  const video=media.streams.find(stream=>stream.type==='video'),resume=media.position>0&&!media.completed;
  async function favorite(){try{await updateProgress(session,media.id,{favorite:!media.favorite});onChange({...media,favorite:!media.favorite});}catch(e){onError((e as Error).message);}}
  return <TVFocusGuideView autoFocus style={{flex:1}}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>{media.series?`${media.series.toUpperCase()} / SEASON ${media.season??'—'} / EPISODE ${media.episode??'—'}`:'YOUR COLLECTION / FILM'}</Text>
    <View style={styles.hero}><Image source={artwork(session,media.id,media.series?'still':'backdrop',media.artworkVersion)} resizeMode="contain" style={styles.art}/><View style={styles.heading}>
      <Text style={styles.title}>{media.title}</Text><Text style={styles.meta}>{[media.year,duration(media.duration),...(media.genres||[]).slice(0,2)].filter(Boolean).join(' · ')}</Text>
      <View style={styles.row}><Chip compact>{quality(media)}</Chip>{video?.hdr&&<Chip compact>{video.hdr.toUpperCase()}</Chip>}{media.completed&&<Chip compact icon="check">Watched</Chip>}</View>
      <View style={{alignSelf:'flex-start'}}><Action mode="contained" icon="play" onPress={()=>onPlay(media)}>{resume?`Resume from ${duration(media.position)}`:'Watch now'}</Action></View>
    </View></View>
    {!!media.overview&&<Text style={styles.overview}>{media.overview}</Text>}
    <View style={styles.row}><Action mode="outlined" icon={media.favorite?'heart':'heart-outline'} onPress={()=>void favorite()}>{media.favorite?'In favorites':'Add to favorites'}</Action>{resume&&<Action icon="restart" onPress={()=>onPlay({...media,position:0,completed:false})}>Start over</Action>}<Action icon={media.completed?'check-circle':'check-circle-outline'} onPress={async()=>{try{await updateProgress(session,media.id,{completed:!media.completed,position:media.completed?0:media.duration});onChange({...media,completed:!media.completed,position:media.completed?0:media.duration});}catch(e){onError((e as Error).message);}}}>{media.completed?'Mark unwatched':'Mark watched'}</Action></View>
    <List.Accordion title="Playback details" style={styles.details} left={props=><List.Icon {...props} icon="information-outline"/>}>
      <View style={styles.fileInfo}><Text style={styles.meta}>{(media.size/1024**3).toFixed(1)} GB · {(media.bitrate/1e6).toFixed(1)} Mb/s · {media.container.toUpperCase()}</Text><Text style={styles.overview}>Playback uses the original video and audio whenever this device supports them. Conversion requires your permission.</Text>{media.streams.map(stream=><List.Item key={stream.index} title={`${stream.codec.toUpperCase()}${stream.title?' · '+stream.title:''}`} description={stream.type==='video'?`${stream.width} × ${stream.height} · ${stream.bitDepth}-bit`:[stream.language,stream.channels?`${stream.channels} channels`:null].filter(Boolean).join(' · ')} left={props=><List.Icon {...props} icon={stream.type==='video'?'filmstrip':stream.type==='audio'?'surround-sound':'subtitles-outline'}/>}/>)}</View>
    </List.Accordion><MetadataCredits sources={media.metadataSources} onError={onError}/>
  </ScrollView></TVFocusGuideView>;
}
const styles=StyleSheet.create({content:{padding:32,paddingBottom:40,gap:22},eyebrow:{fontSize:11,fontWeight:'600',letterSpacing:1.6,color:'#95A9C4'},hero:{flexDirection:'row',alignItems:'center',gap:28},art:{width:'48%',aspectRatio:16/9,borderRadius:10,backgroundColor:'#131A24'},heading:{flex:1,gap:16},title:{fontSize:30,fontWeight:'700',color:'#F3F5F9'},meta:{fontSize:13,color:'#99A8BD',lineHeight:20},overview:{fontSize:16,lineHeight:25,color:'#B4BECD'},row:{flexDirection:'row',flexWrap:'wrap',gap:10,alignItems:'center'},details:{backgroundColor:'#141D29',borderRadius:8},fileInfo:{padding:16,gap:12}});
