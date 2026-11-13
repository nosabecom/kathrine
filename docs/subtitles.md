# English subtitle sourcing

Kathrine can download English subtitles from SubDL and play separate `.srt` or `.vtt` files alongside existing media. Downloaded captions are stored in Kathrine's private database, keyed to the media file's size and modification time. Video, audio, HDR/Dolby Vision, Atmos, original embedded tracks, artwork and NFO files are never rewritten by this feature.

## Release and setup

Nosa released the maintenance hold on 2026-11-13. The server/web update is deployed, the Hisense received Android 0.4.1/code 6 in place, and both APKs are published. Physical subtitle rendering and the phone installation remain separate verification steps. See the release results below.

When releasing, obtain a personal key from [SubDL](https://subdl.com/panel/api) and set these values in Ewaste's private `~/kathrine-data/server.env`:

```dotenv
KATHRINE_SUBDL_API_KEY=<personal-key>
KATHRINE_SUBTITLES_AUTO=true
```

Never commit the key or environment file. The server alone contacts SubDL; the key never appears in browser/native manifests, database subtitle content, client bundles or error responses. Without a key, local/embedded subtitles still work and provider jobs remain disabled. Setting `KATHRINE_SUBTITLES_AUTO=false` leaves only owner-triggered searches enabled. A restart is needed to change environment settings; coordinate a viewing interruption before restarting.

The owner can use **Settings → Subtitles → Audit subtitles** and **Find English subtitles** in the web app, or **Find English subtitles** in the Android player's Subtitles dialog. A search does not reload an active player. Reopen the title to see newly downloaded tracks, and select the desired subtitle yourself. Android and browser menus display descriptive track names, including the original/corrected track names used for Succession S02E05.

## Matching and maintenance

The [SubDL API](https://subdl.com/developers) is searched by title, filename, media type and season/episode. The first returned title must match; known title years and frame rates must agree. A subtitle must match the complete release name, or share both the release group and source, without a conflicting service (such as MAX versus AMZN). Season packs require the exact individual episode; contradictory episode names are rejected. Loose title-only matches and forced-only tracks are not selected automatically.

Downloaded text has a 2 MiB limit. HTML, archives, malformed/reversed timestamps, badly mismatched durations and obviously partial full-English tracks are rejected. Downloads are limited to HTTPS on `dl.subdl.com`, without redirects or forwarded account credentials. SubDL search responses may append an `api_key` query parameter; it is discarded before validation, storage and the credential-free download. Other query parameters remain rejected. Source media changes invalidate the cache and require a library scan. These are conservative checks, **not proof of dialogue accuracy or synchronization**. Tracks without a safe match remain unmatched for manual investigation; no transcription or quality conversion runs in the background.

With automatic sourcing enabled, a job runs every 30 minutes after the regular library scan interval. Each batch attempts at most 20 uncached titles, including files that already have embedded English (an embedded track may be wrong). Failed or unmatched titles are retried at most daily per media version. Provider quota responses stop the batch and apply the provider cooldown. Recently streamed titles and titles with recent saved progress are skipped by unattended jobs. Jobs fetch subtitle text and stat media files; they do not read/convert complete videos. Provider quotas still apply, so initial library coverage can take multiple batches/days.

## Local subtitle files and playback

Place text subtitles beside a video using its exact stem, e.g. `Example.S02E05.mkv` with `Example.S02E05.en.srt`. Additional suffixes such as `.en.sdh.srt` work. The sidecar must remain inside its library, fit the size limit and parse as readable text. Subtitle paths are resolved on the server; clients receive authenticated URLs, never filesystem paths. Compatibility playback subtracts its resume offset from both local and downloaded subtitles.

The Android `expo-video@57.0.5` dependency has a versioned pnpm patch adding `VideoSource.subtitleTracks` and `VideoView.subtitleStyle`. Media3 loads external VTT with the existing source's authentication headers. Styles apply to native text subtitles, including phone fullscreen; explicit source cue positions are replaced with the user's requested position. Original video/audio playback is unchanged. Images/PGS and burned-in captions cannot be recolored as text. The browser supports text captions; native-capable players can still select image subtitles.

Keep the dependency patch pinned/reviewed when upgrading Expo. The mobile package opts `expo-video` into Android `buildFromSource`; Expo's prebuilt AAR would otherwise bypass the patch. Native changes require rebuilding both APKs through `pnpm android:build`; do not edit generated Android projects.

## Audit limits and initial findings

The initial read-only inventory on 2026-11-13 found 127 available films/episodes: 88 with embedded English text, 38 with English image tracks (Silicon Valley), and Margin Call with no embedded subtitles or matching local sidecar. Succession season 2 has repeated subtitle stream statistics across episodes 1/2, 6/7/8 and 9/10; those are suspicious and need content-level investigation. S02E05's English tracks were confirmed to contain episode 7 dialogue and were repaired separately before this feature was built.

The owner audit endpoint reports missing English, browser text needs, cached downloads and unavailable/changed files. It does not listen to every film or prove words/timing correct, and it does not label image subtitles as broken. Physical-device and real-provider validation must be reported separately from build and mocked-provider tests.

## Combined build and release (2026-11-13)

The combined 0.4.1/code 6 candidate includes the TV focus fixes, appearance preferences and external subtitle integration. Local TypeScript checks, 82 tests, the server/web build and 62 isolated Ewaste tests passed. On Godseye, the Windows TypeScript check, both release builds (`pnpm android:build`) and full TV lint passed. The source build executed `:expo-video:compileReleaseKotlin`; both downloaded APKs also contain the added `ExternalSubtitle` and `SubtitleStyle` classes. The appearance helper is named `subtitleAppearancePreferences.ts` to avoid case-insensitive Windows module resolution conflicts with the editor component.

Staged APK SHA-256:

- Phone: `4f36d9f3e502d88bd882f284313e8777dfff38a45681d23bf1eff38567c8436c`
- TV: `973f4a9b997ed3fc7e3bdcef80b55a969e56fb20bb51074ec1463aee372525cb`

Both use the installed app certificate `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. The unchanged retained 0.4.0 TV reference (`d6353e5f0e20e71f150529fb7ff2a5d0d3221394dcafb6756cfd306c034ef119`) provides the canonical certificate comparison. No signing key was changed or exported.

Candidates remain under `C:\ksub\.artifacts\apks` on Godseye and `.artifacts/subtitle-build/apks` in the workspace. Local artifact metadata records APK hashes, native-class presence, source hashes and selected actual terminal stdout. `android-build.log` is only a PowerShell transcript header/footer; it is **not** a full Gradle log. The native compilation/build/lint excerpts are retained separately as `native-build-evidence.txt`.

The authorized release published both APKs; complete HTTPS downloads matched the hashes above. The physical Hisense updated from code 5 to code 6 using `install -r`, retained UID 10118, and its installed base APK matched the TV hash. No app launch, remote input, screenshot, playback or power command was issued. The phone APK is published but no physical phone was attached. The dedicated ADB 5051 server was stopped after installation.

Live provider validation found credential-bearing URLs in otherwise matching SubDL results. A server-only correction strips the credential before selecting/downloading a raw subtitle; a regression test covers this response shape. The first key was removed from server configuration after a raw diagnostic exposed it; replacement-key setup is pending. Automatic sourcing remains disabled until that setup and a real download pass. The library audit covers 127 files, with one missing English and 39 needing browser-readable text before provider downloads. This audit does not prove dialogue accuracy.

Build checks do not establish actual HDR/Atmos output or subtitle appearance on a physical TV. The user should reopen Kathrine and select the desired subtitle; S02E05 retains its separately repaired **English (corrected - Tern Haven)** track.
