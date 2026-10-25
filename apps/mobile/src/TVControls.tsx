import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, Pressable, StyleSheet, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import type { VideoPlayer } from 'expo-video';
import { Icon, Text } from 'react-native-paper';
import type { Media } from '../../../shared/types';
import { isTVKeyPress, playbackTime, seekPosition } from './tvPlayback';

type ControlProps={icon:string;label:string;onPress:()=>void;preferred?:boolean;primary?:boolean;onFocus?:()=>void};
export function TVControl({icon,label,onPress,preferred,primary,onFocus}:ControlProps){
  const [focused,setFocused]=useState(false);
  return <Pressable focusable accessibilityRole="button" accessibilityLabel={label} hasTVPreferredFocus={preferred} onFocus={()=>{setFocused(true);onFocus?.();}} onBlur={()=>setFocused(false)} onPress={onPress} style={[styles.button,primary&&styles.primary,focused&&styles.focused]}>
    <Icon source={icon} size={primary?30:24} color={focused||primary?'#101318':'#F5F7FA'}/><Text style={[styles.buttonLabel,(focused||primary)&&styles.darkLabel]}>{label}</Text>
  </Pressable>;
}

export function TVControls({player,media,offset,blocked,tracks,close}:{player:VideoPlayer;media:Media;offset:number;blocked:boolean;tracks:(kind:'audio'|'subtitles'|'info')=>void;close:()=>void}){
  const {isPlaying}=useEvent(player,'playingChange',{isPlaying:player.playing});
  const time=useEvent(player,'timeUpdate');
  const currentTime=time?.currentTime??player.currentTime;
  const [visible,setVisible]=useState(true),[timelineFocused,setTimelineFocused]=useState(false),[preview,setPreview]=useState<number|null>(null);
  const opacity=useRef(new Animated.Value(1)).current,lastInput=useRef(Date.now()),visibleRef=useRef(true),wake=useRef<View>(null),timeline=useRef<View>(null);
  const duration=media.duration||player.duration+offset,position=currentTime+offset,display=preview??position;
  const seekEnd=Math.min(duration,player.duration>0?player.duration+offset:duration);
  function show(){lastInput.current=Date.now();visibleRef.current=true;setVisible(true);}
  function hide(){setPreview(null);visibleRef.current=false;setVisible(false);}
  function seek(delta:number){show();player.currentTime=seekPosition(player.currentTime+offset,delta,offset,seekEnd)-offset;}
  function toggle(){show();if(player.playing)player.pause();else player.play();}
  useEffect(()=>{Animated.timing(opacity,{toValue:visible?1:0,duration:visible?160:260,useNativeDriver:true}).start();if(!visible)wake.current?.requestTVFocus();},[visible]);
  useEffect(()=>{const timer=setInterval(()=>{if(player.playing&&!blocked&&!timelineFocused&&preview===null&&Date.now()-lastInput.current>4500)hide();},500);return()=>clearInterval(timer);},[blocked,timelineFocused,preview]);
  useEffect(()=>{if(!isPlaying||blocked)show();},[isPlaying,blocked]);
  useEffect(()=>{if(!blocked)show();},[blocked]);
  useEffect(()=>{const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{
    if(blocked)return false;
    if(preview!==null){setPreview(null);show();return true;}
    if(visibleRef.current){hide();return true;}
    close();return true;
  });return()=>subscription.remove();},[blocked,preview,close]);
  useTVEventHandler(event=>{
    if(blocked||!isTVKeyPress(event))return;
    const key=event.eventType;
    // Android's media session already handles transport keys. Toggling again
    // here on release would undo the native Play/Pause action.
    if(Platform.OS==='android'&&['playPause','play','pause','fastForward','rewind'].includes(key)){show();return;}
    if(key==='playPause'){toggle();return;}
    if(key==='play'){show();player.play();return;}
    if(key==='pause'){show();player.pause();return;}
    if(key==='fastForward'){seek(30);return;}
    if(key==='rewind'){seek(-30);return;}
    if(['up','down','left','right','longLeft','longRight','select'].includes(key)){
      const wasVisible=visibleRef.current;show();
      if((key==='left'||key==='right'||key==='longLeft'||key==='longRight')&&timelineFocused&&wasVisible){
        const delta=(key.toLowerCase().includes('left')?-1:1)*(key.startsWith('long')?60:10);
        setPreview(value=>seekPosition(value??position,delta,offset,seekEnd));
      }
    }
  });
  const fill=duration>0?Math.max(0,Math.min(100,display/duration*100)):0;
  return <View style={StyleSheet.absoluteFill} pointerEvents={blocked?'none':'box-none'}>
    {!visible&&!blocked&&<Pressable ref={wake} focusable hasTVPreferredFocus accessibilityLabel="Show playback controls" onPress={show} style={StyleSheet.absoluteFill}/>}
    <Animated.View pointerEvents={visible&&!blocked?'box-none':'none'} accessibilityElementsHidden={!visible||blocked} importantForAccessibility={visible&&!blocked?'auto':'no-hide-descendants'} style={[StyleSheet.absoluteFill,{opacity}]}>
      <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={styles.overlay} focusable={visible&&!blocked}>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.75)','transparent']} style={styles.topShade}/>
        <View style={styles.top}><TVControl icon="arrow-left" label="Back" onPress={close} onFocus={show}/><Text style={styles.brand}>KATHRINE</Text></View>
        <View style={styles.bottom}>
          <LinearGradient pointerEvents="none" colors={['transparent','rgba(0,0,0,0.82)','rgba(0,0,0,0.96)']} locations={[0,0.38,1]} style={StyleSheet.absoluteFill}/>
          <View style={styles.bottomContent}>
            {media.series&&<Text style={styles.eyebrow}>{media.series}   ·   S{media.season??'—'} E{media.episode??'—'}</Text>}
            <View style={styles.titleRow}><Text numberOfLines={1} style={styles.title}>{media.title}</Text><Text style={styles.remaining}>{Math.max(0,Math.ceil((duration-display)/60))} min left</Text></View>
            <Pressable ref={timeline} focusable nextFocusLeft={timeline.current} nextFocusRight={timeline.current} accessibilityRole="adjustable" accessibilityLabel={`Seek. ${playbackTime(display)} of ${playbackTime(duration)}. Left and right to choose a time, OK to seek.`} accessibilityValue={{min:offset,max:seekEnd,now:Math.min(display,seekEnd)}} accessibilityActions={[{name:'increment',label:'Forward 10 seconds'},{name:'decrement',label:'Back 10 seconds'}]} onAccessibilityAction={event=>seek(event.nativeEvent.actionName==='increment'?10:-10)} onFocus={()=>{setTimelineFocused(true);show();}} onBlur={()=>{setTimelineFocused(false);setPreview(null);}} onPress={()=>{if(preview!==null){player.currentTime=preview-offset;setPreview(null);}else toggle();show();}} style={styles.timelineTarget}>
              <View style={[styles.timeline,timelineFocused&&{height:6}]}><View style={[styles.elapsed,{width:`${fill}%`}]}/><View style={[styles.thumb,{left:`${fill}%`},timelineFocused&&styles.thumbFocused]}/></View>
              <View style={styles.times}><Text style={styles.time}>{playbackTime(display)}{preview!==null?'  ·  OK to seek':''}</Text><Text style={styles.time}>{playbackTime(duration)}</Text></View>
            </Pressable>
            <View style={styles.actions}><View style={styles.transport}>
              <TVControl icon={isPlaying?'pause':'play'} label={isPlaying?'Pause':'Play'} primary preferred onPress={toggle} onFocus={show}/>
              <TVControl icon="rewind-10" label="Back 10s" onPress={()=>seek(-10)} onFocus={show}/><TVControl icon="fast-forward-10" label="Forward 10s" onPress={()=>seek(10)} onFocus={show}/>
            </View><View style={styles.transport}><TVControl icon="music-note-outline" label="Audio" onPress={()=>{show();tracks('audio');}} onFocus={show}/><TVControl icon="subtitles-outline" label="Subtitles" onPress={()=>{show();tracks('subtitles');}} onFocus={show}/><TVControl icon="information-outline" label="Info" onPress={()=>{show();tracks('info');}} onFocus={show}/></View></View>
          </View>
        </View>
      </TVFocusGuideView>
    </Animated.View>
  </View>;
}
const styles=StyleSheet.create({
  overlay:{flex:1},topShade:{position:'absolute',top:0,left:0,right:0,height:120},top:{paddingHorizontal:36,paddingTop:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:13,letterSpacing:4,color:'#FFFFFF99',fontWeight:'700'},
  bottom:{position:'absolute',bottom:0,left:0,right:0,paddingTop:65},bottomContent:{paddingHorizontal:40,paddingBottom:28,gap:8},eyebrow:{fontSize:15,fontWeight:'500',color:'#D3D9E3'},titleRow:{flexDirection:'row',alignItems:'center',gap:24},title:{fontSize:30,fontWeight:'700',color:'#F5F7FA',flex:1},remaining:{fontSize:14,color:'#BCC4D0'},
  timelineTarget:{paddingTop:15,paddingBottom:4},timeline:{height:3,backgroundColor:'#FFFFFF40',borderRadius:3,justifyContent:'center'},elapsed:{height:'100%',borderRadius:3,backgroundColor:'#DBE9FF'},thumb:{position:'absolute',width:8,height:8,borderRadius:8,marginLeft:-4,backgroundColor:'#DBE9FF'},thumbFocused:{width:16,height:16,marginLeft:-8,backgroundColor:'#FFF'},times:{flexDirection:'row',justifyContent:'space-between',marginTop:12},time:{fontSize:13,color:'#DEE4EC',fontVariant:['tabular-nums']},
  actions:{flexDirection:'row',justifyContent:'space-between',gap:12,marginTop:2},transport:{flexDirection:'row',alignItems:'center',gap:8},button:{minHeight:48,paddingHorizontal:13,borderRadius:8,borderWidth:2,borderColor:'transparent',backgroundColor:'#FFFFFF10',flexDirection:'row',gap:7,alignItems:'center',justifyContent:'center'},primary:{backgroundColor:'#E1E9F5',minWidth:100},focused:{backgroundColor:'#FFFFFF',borderColor:'#FFF',transform:[{scale:1.04}]},buttonLabel:{fontSize:13,fontWeight:'600',color:'#F5F7FA'},darkLabel:{color:'#101318'},
});
