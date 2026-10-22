import { useEffect, useState } from 'react';
import { ActivityIndicator, Appbar, BottomNavigation, Icon, PaperProvider, Snackbar, Surface, Text } from 'react-native-paper';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Media, SeriesSummary } from '../../../shared/types';
import { restoreSession, saveSession, request, type Session } from './api';
import { theme } from './theme';
import { Action, isTV } from './components';
import { Login } from './Login';
import { LibraryScreen, DetailScreen } from './Library';
import { SeriesScreen } from './Series';
import { SettingsScreen } from './Settings';
import { PlayerScreen } from './Player';
const routes=[{key:'all',title:'Home',focusedIcon:'home',unfocusedIcon:'home-outline'},{key:'movies',title:'Movies',focusedIcon:'movie',unfocusedIcon:'movie-outline'},{key:'shows',title:'TV',focusedIcon:'television'},{key:'favorites',title:'Favorites',focusedIcon:'heart',unfocusedIcon:'heart-outline'},{key:'settings',title:'Settings',focusedIcon:'cog',unfocusedIcon:'cog-outline'}];
export default function App(){
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[index,setIndex]=useState(0),[selected,setSelected]=useState<Media|null>(null),[playing,setPlaying]=useState<Media|null>(null),[series,setSeries]=useState<SeriesSummary|null>(null),[season,setSeason]=useState<string|undefined>(undefined),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
  useEffect(()=>{void restoreSession().then(setSession).catch(e=>setNotice(e.message)).finally(()=>setReady(true));},[]);
  useEffect(()=>{if(Platform.OS==='web')return;const listener=BackHandler.addEventListener('hardwareBackPress',()=>{if(playing){setPlaying(null);setRevision(n=>n+1);return true;}if(selected){setSelected(null);return true;}if(series){setSeries(null);setSeason(undefined);return true;}if(index!==0){setIndex(0);return true;}return false;});return()=>listener.remove();},[playing,selected,series,index]);
  async function login(value:Session){await saveSession(value);setSession(value);}
  async function logout(){if(session)try{await request(session,'/api/auth/logout','POST',{});}catch{/*Local sign-out still works when the server cannot be reached.*/}await saveSession(null);setSession(null);setSelected(null);setSeries(null);setSeason(undefined);setPlaying(null);}
  const navigation=(value:number)=>{setIndex(value);setSelected(null);setSeries(null);setSeason(undefined);};
  return <SafeAreaProvider><PaperProvider theme={theme}><StatusBar style="light"/><SafeAreaView style={styles.safe} edges={isTV?[]:['top','left','right']}>
    {!ready?<View style={styles.loading}><ActivityIndicator size="large"/><Text variant="headlineSmall">Opening your cinema</Text></View>:!session?<Login onLogin={login} onError={setNotice}/>:playing?<PlayerScreen session={session} media={playing} onPosition={position=>setSelected(current=>current?.id===playing.id?{...current,position,completed:current.duration>0&&position/current.duration>=0.95}:current)} close={()=>{setPlaying(null);setRevision(n=>n+1);}}/>:<>
      <Appbar.Header statusBarHeight={0} mode={isTV?'small':'center-aligned'} elevated>{(selected||series)&&<Appbar.BackAction onPress={()=>{if(selected)setSelected(null);else{setSeries(null);setSeason(undefined);}}}/>}<Appbar.Content title={selected?.title||series?.title||'Kathrine'} titleStyle={isTV?{fontSize:28}:undefined}/><Appbar.Action icon="server-network" accessibilityLabel="Server connection" onPress={()=>{navigation(4);}}/></Appbar.Header>
      <View style={styles.body}>{isTV&&<Surface elevation={1} style={styles.rail}><View style={styles.railBrand}><Icon source="play-box-multiple-outline" size={38} color={theme.colors.primary}/><Text variant="labelMedium">YOUR CINEMA</Text></View>{routes.map((route,i)=><Action key={route.key} icon={route.focusedIcon} mode={index===i?'contained-tonal':'text'} onPress={()=>navigation(i)} style={{marginBottom:12}}>{route.title}</Action>)}</Surface>}
        <View style={styles.screen}>{selected?<DetailScreen session={session} media={selected} onPlay={setPlaying} onChange={m=>{setSelected(m);setRevision(n=>n+1);}} onError={setNotice}/>:series?<SeriesScreen session={session} series={series} revision={revision} season={season} onSeason={setSeason} onSelect={setSelected} onPlay={m=>{setSelected(m);setPlaying(m);}} onError={setNotice}/>:routes[index].key==='settings'?<SettingsScreen session={session} logout={logout} onError={setNotice}/>:<LibraryScreen session={session} view={routes[index].key} revision={revision} onSelect={setSelected} onSeries={value=>{setSeries(value);setSeason(undefined);}} onError={setNotice}/>}</View>
      </View>{!isTV&&<BottomNavigation.Bar navigationState={{index,routes}} onTabPress={({route})=>navigation(routes.indexOf(route))} renderIcon={({route,color,focused})=><Icon source={focused?route.focusedIcon:route.unfocusedIcon||route.focusedIcon} color={color} size={24}/>} getLabelText={({route})=>route.title} activeColor={theme.colors.onSecondaryContainer} inactiveColor={theme.colors.onSurfaceVariant}/>}
    </>}
    <Snackbar visible={!!notice} onDismiss={()=>setNotice('')} duration={6500} action={{label:'Dismiss',onPress:()=>setNotice('')}}>{notice}</Snackbar>
  </SafeAreaView></PaperProvider></SafeAreaProvider>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:theme.colors.background},loading:{flex:1,alignItems:'center',justifyContent:'center',gap:24},body:{flex:1,flexDirection:'row'},screen:{flex:1},rail:{width:190,padding:18,gap:4},railBrand:{alignItems:'center',gap:10,paddingVertical:24}});
