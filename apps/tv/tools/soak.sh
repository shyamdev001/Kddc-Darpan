#!/usr/bin/env bash
# Records the KDCC Darpan TV app's memory once an hour, for the soak test in ../SOAK_TEST.md.
#
#   tools/soak.sh <tv-address> [hours] [planned-restarts]   e.g.  tools/soak.sh <tv-lan-address> 72 1
#
# Needs adb on the laptop and Android debugging switched on on the TV (switch it off again after:
# the dashboard warns while it is on). Writes soak-<date>.csv in the current folder and prints a
# verdict at the end. Safe to stop with Ctrl+C: the rows so far are kept.
set -u

tv="${1:?usage: soak.sh <tv-address> [hours]}"
hours="${2:-72}"
planned="${3:-0}" # restarts done on purpose (a power cut), not counted against the app
pkg="in.kdcc.darpan"
dev="$tv:5555"
out="soak-$(date +%Y%m%d-%H%M).csv"

echo "time,hour,pid,pss_kb,java_heap_kb,native_heap_kb,graphics_kb" > "$out"
echo "Recording to $out every hour for $hours hours."

for ((h = 0; h <= hours; h++)); do
  adb connect "$dev" > /dev/null 2>&1
  stamp="$(date +%Y-%m-%dT%H:%M:%S)"
  pid="$(adb -s "$dev" shell pidof "$pkg" 2> /dev/null | tr -d '\r')"
  if [ -z "$pid" ]; then
    echo "$stamp,$h,,,,," >> "$out"
    echo "$stamp  hour $h: app not running or TV not reachable"
  else
    mem="$(adb -s "$dev" shell dumpsys meminfo "$pkg" 2> /dev/null | tr -d '\r')"
    # App Summary lines. Android 10+: "TOTAL PSS: n"; older: "TOTAL: n".
    pss="$(echo "$mem" | awk '/TOTAL PSS:/ { print $3; exit } /^ *TOTAL: / { print $2; exit }')"
    java="$(echo "$mem" | awk '/Java Heap:/ { print $3; exit }')"
    native="$(echo "$mem" | awk '/Native Heap:/ { print $3; exit }')"
    gfx="$(echo "$mem" | awk '/Graphics:/ { print $2; exit }')"
    echo "$stamp,$h,$pid,$pss,$java,$native,$gfx" >> "$out"
    echo "$stamp  hour $h: pid $pid, PSS ${pss:-?} kB"
  fi
  [ "$h" -lt "$hours" ] && sleep 3600
done

# Verdict: memory growth from hour 2 (after warm-up) to the end, and restarts (pid changes).
awk -F, -v planned="$planned" '
  NR == 1 { next }
  $3 == "" { missing++; next }
  { if (last_pid != "" && $3 != last_pid) restarts++; last_pid = $3 }
  $2 == 2 { base = $4 }
  { end = $4 }
  END {
    growth = (base > 0) ? (end - base) * 100 / base : 0
    printf "PSS at hour 2: %s kB, at the end: %s kB, growth %.1f %%\n", base, end, growth
    printf "Restarts: %d (planned %d), hours with no reading: %d\n", restarts, planned, missing
    ok = (base > 0 && growth < 10 && restarts <= planned && missing == 0)
    print (ok ? "PASS" : "FAIL (see SOAK_TEST.md)")
  }' "$out"
