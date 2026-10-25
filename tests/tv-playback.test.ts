import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTVKeyPress, playbackTime, seekPosition } from '../apps/mobile/src/tvPlayback.js';

test('TV playback clock stays readable across minute and hour boundaries',()=>{
  assert.equal(playbackTime(0),'0:00');
  assert.equal(playbackTime(59.9),'0:59');
  assert.equal(playbackTime(60),'1:00');
  assert.equal(playbackTime(3662),'1:01:02');
  assert.equal(playbackTime(Number.NaN),'0:00');
});

test('TV remote seeking clamps to the original file boundaries',()=>{
  assert.equal(seekPosition(4,-10,0,3600),0);
  assert.equal(seekPosition(3598,10,0,3600),3600);
  assert.equal(seekPosition(900,60,0,3600),960);
});

test('TV seek previews cannot enter unprepared compatibility segments',()=>{
  assert.equal(seekPosition(912,-60,900,3600),900);
  assert.equal(seekPosition(912,10,900,3600)-900,22,'The native seek uses stream-relative seconds.');
  assert.equal(seekPosition(900,-10,900,0),900,'An unknown duration cannot seek before the conversion offset.');
});

test('the Android TV direction release advances the timeline once',()=>{
  let position=900;
  for(const eventKeyAction of [0,1]){
    if(isTVKeyPress({eventType:'right',eventKeyAction}))position=seekPosition(position,10,0,3600);
  }
  assert.equal(position,910);
  assert.equal(isTVKeyPress({eventType:'left',eventKeyAction:1}),true,'Android TV defaults to key-up-only direction events.');
});

test('a held TV direction does not seek again on release',()=>{
  assert.equal(isTVKeyPress({eventType:'longRight',eventKeyAction:0}),true);
  assert.equal(isTVKeyPress({eventType:'longRight',eventKeyAction:1}),false);
  assert.equal(isTVKeyPress({eventType:'right'}),true,'Platforms without an action field still work.');
});
