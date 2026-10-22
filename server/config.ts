import { resolve } from 'node:path';
export const config = {
  host: process.env.KATHRINE_HOST || '127.0.0.1',
  port: Number(process.env.KATHRINE_PORT || 8765),
  dataDir: resolve(process.env.KATHRINE_DATA || '.data'),
  webDir: resolve('dist/web'),
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  metadataEnabled: process.env.KATHRINE_METADATA !== 'false',
  secureCookie: process.env.KATHRINE_HTTPS === 'true',
  allowVideoTranscode: process.env.KATHRINE_VIDEO_TRANSCODE === 'true',
  maxConversions: Number(process.env.KATHRINE_MAX_CONVERSIONS || 1),
  cacheLimit: Number(process.env.KATHRINE_CACHE_GB || 32) * 1024 ** 3,
};
