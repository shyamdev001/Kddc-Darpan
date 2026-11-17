#!/bin/sh
# Runs backup.sh once a day at BACKUP_AT_UTC (default 20:30 UTC = 02:00 in India), and once at start
# when the newest backup is more than a day old (a new server, or the server was off at backup time).
set -u

at="${BACKUP_AT_UTC:-20:30}"

run() {
  if sh /scripts/backup.sh; then
    :
  else
    echo "BACKUP FAILED at $(date -u). The container shows as unhealthy until the next good backup." >&2
  fi
}

if [ -z "$(find /backups/last-success -mmin -1440 2>/dev/null)" ]; then
  run
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today $at" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow $at" +%s)
  echo "Next backup at $(date -u -d "@$next" '+%Y-%m-%d %H:%M') UTC."
  sleep $((next - now))
  run
done
