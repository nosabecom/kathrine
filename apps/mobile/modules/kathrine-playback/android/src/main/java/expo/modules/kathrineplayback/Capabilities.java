package expo.modules.kathrineplayback;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.view.Display;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

public final class Capabilities {
    public static JSONObject inspect(Context context,JSONObject media) throws Exception {
        JSONArray videos=new JSONArray(),audio=new JSONArray(),pass=new JSONArray(),hdr=new JSONArray();
        Map<String,String> types=new HashMap<>();types.put("h264","video/avc");types.put("hevc","video/hevc");types.put("av1","video/av01");types.put("vp9","video/x-vnd.on2.vp9");types.put("vp8","video/x-vnd.on2.vp8");types.put("mpeg2video","video/mpeg2");types.put("mpeg4","video/mp4v-es");
        MediaCodecInfo[] codecs=new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos();
        JSONArray streams=media.getJSONArray("streams");
        for(int n=0;n<streams.length();n++){
            JSONObject stream=streams.getJSONObject(n);if(!stream.optString("type").equals("video"))continue;
            String codec=stream.optString("codec"),mime=types.get(codec);if(mime==null)continue;
            int width=stream.optInt("width"),height=stream.optInt("height"),depth=stream.optInt("bitDepth",8);double rate=stream.optDouble("frameRate",24);
            boolean supported=false;
            for(MediaCodecInfo info:codecs){
                if(info.isEncoder())continue;
                if(Build.VERSION.SDK_INT>=29&&!info.isHardwareAccelerated()&&(width>=3840||height>=2160))continue;
                try{
                    MediaCodecInfo.CodecCapabilities capability=info.getCapabilitiesForType(mime);
                    var video=capability.getVideoCapabilities();if(video==null||!video.areSizeAndRateSupported(width,height,rate))continue;
                    boolean depthOk=depth<=8;
                    for(var profile:capability.profileLevels){
                        if(codec.equals("hevc")&&(profile.profile==MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10||profile.profile==MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10||profile.profile==MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus))depthOk=depth<=10;
                        if(codec.equals("av1")&&profile.profile!=MediaCodecInfo.CodecProfileLevel.AV1ProfileMain8)depthOk=depth<=10;
                        if(codec.equals("vp9")&&(profile.profile==MediaCodecInfo.CodecProfileLevel.VP9Profile2||profile.profile==MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR||profile.profile==MediaCodecInfo.CodecProfileLevel.VP9Profile2HDR10Plus))depthOk=depth<=10;
                    }
                    if(depthOk){supported=true;break;}
                }catch(IllegalArgumentException ignored){/*Codec does not handle this MIME.*/}
            }
            if(supported)videos.put(new JSONObject().put("codec",codec).put("maxWidth",width).put("maxHeight",height).put("maxBitDepth",depth).put("maxFrameRate",rate));
        }
        Map<String,String> audioTypes=new HashMap<>();audioTypes.put("aac","audio/mp4a-latm");audioTypes.put("mp3","audio/mpeg");audioTypes.put("opus","audio/opus");audioTypes.put("vorbis","audio/vorbis");audioTypes.put("flac","audio/flac");audioTypes.put("ac3","audio/ac3");audioTypes.put("eac3","audio/eac3");audioTypes.put("truehd","audio/true-hd");audioTypes.put("dts","audio/vnd.dts");audioTypes.put("alac","audio/alac");
        for(var type:audioTypes.entrySet()){
            boolean supported=false;
            for(var info:codecs){if(info.isEncoder())continue;try{info.getCapabilitiesForType(type.getValue());supported=true;break;}catch(IllegalArgumentException ignored){}}
            if(supported)audio.put(type.getKey());
        }
        Map<String,Integer> encodings=new HashMap<>();encodings.put("ac3",AudioFormat.ENCODING_AC3);encodings.put("eac3",AudioFormat.ENCODING_E_AC3);encodings.put("truehd",AudioFormat.ENCODING_DOLBY_TRUEHD);encodings.put("dts",AudioFormat.ENCODING_DTS);
        AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build();
        if(Build.VERSION.SDK_INT>=29)for(var encoding:encodings.entrySet()){
            for(int channels:new int[]{AudioFormat.CHANNEL_OUT_5POINT1,AudioFormat.CHANNEL_OUT_7POINT1_SURROUND})try{
                AudioFormat format=new AudioFormat.Builder().setEncoding(encoding.getValue()).setSampleRate(48000).setChannelMask(channels).build();
                if(AudioTrack.isDirectPlaybackSupported(format,attributes)){pass.put(encoding.getKey());break;}
            }catch(IllegalArgumentException ignored){}
        }
        Display display=((android.app.Activity)context).getWindowManager().getDefaultDisplay();if(display!=null)for(int type:display.getHdrCapabilities().getSupportedHdrTypes()){
            if(type==Display.HdrCapabilities.HDR_TYPE_HDR10||type==Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS)hdr.put("hdr10");
            if(type==Display.HdrCapabilities.HDR_TYPE_HLG)hdr.put("hlg");
            if(type==Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION)hdr.put("dolby-vision");
        }
        return new JSONObject().put("client","android").put("device",Build.MANUFACTURER+" "+Build.MODEL).put("containers",new JSONArray(java.util.Arrays.asList("mkv","mp4","webm","ts","mpg","mpeg"))).put("video",videos).put("audio",audio).put("passthrough",pass).put("hdr",hdr);
    }
}
