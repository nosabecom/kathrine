import type { ExpoConfig } from 'expo/config';
const tv=process.env.EXPO_TV==='1';
const config:ExpoConfig={
  icon:'./assets/icon.png',backgroundColor:'#141218',
  name:tv?'Kathrine TV':'Kathrine',slug:tv?'kathrine-tv':'kathrine',version:'0.3.1',scheme:tv?'kathrine-tv':'kathrine',orientation:tv?'landscape':'default',userInterfaceStyle:'dark',
  android:{package:tv?'dev.kathrine.app.tv':'dev.kathrine.app.phone',versionCode:4,allowBackup:false,permissions:['INTERNET','ACCESS_NETWORK_STATE','WAKE_LOCK','ACCESS_WIFI_STATE','POST_NOTIFICATIONS'],blockedPermissions:['android.permission.RECORD_AUDIO','android.permission.READ_MEDIA_IMAGES','android.permission.READ_MEDIA_VIDEO','android.permission.SYSTEM_ALERT_WINDOW']},
  plugins:[['@react-native-tvos/config-tv',{isTV:tv,androidTVBanner:'./assets/tv-banner.png'}],['expo-video',{supportsBackgroundPlayback:true,supportsPictureInPicture:!tv}],'expo-secure-store',['expo-build-properties',{android:{usesCleartextTraffic:true,minSdkVersion:26,compileSdkVersion:36,targetSdkVersion:36}}]],
  extra:{tv},web:{name:'Kathrine',bundler:'metro'},
};
export default config;
