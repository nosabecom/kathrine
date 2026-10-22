export type MediaStream = {
  index: number; codec: string; type: 'video' | 'audio' | 'subtitle'; profile?: string;
  width?: number; height?: number; frameRate?: number; bitDepth?: number;
  channels?: number; channelLayout?: string; language?: string; title?: string;
  hdr?: string; hdrFallbacks?: string[]; dolbyVisionProfile?: number; default?: boolean; forced?: boolean;
};
export type Media = {
  id: string; libraryId: string; title: string; sortTitle: string; year?: number;
  overview?: string; series?: string; season?: number; episode?: number;
  duration: number; size: number; bitrate: number; container: string; streams: MediaStream[];
  addedAt: number; available: boolean; position: number; completed: boolean; favorite: boolean; progressUpdatedAt?: number;
  seriesOverview?:string; seriesYear?:number; genres?:string[];
  metadataSources?:{name:string;url:string}[]; artworkVersion?:string;
};
export type SeriesSummary = {
  id:string; libraryId:string; title:string; imageMediaId:string; year?:number;
  seasonCount:number; episodeCount:number; completedEpisodes:number;
  overview?:string; genres?:string[]; metadataSources?:{name:string;url:string}[]; artworkVersion?:string;
};
export type SeriesSeason = { number:number|null; title:string; episodes:Media[]; imageMediaId?:string };
export type SeriesDetail = SeriesSummary & { seasons:SeriesSeason[]; firstEpisode:Media; continueEpisode:Media|null };
export type CatalogItem = { kind:'media'; id:string; media:Media } | { kind:'series'; id:string; series:SeriesSummary };
export type VideoCapability = { codec: string; maxWidth: number; maxHeight: number; maxFrameRate?: number; maxBitDepth?: number; profiles?: string[] };
export type Capabilities = {
  client: 'android' | 'browser'; device: string; containers: string[];
  video: VideoCapability[]; audio: string[]; passthrough: string[];
  hdr: string[]; maxBitrate?: number;
};
export type PlaybackPlan = {
  mode: 'direct' | 'remux' | 'audio' | 'transcode' | 'unsupported';
  reasons: string[]; warnings: string[]; videoPreserved: boolean; audioPreserved: boolean;
  audioIndex?: number; videoIndex?: number; subtitleIndex?: number;
};
export type Library = { id: string; name: string; path: string; kind: 'movies' | 'shows' | 'mixed'; count: number };
export type User = { id: string; username: string; admin: boolean };
export type ScanStatus = { running: boolean; scanned: number; added: number; errors: string[]; startedAt: number | null; finishedAt: number | null };
