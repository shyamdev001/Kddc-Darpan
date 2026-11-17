#!/bin/sh
# One backup: the database (pg_dump, custom format) and any new media files.
# Runs inside the `backup` service; see schedule.sh. Manual run:
#   docker compose exec backup sh /scripts/backup.sh
set -eu

keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p /backups/db /backups/media

# Write to a temporary name, check the file can be read back, and only then give it its real name,
# so a half-written dump (full disk, killed container) never looks like a good backup.
part="/backups/db/.darpan-$stamp.dump.part"
pg_dump --host=db --username=darpan --dbname=darpan_prod --format=custom --file="$part"
pg_restore --list "$part" > /dev/null
mv "$part" "/backups/db/darpan-$stamp.dump"

# Media: copy files that are new or changed.
cp -a -u /media/. /backups/media/

# Files gone from the live media (an ad deleted, or an original removed a month after processing)
# move to media-removed/<today>/ and are kept as long as the database dumps: every dump still kept
# can find its files, and a poster deleted by mistake can be recovered for $keep_days days.
today="$(date -u +%Y%m%d)"
(cd /backups/media && find . -type f) | while IFS= read -r f; do
  [ -e "/media/$f" ] && continue
  mkdir -p "/backups/media-removed/$today/$(dirname "$f")"
  mv "/backups/media/$f" "/backups/media-removed/$today/$f"
done
find /backups/media -mindepth 1 -type d -empty -delete
if [ -d /backups/media-removed ]; then
  for d in /backups/media-removed/*/; do
    [ -d "$d" ] || continue
    day="$(basename "$d")"
    # Folder names are dates: compare them, not file times (cp -a keeps the upload time).
    if [ "$day" -lt "$(date -u -d "@$(( $(date -u +%s) - keep_days * 86400 ))" +%Y%m%d)" ]; then rm -rf "$d"; fi
  done
fi

# Keep the last $keep_days days of database backups (and never delete the newest one).
find /backups/db -name 'darpan-*.dump' -mtime +"$keep_days" ! -name "darpan-$stamp.dump" -delete
rm -f /backups/db/.darpan-*.dump.part

date -u +%Y-%m-%dT%H:%M:%SZ > /backups/last-success
echo "Backup darpan-$stamp.dump done ($(du -h "/backups/db/darpan-$stamp.dump" | cut -f1))."
