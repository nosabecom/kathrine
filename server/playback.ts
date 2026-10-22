import type { Capabilities, Media, MediaStream, PlaybackPlan } from '../shared/types.js';
import { z } from 'zod';
export const capabilitySchema = z.object({
  client:z.enum(['android','browser']), device:z.string().max(200),
  containers:z.array(z.string().max(30)).max(40),
  video:z.array(z.object({codec:z.string().max(40),maxWidth:z.number().nonnegative().max(32768),maxHeight:z.number().nonnegative().max(32768),maxFrameRate:z.number().nonnegative().optional(),maxBitDepth:z.number().optional(),profiles:z.array(z.string()).optional()})).max(40),
  audio:z.array(z.string().max(40)).max(40), passthrough:z.array(z.string().max(40)).max(40),
  hdr:z.array(z.string().max(40)).max(20),maxBitrate:z.number().positive().optional(),
});
export function negotiate(media: Media, caps: Capabilities, options: { audioIndex?:number; allowCompatibility?:boolean; allowVideoTranscode?:boolean } = {}): PlaybackPlan {
  const videos = media.streams.filter(s=>s.type==='video');
  const video = videos.find(s=>s.default) || videos[0];
  const audios = media.streams.filter(s=>s.type==='audio');
  const preferred = audios.find(s=>s.default) || audios[0];
  const audio = options.audioIndex===undefined ? preferred : audios.find(s=>s.index===options.audioIndex);
  if(options.audioIndex!==undefined && !audio) throw Object.assign(new Error('That audio track does not exist.'),{statusCode:400});
  const plan: PlaybackPlan = { mode:'direct', reasons:[], warnings:[], videoPreserved:true,audioPreserved:true,audioIndex:audio?.index,videoIndex:video?.index };
  if(!video) return {...plan,mode:'unsupported',reasons:['No video stream was found.']};
  const videoOk = caps.video.some(c=> c.codec===video.codec && c.maxWidth >= (video.width||0) && c.maxHeight >= (video.height||0) && (!c.maxFrameRate || c.maxFrameRate >= (video.frameRate||0)) && (c.maxBitDepth||8) >= (video.bitDepth||8) && (!c.profiles?.length || !video.profile || c.profiles.includes(video.profile)));
  const hdrFallback = video.hdrFallbacks?.find(format=>format==='sdr'||caps.hdr.includes(format));
  const hdrOk = !video.hdr || caps.hdr.includes(video.hdr) || !!hdrFallback;
  if(video.hdr && !caps.hdr.includes(video.hdr) && hdrFallback) plan.warnings.push(`This device can render the ${hdrFallback.toUpperCase()} compatible base layer. Dolby Vision enhancement metadata will not be rendered; the original video is preserved.`);
  if(!videoOk) plan.reasons.push(`The device did not report a decoder for ${video.codec.toUpperCase()} ${video.width}×${video.height} ${video.bitDepth || 8}-bit at ${Math.round(video.frameRate||0)} fps.`);
  if(!hdrOk) plan.reasons.push(`The device did not report ${video.hdr} display support.`);
  if(caps.maxBitrate && media.bitrate > caps.maxBitrate) plan.warnings.push(`Source bitrate is ${(media.bitrate/1e6).toFixed(1)} Mb/s, above your ${(caps.maxBitrate/1e6).toFixed(1)} Mb/s network limit. Test the connection or explicitly choose a smaller version.`);
  if(!videoOk || !hdrOk) {
    plan.mode = options.allowCompatibility && options.allowVideoTranscode ? 'transcode' : 'unsupported';
    plan.videoPreserved=false;
    if(plan.mode==='transcode') plan.warnings.push('Video will be converted to 1080p SDR H.264. This uses the server CPU and may not run in real time.');
  }
  const audioOk = !audio || caps.audio.includes(audio.codec) || caps.passthrough.includes(audio.codec);
  if(audio && !audioOk) {
    plan.reasons.push(`The device/output did not report ${audio.codec.toUpperCase()} audio support.`);
    plan.audioPreserved=false;
    plan.warnings.push('AAC stereo conversion removes Atmos/DTS:X metadata and multichannel audio.');
    if(plan.mode!=='unsupported' && plan.mode!=='transcode') plan.mode = options.allowCompatibility ? 'audio' : 'unsupported';
  }
  if(plan.mode==='transcode') plan.audioPreserved=!audio ? true : false;
  if(plan.mode==='direct' && !caps.containers.includes(media.container)) {
    plan.reasons.push(`The device cannot open ${media.container.toUpperCase()} directly.`);
    plan.mode = options.allowCompatibility ? 'remux' : 'unsupported';
  }
  if(plan.mode==='direct' && caps.client==='browser' && options.audioIndex!==undefined && options.audioIndex!==preferred?.index) {
    plan.reasons.push('This browser needs a separate stream to select that audio track.');
    plan.mode=options.allowCompatibility?'remux':'unsupported';
  }
  // The compatibility output is fragmented MP4 HLS; reject codec/container combinations FFmpeg cannot safely mux.
  if(['remux','audio'].includes(plan.mode) && !['h264','hevc','av1'].includes(video.codec)) {
    plan.mode='unsupported'; plan.reasons.push('This video codec cannot be copied into the compatibility stream. Use the native Android player.');
  }
  if(['remux','transcode'].includes(plan.mode) && audio && !['aac','ac3','eac3','mp3','alac'].includes(audio.codec)) {
    plan.audioPreserved=false;
    plan.warnings.push('The compatibility container requires AAC stereo audio; object audio metadata will be lost.');
    if(plan.mode==='remux') plan.mode='audio';
  }
  if(plan.mode==='direct') plan.reasons.push('Original file, original video, original audio. Decoding happens on your device.');
  return plan;
}
export function audioLabel(stream?: MediaStream) { return stream ? `${stream.codec.toUpperCase()} · ${stream.channels||2} channels` : 'No audio'; }

export function parseRange(header: string | undefined, size: number): {start:number;end:number;partial:boolean} | null {
  if(!header) return {start:0,end:size-1,partial:false};
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match || (!match[1]&&!match[2]) || size===0) return null;
  let start:number, end:number;
  if(!match[1]) { const suffix=Number(match[2]); if(!Number.isSafeInteger(suffix)||suffix<=0) return null; start=Math.max(0,size-suffix); end=size-1; }
  else { start=Number(match[1]); end=match[2]?Number(match[2]):size-1; }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start) return null;
  return {start,end:Math.min(end,size-1),partial:true};
}
