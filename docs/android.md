# Expo Android and Android TV

Use pnpm 11.17.0 and Node 22.16+. Install JDK 17 and Android SDK platform 36, build tools, platform tools, and the NDK requested by the generated Gradle build. Set ANDROID_HOME to the SDK root. The Android SDK can be on Godseye; builds do not need a running emulator.

Godseye is the Android build/device host. Its current SDK is C:\Users\nomok\AppData\Local\Android\Sdk and Java 21 is installed; ANDROID_HOME, ANDROID_SDK_ROOT, JAVA_HOME, ADB, emulator, and SDK Manager are configured. Run Android commands there via the T3 device host or SSH rather than provisioning another build host. Java 17+ works with the current Gradle wrapper.

Use a short Windows checkout path, such as C:\k26. The native CMake prefab command failed under the longer AndroidProjects verification path. A fresh hoisted dependency layout under C:\k26 resolved the subsequent Ninja path failures: both release builds and both full lint runs passed. Set PNPM_CONFIG_NODE_LINKER=hoisted for the entire PowerShell session, including installation and every pnpm command. A one-off install override followed by commands using the default layout can restore isolated links. If reusing a failed isolated test checkout, remove only that checkout's dependency directories before reinstalling; retain shared pnpm/SDK/Gradle caches. Verify React Native and expo-modules-core realpaths no longer contain .pnpm, and app/renderer React versions both resolve to 19.2.3.

```powershell
$env:PNPM_CONFIG_NODE_LINKER = 'hoisted'
$env:CI = '1'
pnpm install --frozen-lockfile
pnpm android:phone
pnpm android:lint
pnpm android:tv
pnpm android:lint
```

On Godseye's 16 GB RAM, finish the build and stop its Gradle daemons before running one emulator at a time.

The resumed TV check was responsive with Android 36 TV at 1536 MB RAM, two cores, 1280×720/density 213, software GLES, and Vulkan disabled. Use those settings as the current TV baseline. Native login rendering is verified; the authenticated playback checks are tracked separately in [validation results](validation.md).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm android:phone
pnpm android:tv
pnpm android:lint
```

The scripts run Expo prebuild with the appropriate TV configuration, compile release APKs with embedded JavaScript, and copy them to .artifacts/apks/kathrine-phone.apk and kathrine-tv.apk. Phone builds default to arm64-v8a and x86_64. TV builds now also include armeabi-v7a for 32-bit Android TVs: the physical Hisense runs Android 12/API 31 but reports only armeabi-v7a/armeabi. Set KATHRINE_ANDROID_ARCHITECTURES=armeabi-v7a,arm64-v8a,x86_64 for both TV build and its subsequent lint run when using that variant. The override accepts only supported, unique ABIs. The universal TV 0.2.0 APK passed release/full lint and installed in place on the physical Hisense, with matching installed hash and preserved app UID. Earlier 0.1 playback checks used ARM64/x86_64 builds; physical grouping checks are tracked separately in validation. Native output in apps/mobile/android is generated and ignored. Do not maintain separate Java Activities.

For interactive development:

```sh
pnpm mobile:dev
```

Use an installed Expo development build when testing the custom decoder capability module. Expo Go can exercise UI/basic playback but cannot load the local native module. Development builds can be created by adding expo-dev-client through pnpm expo install and rebuilding; the sideload APKs do not require Expo Go or Metro.

Use T3’s device_list and device_open to attach the phone/TV emulator once device access is enabled. Install the matching APK with the returned device tooling. Enter https://ewaste.tail3123d8.ts.net with Tailscale connected, including at home. The old LAN and HTTP port 8765 addresses are disabled. Existing clients can sign out locally and reconnect with the HTTPS address. A TV can request a code which you approve from a signed-in browser or the phone’s Settings screen.

Verify touch and D-pad navigation, Back handling, keyboard entry, TV pairing, background/resume, audio/subtitle selection, seeking into a large file, and per-account watch history. Then test native playback on real hardware with 4K/8K, HDR/Dolby Vision, and the actual audio path. Emulators cannot establish Atmos or HDMI passthrough support.

React Native Paper uses Material Design 3. TV focus controls use the theme’s primary role; controls are at least 48 logical pixels high. State and navigation use actual API results, with loading and error feedback. No sample collection or fabricated device statistics are presented as live data.

Phone fullscreen uses expo-video's fullscreen orientation option to request landscape in its separate fullscreen Activity. Exiting fullscreen returns to the app Activity and its existing rotation policy. It does not change Android's auto-rotate preference or lock the rest of the app. TV retains its normal landscape policy.

Series artwork stays separate from the heading: phones place the title, year and genres below the 16:9 banner; TV places them beside it. Images use contain sizing so neither cropping nor an overlaid text panel hides the artwork. Keep authenticated array image sources when changing these layouts.
