import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackProgress } from '../apps/mobile/src/playbackProgress.js';

test('empty player events cannot replace a saved resume point during capability inspection',()=>{
  const progress=new PlaybackProgress(900);
  const requestedStart=progress.beginLoading();
  assert.equal(progress.update(0),false);
  assert.equal(progress.update(2.801),false);
  assert.equal(progress.checkpoint(),null,'Loading/pause events must not write progress.');
  assert.equal(requestedStart,900);
  assert.equal(progress.position,900);
  progress.sourceLoaded();
  assert.equal(progress.update(901.2),true);
  assert.equal(progress.checkpoint(),901.2);
});

test('closing an unsupported or still-loading source does not erase watch history',()=>{
  const progress=new PlaybackProgress(900);
  progress.beginLoading();
  assert.equal(progress.checkpoint(),null);
  assert.equal(progress.beginLoading(),900,'A compatibility retry retains the intended position.');
});

test('compatibility playback reports absolute source time after resuming',()=>{
  const progress=new PlaybackProgress(900);
  progress.beginLoading();
  progress.sourceLoaded();
  progress.update(0,900);
  assert.equal(progress.checkpoint(),900);
  progress.update(12.5,900);
  assert.equal(progress.checkpoint(),912.5);
});

test('changing playback paths ignores reset events and preserves the latest observed position',()=>{
  const progress=new PlaybackProgress(900);
  progress.beginLoading();
  progress.sourceLoaded();
  progress.update(1050);
  assert.equal(progress.beginLoading(),1050);
  progress.update(0);
  assert.equal(progress.checkpoint(),null);
  progress.sourceLoaded();
  progress.update(1,1050);
  assert.equal(progress.checkpoint(),1051);
});

test('a loaded source can save zero after an intentional seek to the beginning',()=>{
  const progress=new PlaybackProgress(900);
  progress.beginLoading();
  progress.sourceLoaded();
  progress.update(901);
  progress.update(0);
  assert.equal(progress.checkpoint(),0);
});
