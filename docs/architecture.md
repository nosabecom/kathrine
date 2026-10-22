# Kathrine

Kathrine is an independent personal media server with an Expo Android phone app, an Expo Android TV app, and a browser library/player. The server never depends on Jellyfin APIs or its database. Existing media and NFO/poster sidecars can be reused in place.

The user subsequently removed Jellyfin, jellyfin-ffmpeg8 and the Caddy proxy from Ewaste. System /usr/bin/ffmpeg and /usr/bin/ffprobe remain installed. qBittorrent and its private Tailscale /qb route remain in use. Media still lives under /home/nosa/jellyfin/movies, tvshows and downloads; these paths, sidecars and retained legacy data are independent of the removed application and must be preserved. Runtime checks must not expect or restore the removed services.

## Playback

1. Probe files with FFprobe, once per file modification. Store streams, HDR indicators, profiles, frame rates, channels, durations, and bitrate in SQLite.
2. The Expo app asks a local Expo module about the Android decoder’s support for the particular file’s resolution, frame rate, and bit depth. It checks the display’s HDR modes and Android’s direct audio-output support. The browser uses MediaCapabilities and canPlayType.
3. If compatible, serve the original file with authenticated HTTP byte ranges, stream backpressure, and seek offsets beyond 4 GB. The server does not decode or re-encode it. This path has no artificial 4K/8K cap and preserves original HDR and object-audio data in the source.
4. With the viewer’s explicit permission, FFmpeg can remux streams into fragmented MP4 HLS or copy video while converting unsupported audio to AAC stereo. Compressed video packets remain identical in the audio-only path. This removes Atmos/DTS:X metadata from converted audio, which the UI states before proceeding.
5. Video conversion is disabled on Ewaste by default. Setting KATHRINE_VIDEO_TRANSCODE=true permits explicitly requested software conversion to at most 1080p H.264 SDR, with HDR tone mapping. This is a fallback; Ewaste cannot be assumed to convert 4K/8K in real time.

The source device, decoder profile, HDR implementation, audio output/receiver, disk speed, and network still matter. No app can make an unsupported decoder decode 8K, create Atmos support in a soundbar that lacks it, or stream faster than a home connection’s upload speed. The Samsung HW-B550 lists Dolby 2-channel audio, DTS Virtual:X, and no 4K video passthrough. Connect a video player to the TV, then send audio to the bar over ARC or optical; original Atmos remains available for compatible equipment.

## Server

Ewaste binds Kathrine only to 127.0.0.1:8765. The canonical connection address is https://ewaste.tail3123d8.ts.net, served privately by Tailscale Serve on 443. The existing /qb proxy remains independent. LAN port 8765 is closed, Funnel is disabled for this endpoint, and no public-domain/port-forwarding change is part of this deployment. KATHRINE_HTTPS=true enables Secure browser cookies; native clients continue using their existing bearer authentication over HTTPS. Tailscale is required on connecting devices even at home.

Node 22.16+ (native SQLite), Fastify, FFprobe, and FFmpeg. Scans and thumbnail extraction are sequential to limit pressure on the A10 server. Scans run at startup and every 30 minutes; unreadable/offline roots retain their previous entries. Existing local posters avoid expensive frame extraction. Library files are read-only. Symlinks are checked against the library boundary and are not followed during scans.

The catalog groups episode metadata by library and normalized series name before pagination, search, or favorites. Series screens order regular seasons and episode numbers, then Specials and unclassified episodes. Per-user continuation selects the latest partially watched episode or the first unwatched episode. Start from beginning opens the first regular episode at zero without clearing other history. Continue watching retains individual episodes. The legacy /api/media endpoint remains compatible with earlier clients.

Local episode/movie NFO files, ancestor tvshow.nfo, folder/poster artwork, backdrops/landscapes, season posters and episode thumbnails are reused in place. Missing TV information and original artwork are fetched through TVmaze; missing films use Cinemeta with exact title/year matching. Ambiguous matches stay unassigned. Metadata responses and validated image downloads are cached under the private data directory; clients receive authenticated server image URLs, never forwarding bearer headers to image providers. Provider attribution appears in details and Settings. Enrichment runs automatically during scans and preserves media IDs, progress, source files and existing correct metadata. Set KATHRINE_METADATA=false to disable internet lookup while retaining local metadata/artwork.

SQLite persists accounts, hashed sessions, libraries, media metadata, per-user progress, favorites, and expiring pairing approvals. Passwords use salted scrypt. Browser sessions use HttpOnly SameSite=Strict cookies; native apps use bearer headers with credentials held in Expo SecureStore. Setup requires a private bootstrap code on disk. TV pairing requires authenticated approval and a separate secret poll token, expires in 10 minutes, and is consumed once.

Compatibility jobs are limited to one on Ewaste, read ahead at up to 1.5 times playback speed, stop on explicit close, expire after inactivity, and have a 32 GB disk budget. Conversion segments are generated ahead into an event playlist; seeking is limited to the prepared window. Sources whose converted output exceeds the configured budget require a larger cache or original playback. This does not affect original-file seeking. Retained conversion work is not a permanent optimized media copy.

## Android

Expo SDK 57 with its matching React Native TV 0.86 fork supports both Android phones and TVs. React Native Paper supplies Material Design 3 components, theme roles, type scale, app bars, bottom navigation, cards, dialogs, fields, and buttons. TV uses a navigation rail, D-pad focus borders, and larger controls. expo-video provides native ExoPlayer playback, track selection, system controls, buffering, and background playback. A local Expo module inspects hardware rather than inventing capabilities from a phone/TV model name.

Generated native projects are not source. app.config.ts and local Expo modules are source. Builds bundle JavaScript into APKs so Metro is not required for playback. Builds currently use local debug signing for sideload testing; store distribution and managed signing are not configured.

## Boundaries still requiring real devices

Building APKs and exercising the server do not certify physical 4K/8K decoding, Dolby Vision profile handling, HDMI bitstream passthrough, or soundbar output. T3 device access was disabled during initial setup. Test these with the actual phone, TV/box, and audio connection when Godseye’s device host is ready.

This initial release does not provide commercial streaming DRM, Chromecast control, downloads/offline sync, live TV/DVR, parental controls, or app-store distribution. It imports existing local NFO artwork and supports original-file and compatibility playback. Those product features need separate implementation and validation.
