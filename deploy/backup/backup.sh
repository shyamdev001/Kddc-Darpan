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

# Media: copy files that are new or changed. Nothing is deleted here, so a poster removed by mistake
# can still be found in the backup.
cp -a -u /media/. /backups/media/

# Keep the last $keep_days days of database backups (and never delete the newest one).
find /backups/db -name 'darpan-*.dump' -mtime +"$keep_days" ! -name "darpan-$stamp.dump" -delete
rm -f /backups/db/.darpan-*.dump.part

date -u +%Y-%m-%dT%H:%M:%SZ > /backups/last-success
echo "Backup darpan-$stamp.dump done ($(du -h "/backups/db/darpan-$stamp.dump" | cut -f1))."
