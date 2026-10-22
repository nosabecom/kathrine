import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Media } from '../shared/types.js';
import { buildSeries, catalog } from '../server/catalog.js';

const episode=(season:number,number:number,extra:Partial<Media>={}):Media=>({id:`s${season}e${number}`,libraryId:'tv',title:`Episode ${number}`,sortTitle:`Episode ${number}`,series:'Silicon Valley',season,episode:number,duration:1800,size:100,bitrate:100,container:'mkv',streams:[],addedAt:0,available:true,position:0,completed:false,favorite:false,...extra});

test('TV catalog has one series card across seasons, with a separate movie card',()=>{
  const items=[episode(2,1),episode(1,10),episode(1,2),episode(1,1),episode(0,1),episode(1,1,{id:'movie',series:undefined,title:'Margin Call',sortTitle:'Margin Call'})];
  const result=catalog(items,{limit:20,offset:0});
  assert.equal(result.total,2);
  const card=result.items.find(i=>i.kind==='series');
  assert.equal(card?.kind,'series');
  if(card?.kind!=='series')throw new Error('Series card missing');
  assert.equal(card.series.title,'Silicon Valley');
  assert.equal(card.series.episodeCount,5);
  assert.equal(card.series.seasonCount,2);
  const detail=buildSeries(items)[0];
  assert.deepEqual(detail.seasons.map(s=>s.title),['Season 1','Season 2','Specials']);
  assert.deepEqual(detail.seasons[0].episodes.map(e=>e.episode),[1,2,10]);
  assert.equal(detail.firstEpisode.id,'s1e1','Starting a series must begin with its first regular episode, ahead of specials.');
});
test('grouping precedes pagination, so a long series cannot occupy several pages',()=>{
  const items=Array.from({length:300},(_,i)=>episode(Math.floor(i/10)+1,i%10+1));
  items.push(episode(1,1,{id:'movie',series:undefined,sortTitle:'A movie'}));
  const page=catalog(items,{limit:1,offset:1});
  assert.equal(page.total,2);
  assert.equal(page.items[0].kind,'series');
  if(page.items[0].kind==='series')assert.equal(page.items[0].series.episodeCount,300);
  assert.equal(catalog(items,{limit:1,offset:2}).items.length,0);
});
test('series identities survive filename order, whitespace, and title casing; libraries stay distinct',()=>{
  const one=episode(1,1),two=episode(2,1,{series:'  silicon   VALLEY  '});
  const first=buildSeries([one,two]);
  const reversed=buildSeries([two,one]);
  assert.equal(first.length,1);
  assert.equal(first[0].id,reversed[0].id);
  assert.equal(first[0].title,'Silicon Valley');
  assert.equal(buildSeries([one,episode(1,1,{id:'other',libraryId:'other-library'})]).length,2);
});
test('resume chooses the latest partially watched episode and advances past completed episodes',()=>{
  const first=episode(1,1,{completed:true}),second=episode(1,2),third=episode(1,3,{position:80,progressUpdatedAt:20});
  assert.equal(buildSeries([first,second])[0].continueEpisode?.id,second.id);
  assert.equal(buildSeries([first,{...second,position:100,progressUpdatedAt:30},third])[0].continueEpisode?.id,second.id);
  assert.equal(buildSeries([{...first,completed:true},{...second,completed:true}])[0].continueEpisode,null);
  assert.equal(buildSeries([{...first,position:1000,completed:true},second])[0].firstEpisode.id,first.id);
});
test('search and favorites find a show while preserving all of its seasons and episodes',()=>{
  const items=[episode(1,1,{title:'Minimum Viable Product'}),episode(2,7,{title:'Adult Content',favorite:true})];
  for(const options of [{q:'adult content'},{q:'SILICON VALLEY'},{view:'favorites'}]){
    const result=catalog(items,{limit:20,offset:0,...options});
    assert.equal(result.total,1);
    assert.equal(result.items[0].kind,'series');
    if(result.items[0].kind==='series')assert.equal(result.items[0].series.episodeCount,2);
  }
  assert.equal(catalog(items,{q:'missing',limit:20,offset:0}).total,0);
});
test('continue watching retains individual episode progress in recency order',()=>{
  const result=catalog([episode(1,1,{position:20,progressUpdatedAt:20}),episode(2,1,{position:100,progressUpdatedAt:30}),episode(1,2,{position:100,completed:true,progressUpdatedAt:40})],{view:'continue',limit:20,offset:0});
  assert.deepEqual(result.items.map(i=>i.id),['s2e1','s1e1']);
  assert.ok(result.items.every(i=>i.kind==='media'));
});
test('missing season metadata stays explicitly unclassified instead of inventing a season',()=>{
  const series=buildSeries([episode(1,1,{season:undefined,episode:undefined})])[0];
  assert.equal(series.seasons[0].number,null);
  assert.equal(series.seasons[0].title,'Other episodes');
});

test('series summaries expose show synopsis and artwork revision, not an episode plot as the series story',()=>{
  const series=buildSeries([episode(1,1,{overview:'Episode plot',seriesOverview:'A show about a startup.',seriesYear:2014,genres:['Comedy'],artworkVersion:'poster-revision',metadataSources:[{name:'TVmaze',url:'https://www.tvmaze.com/shows/123'}]})])[0];
  assert.equal(series.overview,'A show about a startup.');assert.equal(series.year,2014);assert.deepEqual(series.genres,['Comedy']);assert.equal(series.artworkVersion,'poster-revision');assert.equal(series.seasons[0].imageMediaId,'s1e1');assert.equal(series.metadataSources?.length,1);
});
