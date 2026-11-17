#!/bin/sh
# Restore a database backup into a database of your choice.
#   docker compose exec backup sh /scripts/restore.sh                          # newest backup -> darpan_restore_test
#   docker compose exec backup sh /scripts/restore.sh darpan-20260101-203000.dump darpan_restore_test
# The target is dropped and created again. Restoring over the live database (darpan_prod) is refused
# here on purpose: follow the "Recover after a disaster" steps in deploy/README.md instead.
set -eu

file="${1:-$(ls -1 /backups/db/darpan-*.dump 2>/dev/null | sort | tail -n 1)}"
target="${2:-darpan_restore_test}"

[ -n "$file" ] || { echo "No backups found in /backups/db." >&2; exit 1; }
case "$file" in /*) ;; *) file="/backups/db/$file" ;; esac
[ -f "$file" ] || { echo "Backup not found: $file" >&2; exit 1; }
if [ "$target" = darpan_prod ] && [ "${I_STOPPED_THE_API:-}" != yes ]; then
  echo "Refusing to overwrite darpan_prod. Stop the API first, then run with I_STOPPED_THE_API=yes." >&2
  exit 1
fi

echo "Restoring $(basename "$file") into $target ..."
dropdb --host=db --username=darpan --if-exists --force "$target"
createdb --host=db --username=darpan "$target"
pg_restore --host=db --username=darpan --dbname="$target" --no-owner --exit-on-error "$file"
echo "Restored. Screens in $target: $(psql --host=db --username=darpan --dbname="$target" -tAc 'SELECT count(*) FROM "Screen"')"
