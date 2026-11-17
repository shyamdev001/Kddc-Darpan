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
- Health from outside: `https://<your domain>/api/health`

## Where the data lives

Docker volumes `darpan_pgdata` (database), `darpan_media` (uploaded posters and videos) and
`darpan_caddy_data` (certificates).
