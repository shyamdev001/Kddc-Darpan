# Production server

One Linux server (for example an AWS Lightsail instance in Mumbai) runs everything with Docker Compose:

| Service | What it does |
| --- | --- |
| `db` | PostgreSQL 18. Not reachable from outside. |
| `api` | The API. Applies database migrations on every start. Media in the `media` volume. |
| `web` | The dashboard. |
| `caddy` | HTTPS for the domain; renews the certificate on its own. |

## First install

1. Server: Ubuntu 24.04, at least 2 GB RAM. Open ports 80 and 443 (and 22 for you) in the firewall.
2. Point the domain's DNS A record at the server's static IP.
3. Install Docker: `curl -fsSL https://get.docker.com | sh`
4. Get the code: `git clone <repository> darpan && cd darpan/deploy`
5. `cp production.env.example .env`, fill in every value, then `chmod 600 .env`.
6. `docker compose up -d --build` (the first build takes a few minutes).
7. Create the first admin: `docker compose exec api npx prisma db seed`
8. Open `https://<your domain>` and sign in. Then remove `SEED_ADMIN_PASSWORD` from `.env`.
9. On each TV, set the server address to `https://<your domain>`.

## Update to a new version

```bash
cd darpan && git pull && cd deploy && docker compose up -d --build
```

The API applies new migrations as it starts. TVs keep playing their saved content during the minute
the API restarts.

## Everyday checks

- Status: `docker compose ps` (all should say `healthy` or `running`)
- Logs: `docker compose logs -f api` (logs are capped at 50 MB per service)
- Health from outside: `https://<your domain>/api/health`. It says `"status":"ok"`, or `"warn"` with
  the reason: less than 2 GB disk free (`HEALTH_MIN_FREE_GB` in `.env` changes this), or an upload
  waiting more than 30 minutes for processing.

## Monitoring (Uptime Kuma)

Uptime Kuma checks the health address every minute and emails when it fails or warns.

1. Start it: `docker compose --profile monitoring up -d uptime-kuma`
2. Its page listens only on the server. From your PC: `ssh -L 3001:127.0.0.1:3001 <user>@<server>`,
   then open http://localhost:3001 and create the admin account.
3. Add a monitor: type **HTTP(s) - Keyword**, URL `https://<your domain>/api/health`, keyword
   `"status":"ok"`, interval 60 s. This fails when the API is down *and* when it warns.
4. Settings → Notifications: add the bank's SMTP server (the same one as in `.env`) and tick it on the monitor.

It runs on the same server, so it cannot report the whole server going down. For that, add a free
outside check of the same address from a second machine, such as the head-office PC.

## Where the data lives

Docker volumes `darpan_pgdata` (database), `darpan_media` (uploaded posters and videos) and
`darpan_caddy_data` (certificates).

## Backups

The `backup` service backs up every night at 02:00 India time (`BACKUP_AT_UTC`, default `20:30`):

- `deploy/backups/db/darpan-<date>.dump`: the whole database. The last 14 days are kept (`BACKUP_KEEP_DAYS`).
- `deploy/backups/media/`: a copy of every poster and video. Files are added, never removed.
- `deploy/backups/last-success`: when the last good backup finished. `docker compose ps` shows the
  `backup` service as **unhealthy** if that is more than 26 hours ago.

Backup now: `docker compose exec backup sh /scripts/backup.sh`

**These copies are on the same server.** If the server is lost, they are lost too. Also do one of these:

- Turn on Lightsail **automatic snapshots** for the instance (daily, kept 7 days, small monthly charge), or
- copy `deploy/backups` to another machine regularly, for example from a head-office PC:
  `scp -r ubuntu@<server>:darpan/deploy/backups D:\darpan-backups`

### Test a backup (do this once a month)

```bash
docker compose exec backup sh /scripts/restore.sh
```

This restores the newest backup into a separate database, `darpan_restore_test`, and prints how many
screens it holds. The live system is not touched. A different backup:
`docker compose exec backup sh /scripts/restore.sh darpan-20260101-203000.dump`

### Recover after a disaster

On a new server, follow "First install" up to step 5, then:

1. Copy the saved `backups` folder into `deploy/backups`.
2. `docker compose up -d db backup` (only the database and the backup service).
3. `docker compose exec -e I_STOPPED_THE_API=yes backup sh /scripts/restore.sh darpan-<date>.dump darpan_prod`
4. Put the media back:
   `docker compose run --rm --no-deps -v ./backups/media:/restore:ro --entrypoint sh api -c 'cp -a /restore/. /data/media/'`
5. `docker compose up -d` and sign in. TVs reconnect on their own; they kept playing meanwhile.
