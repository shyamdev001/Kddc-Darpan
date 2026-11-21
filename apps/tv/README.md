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
   TVs without a clock battery wake from a power cut at a factory date; `TrustedClock` never lets the time
   fall behind the last server time it saw, so dated ads keep playing until the network sets the real clock.
6. Schedules run on the TV itself, in India time: it switches to a timed playlist when its slot starts and back
   when it ends, and shows a black screen outside display hours (letting the TV's own power saving take over).
   This keeps working offline. Schedule rules live in `Schedule.kt` and must match `packages/shared/src/schedule.ts`.
7. Remote control from the screen's dashboard page: screenshot, reload, restart the app, clear downloaded
   files. The TV replies on the socket (`command:ack`); a screenshot replies by uploading the image.
8. Proof of play: every poster or video shown is saved to a small file on the TV (kept while offline)
   and uploaded every hour to `POST /api/devices/playlogs`. The dashboard's Proof of play page reads it.
9. Kiosk mode when the app is the TV's device owner (setup below): pinned to Darpan, a watchdog, and a
   15-minute maintenance unlock from the dashboard (`kioskUnlock` / `kioskLock` commands).
10. Outside display hours (TV control): the screen is black at the lowest backlight and the panel stays on,
so it is surely on at opening time. Only a device-owner TV that passed **Test screen off** (panel off, then
an exact alarm must switch it back on by itself a minute later) switches its panel off at night, with an
alarm for the next on time. Switching a TV on from deep standby or from mains-off is not possible from an
app: use the TV's own on/off timer. The dashboard can also restart the whole TV (device owner, Android 7+)
and set the volume or mute (where the TV lets Android set it); buttons for what a TV cannot do are greyed
out with the reason. `tools/tv-control-check.sh <tv-address>` checks a TV model over adb.

App updates (OTA): upload the built APK on the dashboard's App updates page. It goes to the ticked
    test screens first; "Release to all screens" sends it everywhere. A TV waits a random 0-10 minutes,
    downloads it (resumable), checks its SHA-256 and installs it silently, then restarts into the new
    version. Silent install needs kiosk mode (device owner); other TVs show the new version on the
    dashboard and are updated by hand. A failed install is retried after 6 hours. Every APK must be
    signed with the same key (the GitHub secrets), or Android refuses the update.

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
- Back is ignored while content is playing. Menu while playing opens the TV's own Settings
  (in kiosk mode only while unlocked, see below).

## Start on power-on
Android 10+ does not let apps open themselves at boot. Make KDCC Darpan the TV's home app: press Home,
pick KDCC Darpan and choose Always (or Settings > Apps > Default apps > Home app). It then opens at
every power-on and Home returns to it. Kiosk mode (below) sets this for you.

## Kiosk mode (device owner)
Once the app is the TV's **device owner**, it locks the TV to Darpan: it is pinned on screen (Home,
Recents and the notification shade do nothing), it is always the home app so it opens at power-on, and a
watchdog brings it back within about 2 minutes if anything closes it. Without this step the app works as
before; the dashboard shows "Kiosk mode is not set up" on the screen's page.

Set it up once per TV, after a factory reset and before signing in to any account:
1. Factory reset the TV. In the setup wizard connect to Wi-Fi (or LAN) but **skip every account sign-in**
   (Google, Mi). Device owner cannot be set while any account exists on the TV.
2. Turn on developer options: Settings > About (or Device preferences > About) > press Build 7 times.
   Then in Developer options turn on USB debugging (and Network/ADB debugging, if you connect over the LAN).
3. Install the APK and set the owner from the laptop (adb is in Android platform-tools):
   ```
   adb connect <tv-ip>:5555
   adb install -r kdcc-darpan.apk
   adb shell dpm set-device-owner in.kdcc.darpan/.AdminReceiver
   ```
   The last line should print `Success: Device owner set ...`. If it says there are already accounts or
   users on the device, remove them (or reset again) and retry.
4. Open KDCC Darpan once (or restart the TV). It locks itself; you can turn developer options off again.
5. A factory reset gives the TV a new Android id, so it shows a new pairing code as if it were a new TV.
   If it was already a screen, do not pair it as a new one: on the dashboard open that screen and use
   **Replace TV** with the code. The screen keeps its name, branch, playlists and play history. The same
   works when a TV is swapped for another one.

Maintenance (Wi-Fi changes, display settings):
- From the dashboard: Screens > the screen > Remote control > **Unlock for 15 min**. Menu then opens the TV's
  settings. It locks again by itself after 15 minutes, or at once with **Lock now**.
- At the branch, with the kiosk PIN (set by a super admin on App updates > Kiosk unlock PIN): press Menu
  5 times within 3 seconds and enter the PIN. The settings open for 15 minutes, also without a network.
  The TV checks the PIN itself against a salted hash from its last sync. 5 wrong PINs block it for 15
  minutes. Unlocks and wrong PINs show in the activity log once the TV is back online.
- With no PIN set, and only while the TV cannot reach the server (for example the Wi-Fi password changed),
  the Menu key unlocks the settings for 15 minutes on the spot.

Crashes:
- After a crash the app restarts after 3 s, then 10 s, 30 s, 2 min, and at most every 5 min while it keeps
  crashing (the screen says "Restarting in …"). Repeated crashes put it in safe mode (posters only).
- A crash while in safe mode, or 10 crashes in 30 minutes, puts it in **rescue mode**: it shows only the
  default slide, keeps syncing and checking for a new app version (installed at once, no waiting), and
  allows adb even while locked. It ends an hour after the last crash, on Restart app from the dashboard,
  or when a new app version starts. While a test screen is in safe or rescue mode on a version, that
  version cannot be released to all.

While locked, the app also (K6, K11): blocks safe boot, USB sticks and USB file transfer (allowed during
maintenance), blocks adding users, keeps the power menu but not Home or Recents, lets firmware updates
install only between 01:00 and 04:00, turns on automatic time and sets Android's sleep timeout to 10
minutes. It never blocks factory reset.
Installing from unknown sources is not blocked yet: first check on a real TV that our own updates still
install with it set.

App updates (OTA):
- A downloaded update installs at a quiet moment: outside display hours with no broadcast on, or 01:00 to
  04:00 on a TV with no display hours; after a day of waiting it installs anyway. **Install at once** on
  App updates skips the wait for an urgent fix, and rescue mode never waits.
- Build numbers are `offset + GitHub run number`, with the offset in `apps/tv/version.properties`. If the
  run number starts again at 1 (workflow renamed, repo moved), raise the offset above the newest build on
  the dashboard; the dashboard refuses an APK that is not newer.
- Remote commands run one at a time on the TV, in the order they came.

Notes:
- App updates must be signed with the same key (the GitHub signing secrets); a differently signed APK
  cannot replace a device-owner app.
- A TV has only one device owner. TVs still running the old vendor kiosk app need a factory reset first.
- To take kiosk mode off a TV: a super admin opens the screen > Remote control > **Take out of kiosk
  mode…**, types the screen's name, a reason and a code from the two-step app. **Leave kiosk mode** keeps
  Darpan as device owner (Lock again puts it back); **Also remove Darpan as device owner** cannot be undone
  from the dashboard (locking it again needs a factory reset), and the app can then be uninstalled. A
  factory reset also works.

## Brightness
Set on the dashboard with the display hours (Schedules > Display hours > Set screen brightness). The TV
applies it in two ways: the system brightness (kiosk TVs on Android 9 or newer; the TV's own value is
put back when brightness is turned off again) and the app's own window brightness. Many TVs drive the
backlight from their picture settings and ignore one or both, so check it on the real TV.

## Broadcast
Dashboard > Broadcast takes over screens at once until it is stopped or its time is up, even outside
display hours: a full-screen message, a poster or video from Media, or a live link. YouTube links play
in YouTube's own player (a WebView made only for the broadcast; needs an up-to-date Android System
WebView and internet at the branch). Direct .m3u8 / .mp4 links play in ExoPlayer. Broadcasts play with
sound unless "Sound off" is ticked. The dashboard shows how many screens are showing it, and why a
screen could not (for example a YouTube video whose owner does not allow embedding).

## Soak test
Before each pilot release, run the 72-hour soak test on the head-office TV: [SOAK_TEST.md](SOAK_TEST.md).
`tools/soak.sh` records the app's memory every hour and prints a pass/fail verdict.

## Keeping screens in step
A branch with **Keep screens in step** on (dashboard, Branches, edit the branch) plays one shared
timeline on all its TVs: the item and the moment inside it are worked out from the server's time, so
TVs side by side change together. Each TV measures the server's clock in short bursts (at connect and
every 5 minutes) and holds videos to the timeline. The screen page shows how close each TV keeps.
A file a TV has not downloaded yet keeps its turn, filled by the default slide.

## Not yet
Nothing planned for Phase 2.
Portrait TVs are rotated 90° clockwise; a flip option may be needed.
