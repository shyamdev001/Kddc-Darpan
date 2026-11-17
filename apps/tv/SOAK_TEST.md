# 72-hour soak test

Proves the TV app can run for days without leaking memory, restarting, freezing or flashing black.
Run it on the head-office test TV before every pilot release, and again after any change to
playback, downloads or the live connection.

## Set-up

1. Install the release APK on the test TV and pair it to a test branch.
2. Give that branch a playlist that exercises everything:
   - at least 20 posters, including two portrait ones and one very large JPG
   - three videos (a short one, a 40 MB one, one that is longer than its slot)
   - one timed playlist that starts and ends during the test (for example 10:00 to 12:00 daily)
   - one ad whose end date falls in the middle of the test
   - a default slide
3. Turn on **Keep screens in step** for the branch if a second TV is available, and put the two side by side.
4. On the laptop: install adb, switch on Android debugging on the TV, and note the TV's LAN address
   from the screen page.

## Run

```bash
cd apps/tv
bash tools/soak.sh <tv-lan-address> 72 2
```

The script records the app's memory (PSS, Java heap, native heap, graphics) and its process id once
an hour, into `soak-<date>.csv`. Leave the laptop awake and on the same network. The last number is
how many restarts are planned: the power cut and the Restart command below.

During the 72 hours, on purpose (each one between two hourly readings):

| When | Do | Expect |
| --- | --- | --- |
| Hour 4 | Unplug the network cable / turn off WiFi for 30 min | Keeps playing; screen page shows offline, then online again |
| Hour 8 | Cut the TV's power for 2 min (with the router also off) | Starts by itself, plays the always-on playlist; "Clock not set" until the internet is back |
| Hour 20 | Send a broadcast for 10 min | Broadcast shows, then the playlist resumes |
| Hour 30 | Replace two posters and reorder the playlist | New files download; old ones are deleted |
| Hour 48 | Send Restart and Screenshot commands | Both work; after Restart the app is back on screen within a minute |

## Pass

- Memory: PSS at the end is less than 10 % above PSS at hour 2 (the script prints this).
- No unplanned restarts: the process id changes only at the power cut and the Restart command.
  Check the screen page's crash line too.
- No black frames between items and no frozen picture: watch for 10 minutes at hours 1, 24, 48
  and 72, including a poster-to-video change.
- Proof of play: the report for the test branch shows plays in every hour the TV was on.
- In step (two TVs): the screen page shows "In step (±n ms)" with n under 50, and video drift
  under 250 ms; posters change together by eye.

Write the result (pass/fail, the CSV's verdict lines, anything odd) into the release notes, and keep
the CSV with them. Switch Android debugging off again afterwards.
