# KDCC Darpan — Project Brief

**Product name: KDCC Darpan** ("Darpan" = mirror). Use this name in the dashboard title, login page,
TV pairing screen and app label.
- Dashboard title: "KDCC Darpan"
- TV app label: "KDCC Darpan", Android package `in.kdcc.darpan`
- npm workspace names: `@darpan/api`, `@darpan/web`, `@darpan/shared`
- Database name: `darpan` (dev), `darpan_prod` (production)

In-house digital signage system for KDCC Bank (Kheda District Central Co-operative Bank).
It replaces an outsourced vendor system. One web dashboard at head office
controls ~101 Android TVs across 93 branches: upload ads, build playlists, schedule, monitor.

All decisions below are LOCKED. Do not change the stack without asking the user.

## Current situation (for context)
- 101 Android TVs (1920x1080, ~1.76 GB RAM, ~25 GB storage, LAN or WiFi), mostly landscape, 55" (90) and 43" (10).
- Vendor app is installed in kiosk "device owner" mode on each TV.
- Ad content: ~400 files, mostly Gujarati JPG posters (~0.15 MB) plus a few MP4 videos (up to ~40 MB).
- Our goal: own the system, cheaper to run, more control.
- Vendor details, contract costs and internal reports are in `CLAUDE.local.md` and `docs/`, which are
  kept off GitHub (the repo is public). Never commit them or copy their contents into tracked files.

## Locked tech stack
| Part | Choice |
| --- | --- |
| Language | TypeScript (dashboard + server), Kotlin (TV app) |
| Monorepo | npm workspaces (no pnpm/yarn) |
| Dashboard | Next.js (App Router) + Tailwind + shadcn/ui |
| Server API | NestJS |
| Database | PostgreSQL + Prisma |
| Background jobs | pg-boss (queue inside PostgreSQL, no Redis) |
| Live control | Socket.IO |
| Media processing | FFmpeg (video → 1080p H.264 MP4) + Sharp (images → max 1920x1080, compressed) |
| File storage | Storage driver interface: `local` (dev, disk folder) and `s3` (prod, Cloudflare R2). Switch by env var only |
| Auth | Email + password (argon2), httpOnly cookie session/JWT, TOTP 2FA, roles |
| TV app | Android Kotlin + Media3 ExoPlayer + OkHttp + WorkManager + kotlinx.serialization |
| TV kiosk | Device Owner + Lock Task mode, BOOT_COMPLETED auto-start, watchdog relaunch |
| TV app build | GitHub Actions builds the APK (NO Android Studio on the dev machine) |
| Production (later) | AWS Lightsail Mumbai, Docker Compose, Caddy (HTTPS), Uptime Kuma |

## Local development environment (IMPORTANT)
- Windows. Node.js and Git installed on C:. C: drive is nearly full — keep everything else on D:.
- NO Docker locally. Docker is only for the production server.
- PostgreSQL 18 installed natively at `D:\Tools\PostgresSQL` (note the extra "s"), data dir `D:\Tools\PostgresSQL\data`, port 5432.
- Project root: `D:\Claude code\kdcc-signage` (note the space in "Claude code": always quote paths)
- Uploaded media (dev): `D:\kdcc-data\media`
- npm cache: `D:\Tools\npm-cache`
- Never write secrets into code or commit `.env`. Use `.env` (gitignored) + `.env.example`.
- No Android Studio and no emulator. Testing is on one real head-office TV (factory reset, APK sideloaded).
  The TV reaches the laptop over the LAN IP (or a mobile hotspot), so the API must bind to `0.0.0.0`.

## Repo structure
```
kdcc-signage/
  apps/
    api/        NestJS + Prisma + pg-boss + Socket.IO
    web/        Next.js dashboard
    tv/         Android Kotlin TV app (Gradle wrapper included; built by GitHub Actions)
  packages/
    shared/     Shared TypeScript types (device protocol, DTOs)
  .github/workflows/
    android.yml Builds the APK (kdcc-darpan.apk) on push, uploads it as an artifact
  .env.example
  docs/       Build report (.docx) and hosting cost sheet (.xlsx), reference only
  CLAUDE.md
```

## Data model (first version)
- Region → Taluka → Branch → Screen (hierarchy for targeting)
- Screen: name, branchId, orientation, status, lastSeenAt, appVersion, osVersion, model, storage/RAM, currentMediaId, deviceToken (hashed)
- Media: original name, display name (UTF-8, Gujarati safe), type (image/video), size, sha256, durationSec, width/height, storage key, startDate, endDate (ad expiry), tags
- Playlist + PlaylistItem (order, durationSec override)
- Assignment: playlist → screen | branch | taluka | region | all
- Schedule: dayparting (days of week, time range, date range), screen on/off, brightness
- User (role: SUPER_ADMIN, HO_ADMIN, REGION_MANAGER, BRANCH_VIEWER), AuditLog
- PlayLog (proof of play), DeviceCommand, AppRelease (OTA)

## Device protocol
1. TV first boot: `POST /api/devices/register` {hardwareId, model, osVersion, resolution} → {deviceId, deviceToken, pairingCode (6 digits)}. TV shows the code on screen.
2. Admin pairs in dashboard: `POST /api/screens/claim` {pairingCode, name, branchId}.
3. TV connects Socket.IO namespace `/devices` with deviceToken.
   - Server → TV: `manifest:updated`, `command` (restart, reload, screenshot, clearCache, emergency:show, emergency:clear)
   - TV → server: `heartbeat` every 60 s {currentMediaId, storageFree, ramFree, appVersion}
4. TV fetches `GET /api/devices/manifest` → {version, items: [{mediaId, url, sha256, size, type, durationSec}], schedule, settings}.
5. TV downloads only new/changed files (resumable), verifies sha256, plays ONLY verified files, deletes files no longer referenced.
6. TV uploads play logs in batches hourly: `POST /api/devices/playlogs`.
7. Offline: TV keeps playing the last good manifest from local storage.

## TV app constraints
- ~1.76 GB RAM: one ExoPlayer instance, preload next item only, no heavy libraries, no WebView playback.
  Exception (approved by the user): a YouTube broadcast plays in a WebView, created only while the
  broadcast runs and destroyed after; the playlist player is released meanwhile.
- Images shown via a lightweight ImageView with crossfade; videos via ExoPlayer.
- Must auto-start on boot and relaunch itself if it crashes.
- Android version of TVs not yet confirmed — set minSdk conservatively (23) until checked.

## Build phases
### Phase 1 — MVP (goal: one TV in head office plays our ads)
- [ ] Monorepo setup (npm workspaces), `.env.example`, Prisma schema, local Postgres connection
- [ ] Auth: seed a SUPER_ADMIN, login/logout (2FA can come in Phase 2)
- [ ] Media upload (images + videos) with local storage driver, sha256, Sharp/FFmpeg processing job
- [ ] Playlists: create, reorder, durations
- [ ] Screens: register/pair flow, list with online/offline + last seen
- [ ] Assign playlist to a screen
- [ ] Device API + Socket.IO heartbeat + manifest
- [ ] TV app: register, show pairing code, fetch manifest, download + verify, loop playback, heartbeat
- [ ] GitHub Actions workflow that builds the debug APK

### Phase 2 — Control
- [ ] Region/Taluka/Branch hierarchy + assignment at any level
- [ ] Scheduling (dayparting, screen on/off, brightness), ad start/end dates
- [ ] Offline alerts (email; Mailpit-style local SMTP catcher not available without Docker, so log emails to console in dev)
- [ ] Remote commands: restart, screenshot, clear cache
- [ ] Kiosk: Device Owner + Lock Task + boot auto-start + watchdog
- [ ] OTA app updates (AppRelease, test group first)
- [ ] TOTP 2FA, roles enforced, audit log

### Deploy (before pilot)
- [ ] Dockerfiles + docker-compose for production, Caddy, R2 storage driver, backups

### Phase 3 — Pilot (3 branches) · Phase 4 — Rollout + extras
- [ ] Proof-of-play reports (Excel/PDF export), emergency broadcast, rates ticker zone, approval workflow

## Conventions
- UTF-8 everywhere. Store a clean display name separate from the stored file key (Gujarati file names broke in the old system).
- All times stored in UTC; schedules evaluated in Asia/Kolkata.
- Every dashboard change that affects screens writes an AuditLog row.
- Keep the TV app small and boring. Reliability over features.
- Ask the user before adding any new paid service or heavy dependency.
