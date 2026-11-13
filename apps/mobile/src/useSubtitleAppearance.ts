import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { nativeSubtitleStyle, SubtitleAppearanceStore } from './subtitleAppearance';

const key='kathrine.subtitleAppearance.v1';
const store=new SubtitleAppearanceStore({
  read:()=>Platform.OS==='web'?Promise.resolve(globalThis.localStorage?.getItem(key)??null):SecureStore.getItemAsync(key),
  write:async value=>{if(Platform.OS==='web')globalThis.localStorage?.setItem(key,value);else await SecureStore.setItemAsync(key,value);},
});
export function useSubtitleAppearance(){
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  useEffect(()=>{void store.load();},[]);
  const subtitleStyle=useMemo(()=>nativeSubtitleStyle(snapshot.appearance),[snapshot.appearance]);
  return {...snapshot,subtitleStyle,updateAppearance:store.update,resetAppearance:store.reset};
}
