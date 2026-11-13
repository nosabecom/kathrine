import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSubtitleAppearance, nativeSubtitleStyle, normalizeSubtitleAppearance, subtitlePreviewColor, SubtitleAppearanceStore } from '../apps/mobile/src/subtitleAppearance.js';

test('invalid stored appearance cannot produce invisible text or invalid native parameters',()=>{
  const appearance=normalizeSubtitleAppearance({size:'huge',color:'#invalid',textOpacity:-10,background:'__proto__',backgroundOpacity:100,position:'outside',edge:'toString'});
  assert.equal(appearance.textOpacity,.35);
  assert.equal(appearance.backgroundOpacity,1);
  assert.equal(appearance.color,'white');
  assert.equal(appearance.background,'black');
  assert.equal(appearance.position,'bottom');
  assert.equal(appearance.edge,'dropShadow');
  assert.equal(appearance.size,'medium');
  assert.deepEqual(normalizeSubtitleAppearance(null),defaultSubtitleAppearance);
  assert.equal(normalizeSubtitleAppearance({textOpacity:Number.NaN}).textOpacity,1);
});

test('native opacity uses Android ARGB while the preview uses React Native RGBA',()=>{
  const style=nativeSubtitleStyle({...defaultSubtitleAppearance,color:'yellow',textOpacity:.65,backgroundOpacity:.5,position:'top',size:'extraLarge'});
  assert.equal(style.foregroundColor,'#A6FFE36E');
  assert.equal(style.backgroundColor,'#80000000');
  assert.equal(subtitlePreviewColor(style.foregroundColor),'#FFE36EA6');
  assert.equal(subtitlePreviewColor(style.backgroundColor),'#00000080');
  assert.equal(style.bottomPaddingFraction,.75);
  assert.equal(style.fontSize,34);
});

test('corrupt or future preferences fall back to readable Cinema subtitles',async()=>{
  for(const raw of ['{broken',JSON.stringify({version:99,appearance:{textOpacity:0}})]){
    const store=new SubtitleAppearanceStore({read:async()=>raw,write:async()=>{}});
    await store.load();
    assert.deepEqual(store.getSnapshot().appearance,defaultSubtitleAppearance);
    assert.equal(store.getSnapshot().loaded,true);
  }
});

test('a choice made during initial storage loading waits and preserves saved settings',async()=>{
  let finishRead!:(value:string)=>void;
  let reads=0,written='';
  const store=new SubtitleAppearanceStore({read:()=>{reads++;return new Promise(resolve=>{finishRead=resolve;});},write:async value=>{written=value;}});
  const loading=store.load(),changing=store.update({color:'cyan'});
  finishRead(JSON.stringify({version:1,appearance:{...defaultSubtitleAppearance,size:'large',position:'raised'}}));
  await Promise.all([loading,changing]);
  assert.equal(reads,1);
  assert.equal(store.getSnapshot().appearance.size,'large');
  assert.equal(store.getSnapshot().appearance.color,'cyan');
  assert.equal(JSON.parse(written).appearance.position,'raised');
});

test('rapid appearance changes preview immediately and persist in order without losing fields',async()=>{
  const pending:{value:string;finish:()=>void}[]=[];
  const store=new SubtitleAppearanceStore({read:async()=>null,write:value=>new Promise(resolve=>{pending.push({value,finish:resolve});})});
  await store.load();
  const first=store.update({size:'large'}),second=store.update({backgroundOpacity:.5});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.getSnapshot().appearance.size,'large');
  assert.equal(store.getSnapshot().appearance.backgroundOpacity,.5);
  assert.equal(store.getSnapshot().saving,true);
  assert.equal(pending.length,1,'The second disk write waits for the first.');
  pending[0].finish();await first;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);
  assert.equal(JSON.parse(pending[1].value).appearance.size,'large');
  assert.equal(JSON.parse(pending[1].value).appearance.backgroundOpacity,.5);
  pending[1].finish();await second;
  assert.equal(store.getSnapshot().saving,false);
});

test('a failed save is shown and the write queue accepts a later retry',async()=>{
  let fail=true,written='';
  const store=new SubtitleAppearanceStore({read:async()=>null,write:async value=>{if(fail)throw new Error('disk unavailable');written=value;}});
  await assert.rejects(store.update({position:'raised'}),/Could not save/);
  assert.equal(store.getSnapshot().appearance.position,'raised','Keep the live preview while showing the save error.');
  assert.ok(store.getSnapshot().error);
  assert.equal(store.getSnapshot().saving,false);
  fail=false;await store.update({position:'raised'});
  assert.equal(store.getSnapshot().error,null);
  assert.equal(JSON.parse(written).appearance.position,'raised');
  await store.reset();
  assert.deepEqual(JSON.parse(written).appearance,defaultSubtitleAppearance);
});
