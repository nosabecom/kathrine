import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogItem, Media } from '../shared/types';
import { libraryFocusTarget } from '../apps/mobile/src/tvFocus.js';

const media=(id:string)=>({id} as Media);
const film=(id:string):CatalogItem=>({id:`media:${id}`,kind:'media',media:media(id)});

test('TV sections focus the first title once the catalog arrives',()=>{
  assert.equal(libraryFocusTarget([],[]),undefined);
  assert.equal(libraryFocusTarget([film('first'),film('second')],[]),'catalog:media:first');
});

test('Home prioritizes continue watching with only one target for duplicated titles',()=>{
  assert.equal(libraryFocusTarget([film('same')],[media('same')]),'continue:same');
});

test('Back restores a film, series or continue-watching card ahead of the default',()=>{
  const series={id:'series:show',kind:'series',series:{id:'show'}} as CatalogItem;
  assert.equal(libraryFocusTarget([film('first'),film('last')],[],'last'),'catalog:media:last');
  assert.equal(libraryFocusTarget([film('first'),series],[],'show'),'catalog:series:show');
  assert.equal(libraryFocusTarget([film('first')],[media('first'),media('last')],'last'),'continue:last');
});

test('a removed title falls back to an available card',()=>{
  assert.equal(libraryFocusTarget([film('first')],[],'removed'),'catalog:media:first');
  assert.equal(libraryFocusTarget([],[],'removed'),undefined);
});
