import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
const target=process.argv[2]||'phone';
if(!['phone','tv','lint'].includes(target))throw new Error('Expected phone, tv, or lint.');
const architectures=process.env.KATHRINE_ANDROID_ARCHITECTURES||(target==='tv'?'armeabi-v7a,arm64-v8a,x86_64':'arm64-v8a,x86_64');
const abiList=architectures.split(',');
if(!abiList.length||new Set(abiList).size!==abiList.length||abiList.some(abi=>!['armeabi-v7a','arm64-v8a','x86_64'].includes(abi)))throw new Error('KATHRINE_ANDROID_ARCHITECTURES must contain supported, unique Android ABIs.');
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(homedir(),'.local/share/android-sdk');
if(!existsSync(sdk))throw new Error('Install an Android SDK and set ANDROID_HOME. See docs/android.md.');
const windows=process.platform==='win32',cwd=resolve('apps/mobile');
const env={...process.env,ANDROID_HOME:sdk,EXPO_TV:target==='tv'?'1':'0',CI:'1',NODE_ENV:'production'};
function run(command,args,directory=cwd){return new Promise((res,rej)=>{const child=spawn(command,args,{cwd:directory,env,stdio:'inherit',shell:windows&&command==='pnpm'});child.on('error',rej);child.on('exit',code=>code===0?res():rej(new Error(`${command} exited ${code}`)));});}
if(target!=='lint')await run('pnpm',['exec','expo','prebuild','--platform','android','--clean','--no-install']);
if(!existsSync(join(cwd,'android/gradlew')))throw new Error('Run pnpm android:phone before lint.');
appendFileSync(join(cwd,'android/gradle.properties'),'\norg.gradle.workers.max=2\norg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m\n');
await run(windows?'cmd.exe':'sh',windows?['/d','/c','gradlew.bat',target==='lint'?'lintRelease':'assembleRelease','-PreactNativeArchitectures='+architectures]:['./gradlew',target==='lint'?'lintRelease':'assembleRelease','-PreactNativeArchitectures='+architectures],join(cwd,'android'));
if(target!=='lint'){
  mkdirSync('.artifacts/apks',{recursive:true});copyFileSync(join(cwd,'android/app/build/outputs/apk/release/app-release.apk'),`.artifacts/apks/kathrine-${target}.apk`);
  console.log(`Built .artifacts/apks/kathrine-${target}.apk (Expo, bundled JavaScript, sideload signing).`);
}
