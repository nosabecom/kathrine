# Hisense home screen

The downstairs Hisense (lushan, Android 12/API 31, firmware STT2.230929.001.102) uses the source-built [CleanYourTV](https://github.com/Gathin23/cleanyourtv) launcher 2.7/code 8. The audited source is commit `86a69372f9886ab6392ad2c3cf95f9a0e1c54644`.

The four-app dock is Netflix, Prime Video, Disney+, YouTube. YouTube was selected from the TV's usage records. Kathrine and every other installed streaming app remain available below the dock. Hold OK on a tile to move it or remove it from Home; App library can add it back. Removing a tile does not disable or uninstall its app.

The reproducible baseline is [config.json](../deploy/cleanyourtv/config.json); the narrow cleanup list is [debloat.txt](../deploy/cleanyourtv/debloat.txt). Cleanup disables Hisense viewing analytics/ACR, Google partner referral reporting, and Google feedback uploading for user 0. It does not uninstall packages. Google voice assistant, Chromecast/casting, firmware updates, Play Store/Services, Tailscale, input services, Bluetooth/remote pairing, and the on-screen keyboard are preserved. No Private DNS or playback settings were changed.

## Home behavior

This firmware gives Google TV's Home activity priority 2 and setupwraith's RecoveryActivity priority 1. Setting a third-party default reports Success but still resolves to Google TV; disabling Google TV exposes RecoveryActivity. The setup wizard owns the active saved Wi-Fi network, so disabling it would delete that network. Both packages therefore remain enabled.

The upstream HomeKeyService redirects the stock Home window to CleanYourTV. `stock_home_redirect` names Google TV and `key_filter: false` prevents key filtering. The helper is an accessibility service: it receives window-change events to detect stock Home. It is not a replacement Android default; Android still resolves HOME to Google TV. No WRITE_SECURE_SETTINGS grant was given to the launcher. The installer's location grant supplies the network name in the top bar.

Google TV may display its existing account chooser on wake; selecting an existing unlocked profile completes that step and Home then redirects to the new screen. Back dismisses the chooser for that visit. A force-stop of CleanYourTV also removes its accessibility helper until it is enabled again. Normal theme pushes preserve/rebind enabled launcher helpers. Keep the redirect keys in customized themes.

## Audit and validation

The source review covered the launcher's manifest, network/process-loading calls, exported components, theme file provider and path validation, bounded config/image loading, add-on identity/consent validation, dependencies/build wrapper, install/home guards, and reversible cleanup tooling. No blocking issue was found for this pinned launcher with the configuration above. This is a scoped source review, not a guarantee for every future revision or third-party add-on.

The launcher has no INTERNET permission, telemetry client, downloaded executable code, or root requirement. Its theme provider requires WRITE_SECURE_SETTINGS from the caller and restricts filenames. Add-on cards require owner consent and bind decisions to their signing certificate and label; add-ons still run as independent Android apps and need a separate review, including any installer script. Some request Internet, overlays, accessibility, startup, or foreground-service permissions.

Validation on Godseye: 226 Android unit tests passed; release lint passed with zero errors, 83 warnings and 83 informational findings; release APK 509,389 bytes, below the upstream 512 KiB limit. APK SHA-256: `1f387666855725cb4651a6048d524f5f3d16e68ccc44eb1a97b6dc1ac2fe8cd1`. The Gradle wrapper JAR matched Gradle's official 8.9 checksum; the distribution checksum is pinned in the source. The release uses Godseye's existing local debug signing identity, as upstream configures; preserve that key for in-place updates and never commit it.

The upstream Python suite ran 874 tests with 12 skipped and zero failures. Android build dependencies are version-pinned but have no full dependency-verification lockfile; future dependency/build changes need another review.

On the physical Hisense, the installed APK SHA-256 matched the build. The dock, app grid and D-pad focus rendered correctly; Kathrine launched and Home returned to CleanYourTV after the existing Google profile picker was completed. After one reboot, HomeKeyService was bound with no crashed services, CleanYourTV was focused, and the disabled-package list contained exactly the three new telemetry packages plus the two previously disabled tuners. Tailscale was initially disconnected; opening its existing signed-in configuration restored the VPN and MagicDNS, and Kathrine loaded its signed-in four-title library without changing accounts or server settings. The owner separately confirmed the real remote's Home, Input, Settings, microphone and app buttons, including held Volume Up, work. No emulator was used. Debugging remains temporarily enabled for the owner's requested Cosy/Aurora and shared-photo customization; close and verify it after that work. Streaming playback, DRM, casting from a phone, voice recognition, and HDMI video/audio output require separate physical checks; injected navigation and a successful build do not certify them.

## Build, customize, and recover

The complete source and build live at `C:\Users\nomok\cleanyourtv` on Godseye; the matching source checkout is `/home/nosa/cleanyourtv` on Shitbook. Backups are private and ignored by Git: `backup/20261024-before` on both hosts, with a local compressed copy. They include installed/disabled packages, properties, all settings namespaces, Home candidates, Wi-Fi ownership, inputs, and display settings. Keep backups and screenshots private.

Run these from the CleanYourTV source root in PowerShell on Godseye with debugging temporarily enabled. Set `TV_HOST` to the TV's current Wi-Fi address, and use the existing trusted ADB identity. Both upstream scripts change the current directory, so return to the source root between commands.

```powershell
# Rebuild and validate the pinned launcher; do not auto-disable stock Home.
.\launcher\gradlew.bat --project-dir launcher --no-daemon testReleaseUnitTest lintRelease assembleRelease

# Install an APK built here without changing Google's default Home or setup wizard.
.\tools\venv\Scripts\python.exe -I tools\b64push.py launcher\app\build\outputs\apk\release\app-release.apk /data/local/tmp/tvhome.apk
.\tools\venv\Scripts\python.exe -I tools\tv.py 'pm install -r /data/local/tmp/tvhome.apk'

# Push a custom theme folder; config.json may be accompanied by wallpaper.jpg.
.\tools\theme.ps1 -TvHost $env:TV_HOST 'C:\path\to\your-theme'

# Preview choices without installing anything.
.\tools\venv\Scripts\python.exe -I tools\manage.py list themes
.\tools\venv\Scripts\python.exe -I tools\manage.py list addons
```

After the initial installation, or a force-stop that removes the helper, enable Home redirection without replacing other accessibility services. Run from the source root; the here-string preserves quotes through Windows PowerShell:

```powershell
@'
s=$(settings get secure enabled_accessibility_services); case "$s" in *com.gathin.tvhome/.HomeKeyService*) ;; null|"") settings put secure enabled_accessibility_services com.gathin.tvhome/.HomeKeyService ;; *) settings put secure enabled_accessibility_services "$s:com.gathin.tvhome/.HomeKeyService" ;; esac; settings put secure accessibility_enabled 1
'@ | & .\tools\venv\Scripts\python.exe -I tools\tv.py --batch
```

Browse [themes and add-ons](https://cleanyour.tv/addons). Copy a theme to a private working folder before changing it. Carry across `dock_apps`, `columns`, `app_library`, `tile_menu`, `stock_home_redirect`, and `key_filter` from the baseline config. Plain themes only change JSON/images; add-ons are executable apps. Build chosen add-ons from the pinned/audited source on Godseye, rather than installing an arbitrary APK or running an unreviewed installer. Source build/install instructions are in upstream `addons/README.md`.

To undo telemetry cleanup, run upstream `tools/restore.ps1 -TvHost $env:TV_HOST -List work/hisense-telemetry.txt -Stock com.google.android.apps.tv.launcherx` from the same checkout. Keep that list at the same absolute path: upstream stores the recorded prior package states under the account's `.cleanyourtv/` directory. The two tuner packages disabled before this session must remain disabled. The stock launcher originally used Android's default enabled state (`enabled=0`); after undo, use `tools/tv.py "pm default-state --user 0 com.google.android.apps.tv.launcherx"` to restore that state if the cleanup recovery record explicitly enables it. To undo Home redirection, turn off CleanYourTV's “Home button” service in TV Settings → Accessibility. Google TV remains installed/enabled and becomes visible immediately. No firmware reset or app data deletion is needed.

The original Home component is `com.google.android.apps.tv.launcherx/.home.HomeActivity`. The source's `launcher/build-and-install.ps1` normally attempts a default handover; on this firmware it reports a Home guard failure even with `-StockLauncher none`. The APK installs successfully, but the supported redirection configuration and helper must be applied afterward; never bypass the setupwraith Wi-Fi guard.

Turn USB and network debugging off after maintenance. Revoke authorizations if ending trusted device access, reboot, and verify the ADB port is closed from Godseye. Re-enable debugging physically for later theme/add-on installation.
