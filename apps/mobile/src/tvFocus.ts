import type { CatalogItem, Media } from '../../../shared/types';

// Shelf and grid cards can refer to the same media; choose exactly one target.
export function libraryFocusTarget(items:CatalogItem[],continuing:Media[],previous?:string):string|undefined {
  if(previous){
    if(continuing.some(media=>media.id===previous))return `continue:${previous}`;
    const item=items.find(item=>item.id===previous||(item.kind==='media'?item.media.id:item.series.id)===previous);
    if(item)return `catalog:${item.id}`;
  }
  if(continuing.length)return `continue:${continuing[0].id}`;
  if(items.length)return `catalog:${items[0].id}`;
}
