import { createHash } from 'node:crypto';
import type { CatalogItem, Media, SeriesDetail, SeriesSeason, SeriesSummary } from '../shared/types.js';

const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const seriesTitle=(media:Media)=>media.series?.normalize('NFC').trim().replace(/\s+/g,' ')||'';
const seasonNumber=(media:Media)=>Number.isInteger(media.season)&&media.season! >= 0?media.season!:null;
const seasonOrder=(value:number|null)=>value===null?Number.MAX_SAFE_INTEGER:value===0?Number.MAX_SAFE_INTEGER-1:value;
export function compareEpisodes(a:Media,b:Media) {
  return seasonOrder(seasonNumber(a))-seasonOrder(seasonNumber(b))
    || (a.episode??Number.MAX_SAFE_INTEGER)-(b.episode??Number.MAX_SAFE_INTEGER)
    || collator.compare(a.sortTitle||a.title,b.sortTitle||b.title) || a.id.localeCompare(b.id);
}
export function buildSeries(items:Media[]):SeriesDetail[] {
  const groups=new Map<string,Media[]>();
  for(const item of items) {
    const title=seriesTitle(item);if(!title)continue;
    const key=JSON.stringify([item.libraryId,title.toLocaleLowerCase('en')]);
    const group=groups.get(key)||[];group.push(item);groups.set(key,group);
  }
  return [...groups].map(([key,episodes])=>{
    episodes.sort(compareEpisodes);
    const firstEpisode=episodes[0];
    const seasons:SeriesSeason[]=[];
    for(const episode of episodes) {
      const number=seasonNumber(episode);
      let season=seasons.find(s=>s.number===number);
      if(!season){season={number,title:number===null?'Other episodes':number===0?'Specials':`Season ${number}`,episodes:[],imageMediaId:episode.id};seasons.push(season);}
      season.episodes.push(episode);
    }
    const inProgress=episodes.filter(m=>!m.completed&&m.position>0).sort((a,b)=>(b.progressUpdatedAt||0)-(a.progressUpdatedAt||0)||compareEpisodes(a,b));
    const continueEpisode=inProgress[0]||episodes.find(m=>!m.completed)||null;
    return {id:'series-'+createHash('sha256').update(key).digest('hex').slice(0,32),libraryId:firstEpisode.libraryId,title:seriesTitle(firstEpisode),imageMediaId:firstEpisode.id,overview:episodes.find(m=>m.seriesOverview)?.seriesOverview,genres:episodes.find(m=>m.genres?.length)?.genres,metadataSources:[...new Map(episodes.flatMap(m=>m.metadataSources||[]).map(s=>[s.url,s])).values()],artworkVersion:firstEpisode.artworkVersion,year:firstEpisode.seriesYear||episodes.map(m=>m.year).filter((y):y is number=>!!y).sort((a,b)=>a-b)[0],seasonCount:seasons.filter(s=>s.number!==null&&s.number>0).length,episodeCount:episodes.length,completedEpisodes:episodes.filter(m=>m.completed).length,seasons,firstEpisode,continueEpisode};
  }).sort((a,b)=>collator.compare(a.title,b.title)||a.id.localeCompare(b.id));
}
export function seriesSummary({seasons,firstEpisode,continueEpisode,...summary}:SeriesDetail):SeriesSummary {return summary;}
export function catalog(items:Media[],options:{view?:string;q?:string;limit:number;offset:number}) {
  const query=options.q?.trim().toLocaleLowerCase('en')||'';
  const matches=(media:Media)=>[media.title,media.series||''].some(s=>s.toLocaleLowerCase('en').includes(query));
  if(options.view==='continue') {
    const media=items.filter(m=>!m.completed&&m.position>0&&matches(m)).sort((a,b)=>(b.progressUpdatedAt||0)-(a.progressUpdatedAt||0)||compareEpisodes(a,b));
    return {items:media.slice(options.offset,options.offset+options.limit).map(m=>({kind:'media' as const,id:m.id,media:m})),total:media.length};
  }
  const entries:CatalogItem[]=[];
  for(const media of items)if(!seriesTitle(media)&&matches(media)&&(options.view!=='favorites'||media.favorite))entries.push({kind:'media',id:media.id,media});
  for(const series of buildSeries(items)) {
    const episodes=series.seasons.flatMap(s=>s.episodes);
    if(!episodes.some(matches))continue;
    if(options.view==='favorites'&&!episodes.some(m=>m.favorite))continue;
    entries.push({kind:'series',id:series.id,series:seriesSummary(series)});
  }
  entries.sort((a,b)=>collator.compare(a.kind==='series'?a.series.title:a.media.sortTitle,b.kind==='series'?b.series.title:b.media.sortTitle)||a.id.localeCompare(b.id));
  return {items:entries.slice(options.offset,options.offset+options.limit),total:entries.length};
}
