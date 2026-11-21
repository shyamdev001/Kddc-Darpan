#!/usr/bin/env bash
# Checks what TV control can work on one TV model, for docs/DEVICE_COMPATIBILITY.md.
#
#   tools/tv-control-check.sh <tv-address>             facts only, changes nothing
#   tools/tv-control-check.sh <tv-address> --standby   also: does the TV stay reachable in standby?
#
# Needs adb on the laptop and Android debugging on (switch it off again after: the dashboard warns
# while it is on). The dashboard's own tests come after this: "Test screen off", "Restart TV",
# Mute/Volume on the screen page; each result is kept as a capability for that TV.
set -u

tv="${1:?usage: tv-control-check.sh <tv-address> [--standby]}"
dev="$tv:5555"
pkg="in.kdcc.darpan"
sh() { adb -s "$dev" shell "$@" 2> /dev/null | tr -d '\r'; }
row() { printf '%-36s %s\n' "$1" "${2:-(not reported)}"; }

adb connect "$dev" > /dev/null 2>&1 || true
if [ "$(sh echo ok)" != "ok" ]; then
  echo "Cannot reach $dev over adb. Is Android debugging on, and is the TV on this network?"
  exit 1
fi

echo "== The TV"
row "Model" "$(sh getprop ro.product.manufacturer) $(sh getprop ro.product.model)"
row "Android API level" "$(sh getprop ro.build.version.sdk) (reboot from the app needs 24+)"
row "Chipset" "$(sh getprop ro.board.platform)"
row "Last boot reason" "$(sh getprop sys.boot.reason) $(sh getprop ro.boot.bootreason)"

echo
echo "== Kiosk (device owner is needed for screen off, reboot and system brightness)"
owner="$(sh dumpsys device_policy | grep -A2 -i 'Device Owner' | grep -o "$pkg" | head -1)"
row "Darpan is device owner" "$([ -n "$owner" ] && echo yes || echo no)"

echo
echo "== Power and screen"
row "Panel state" "$(sh dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*')"
row "Sleep timeout (ms)" "$(sh settings get system screen_off_timeout)"
row "Stay on while plugged in" "$(sh settings get global stay_on_while_plugged_in)"
row "Exact alarms for Darpan" "$(sh appops get "$pkg" SCHEDULE_EXACT_ALARM | head -1)"
row "Doze (device idle) enabled" "$(sh dumpsys deviceidle enabled)"
row "Thermal status" "$(sh dumpsys thermalservice | grep -m1 'Thermal Status')"

echo
echo "== Brightness and sound"
row "System brightness (0-255)" "$(sh settings get system screen_brightness)"
row "Brightness mode (0 = manual)" "$(sh settings get system screen_brightness_mode)"
row "Fixed volume (firmware owns it)" "$(sh dumpsys audio | grep -m1 -i 'mUseFixedVolume\|fixed volume')"
row "Media volume" "$(sh dumpsys audio | grep -m1 -A3 'STREAM_MUSIC' | grep -m1 -o 'Current: .*' | cut -c1-80)"

echo
echo "== Out of scope, recorded for the table"
row "HDMI-CEC service" "$(sh dumpsys hdmi_control | grep -m1 -i 'mHdmiControlEnabled\|hdmi_control_enabled')"
row "Wake-on-LAN setting (rarely there)" "$(sh settings get global wake_on_lan)"

if [ "${2:-}" = "--standby" ]; then
  echo
  echo "== Standby: the TV goes to sleep for 2 minutes (like the remote's power key), then wakes."
  echo "   A TV still answering adb in standby keeps its CPU and network on: alarms can wake it."
  sh input keyevent KEYCODE_SLEEP > /dev/null
  sleep 120
  if [ "$(timeout 15 adb -s "$dev" shell echo ok 2> /dev/null | tr -d '\r')" = "ok" ]; then
    row "Reachable after 2 min of standby" "yes (light standby: the panel-off night mode may work)"
    sh input keyevent KEYCODE_WAKEUP > /dev/null
    sleep 3
    row "Woke from adb" "$(sh dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*')"
  else
    row "Reachable after 2 min of standby" "no (deep standby: only the power key or the TV's own timer wakes it)"
    echo "   Press power on the remote now."
  fi
fi

echo
echo "Next, on the dashboard screen page: Test screen off, Restart TV, Mute and Volume."
echo "Then switch Android debugging off again."
