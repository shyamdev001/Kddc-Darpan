# KDCC Darpan TV app

Android app for the branch TVs (Kotlin, Media3 ExoPlayer, OkHttp, Socket.IO client).
There is no Android Studio on the dev machine: GitHub Actions builds the APK
(`.github/workflows/android.yml`) and uploads it as the `kdcc-darpan-apk` artifact.

## What it does
1. First start: asks for the server address (unless one was built in), registers, and shows a 6-digit code.
2. Pair it on the dashboard: Screens, Pair a screen, enter the code.
3. Downloads the playlist's files, checks each SHA-256, and loops them. Only verified files play.
4. Keeps a live Socket.IO link: changes on the dashboard arrive in about 2 seconds, with a heartbeat every 60 s.
   Every 10 minutes it also re-checks the manifest, in case a push was missed.
5. With no network it keeps playing the last content it had, and ads still stop on their end date.
6. Schedules run on the TV itself, in India time: it switches to a timed playlist when its slot starts and back
   when it ends, and shows a black screen outside display hours (letting the TV's own power saving take over).
   This keeps working offline. Schedule rules live in `Schedule.kt` and must match `packages/shared/src/schedule.ts`.

## Build settings (GitHub repository settings)
| Name | Kind | Purpose |
| --- | --- | --- |
| `DARPAN_KEYSTORE_B64` | Secret | Base64 of the signing key (.p12). Without it every build has a different key and cannot update the installed app. |
| `DARPAN_KEYSTORE_PASSWORD` | Secret | Password of that key. |
| `DARPAN_SERVER_URL` | Variable (optional) | Server address built into the APK, e.g. `http://10.0.0.5:4000`. If empty, the TV asks on first start. |

Keep the signing key and its password safe and off GitHub's file tree. Losing the key means
uninstalling the app on every TV before a new version can be installed.

## Install on a TV (sideload)
```
adb connect <tv-ip>:5555
adb install -r kdcc-darpan.apk
```
Or copy the APK to a USB stick and open it with the TV's file manager (allow unknown sources).

## On the TV remote
- While the pairing code is shown: **Change server** button (or the Menu key) opens the server address screen.
- Back is ignored while content is playing.

## Not yet (Phase 2)
Kiosk / Device Owner mode, reliable auto-start on Android 10+, OTA updates, play logs, brightness,
screenshots and other remote commands. Portrait TVs are rotated 90° clockwise; a flip option may be needed.
