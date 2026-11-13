export const subtitleSizes={small:20,medium:24,large:28,extraLarge:34} as const;
export const subtitleColors={white:'#FFFFFF',yellow:'#FFE36E',cyan:'#89E8FF',green:'#A4F4AE',pink:'#FFC1E0'} as const;
export const subtitleBackgrounds={black:'#000000',navy:'#101827',white:'#FFFFFF'} as const;
export const subtitlePositions={bottom:.08,raised:.18,middle:.42,top:.75} as const;

export type SubtitleAppearance={
  size:keyof typeof subtitleSizes;
  color:keyof typeof subtitleColors;
  textOpacity:number;
  background:keyof typeof subtitleBackgrounds;
  backgroundOpacity:number;
  edge:'none'|'outline'|'dropShadow';
  position:keyof typeof subtitlePositions;
};
export type NativeSubtitleStyle={fontSize:number;foregroundColor:string;backgroundColor:string;windowColor:string;edgeColor:string;edgeType:SubtitleAppearance['edge'];bottomPaddingFraction:number};

export const defaultSubtitleAppearance:Readonly<SubtitleAppearance>=Object.freeze({size:'medium',color:'white',textOpacity:1,background:'black',backgroundOpacity:0,edge:'dropShadow',position:'bottom'});
export const subtitlePresets=[
  {id:'cinema',title:'Cinema',description:'White text with a soft shadow. Inspired by Netflix.',appearance:{...defaultSubtitleAppearance}},
  {id:'glass',title:'Soft glass',description:'A translucent background behind every line.',appearance:{...defaultSubtitleAppearance,backgroundOpacity:.5}},
  {id:'contrast',title:'High contrast',description:'Larger yellow text on a dark background.',appearance:{...defaultSubtitleAppearance,size:'large',color:'yellow',backgroundOpacity:.85,edge:'outline'}},
] satisfies {id:string;title:string;description:string;appearance:SubtitleAppearance}[];

function choice<T extends string>(value:unknown,choices:Record<T,unknown>,fallback:T):T{
  return typeof value==='string'&&Object.hasOwn(choices,value)?value as T:fallback;
}
function opacity(value:unknown,fallback:number,min=0){return typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(1,value)):fallback;}
export function normalizeSubtitleAppearance(value:unknown):SubtitleAppearance{
  const input=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return {
    size:choice(input.size,subtitleSizes,defaultSubtitleAppearance.size),
    color:choice(input.color,subtitleColors,defaultSubtitleAppearance.color),
    textOpacity:opacity(input.textOpacity,defaultSubtitleAppearance.textOpacity,.35),
    background:choice(input.background,subtitleBackgrounds,defaultSubtitleAppearance.background),
    backgroundOpacity:opacity(input.backgroundOpacity,defaultSubtitleAppearance.backgroundOpacity),
    edge:choice(input.edge,{none:true,outline:true,dropShadow:true},defaultSubtitleAppearance.edge),
    position:choice(input.position,subtitlePositions,defaultSubtitleAppearance.position),
  };
}

// Android Color.parseColor uses AARRGGBB, while React Native styles use RRGGBBAA.
export function subtitleColor(hex:string,alpha:number){return '#'+Math.round(Math.max(0,Math.min(1,alpha))*255).toString(16).padStart(2,'0').toUpperCase()+hex.slice(1);}
export function subtitlePreviewColor(argb:string){return '#'+argb.slice(3)+argb.slice(1,3);}
export function nativeSubtitleStyle(value:SubtitleAppearance):NativeSubtitleStyle{
  const appearance=normalizeSubtitleAppearance(value);
  return {fontSize:subtitleSizes[appearance.size],foregroundColor:subtitleColor(subtitleColors[appearance.color],appearance.textOpacity),backgroundColor:subtitleColor(subtitleBackgrounds[appearance.background],appearance.backgroundOpacity),windowColor:'#00000000',edgeColor:'#FF000000',edgeType:appearance.edge,bottomPaddingFraction:subtitlePositions[appearance.position]};
}

export type SubtitleAppearanceStorage={read:()=>Promise<string|null>;write:(value:string)=>Promise<void>};
type Snapshot={appearance:SubtitleAppearance;loaded:boolean;saving:boolean;error:string|null};
export class SubtitleAppearanceStore{
  private snapshot:Snapshot={appearance:{...defaultSubtitleAppearance},loaded:false,saving:false,error:null};
  private listeners=new Set<()=>void>();
  private loading:Promise<void>|undefined;
  private writes:Promise<void>=Promise.resolve();
  private pending=0;
  private revision=0;
  constructor(private storage:SubtitleAppearanceStorage){}
  getSnapshot=()=>this.snapshot;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(patch:Partial<Snapshot>){this.snapshot={...this.snapshot,...patch};for(const listener of this.listeners)listener();}
  load=()=>this.loading??=(async()=>{
    try{
      const raw=await this.storage.read();
      let appearance={...defaultSubtitleAppearance};
      if(raw){try{const stored=JSON.parse(raw);if(stored?.version===1)appearance=normalizeSubtitleAppearance(stored.appearance);}catch{/* Corrupt preferences fall back to readable captions. */}}
      this.publish({appearance,loaded:true});
    }catch{this.publish({loaded:true,error:'Your saved subtitle style could not be loaded. You can choose a new one.'});}
  })();
  update=async(patch:Partial<SubtitleAppearance>)=>{
    await this.load();
    const appearance=normalizeSubtitleAppearance({...this.snapshot.appearance,...patch}),revision=++this.revision;
    this.pending++;this.publish({appearance,saving:true,error:null});
    const write=this.writes.then(()=>this.storage.write(JSON.stringify({version:1,appearance})));
    this.writes=write.catch(()=>{});
    try{await write;}catch{
      if(revision===this.revision)this.publish({error:'This style is previewed but could not be saved. Choose it again to retry.'});
      throw new Error('Could not save subtitle appearance.');
    }finally{this.pending--;this.publish({saving:this.pending>0});}
  };
  reset=()=>this.update({...defaultSubtitleAppearance});
}
