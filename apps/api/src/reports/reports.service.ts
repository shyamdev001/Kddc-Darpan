import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MAX_REPORT_DAYS, PLAYLOG_KEEP_DAYS, type PlayReport } from '@darpan/shared';
import { Prisma } from '../generated/prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { isHeadOffice, screenScopeSql } from '../auth/scope';
import { PrismaService } from '../prisma/prisma.service';
import type { PlayLogEntryDto, PlayReportQueryDto } from './reports.dto';

const DAY_MS = 86_400_000;
/** A TV clock may run a little ahead; anything further in the future is a broken clock. */
const FUTURE_SLACK_MS = 10 * 60_000;
/** Shorter than this is a skip (failed file, playlist switch), not a play. */
const MIN_PLAY_MS = 1_000;
const PRUNE_EVERY_MS = 6 * 3_600_000;
const MAX_EXPORT_ROWS = 200_000;

type Filter = { from: string; to: string; branchId?: string; screenId?: string; mediaId?: string };

/**
 * Proof of play. TVs upload what they showed; each new row also bumps a per-day total
 * (PlayDaily) in the same statement, so reports never scan the raw log.
 */
@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.prune(), PRUNE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- From the TVs ----

  async ingest(screenId: string, entries: PlayLogEntryDto[]): Promise<{ accepted: number; skipped: number }> {
    const now = Date.now();
    const oldest = now - PLAYLOG_KEEP_DAYS * DAY_MS;
    const sane = entries.filter((e) => {
      const t = Date.parse(e.startedAt);
      return t >= oldest && t <= now + FUTURE_SLACK_MS && e.durationMs >= MIN_PLAY_MS;
    });
    // Ads deleted since the TV played them can no longer be linked; drop those.
    const ids = [...new Set(sane.map((e) => e.mediaId))];
    const known = new Set(ids.length ? (await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((m) => m.id) : []);
    const rows = sane.filter((e) => known.has(e.mediaId));
    if (!rows.length) return { accepted: 0, skipped: entries.length };

    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { name: true, branch: { select: { name: true } } } });
    const screenName = screen?.name ?? 'Unnamed screen';
    const branchName = screen?.branch?.name ?? null;

    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      WITH input AS (
        SELECT * FROM unnest(
          ${rows.map((r) => r.mediaId)}::uuid[],
          ${rows.map((r) => new Date(r.startedAt).toISOString())}::timestamptz[],
          ${rows.map((r) => r.durationMs)}::int[]
        ) AS t("mediaId", "startedAt", "durationMs")
      ), ins AS (
        INSERT INTO "PlayLog" ("screenId", "mediaId", "startedAt", "durationMs")
        SELECT ${screenId}::uuid, "mediaId", "startedAt" AT TIME ZONE 'UTC', "durationMs" FROM input
        ON CONFLICT ("screenId", "mediaId", "startedAt") DO NOTHING
        RETURNING "mediaId", "startedAt", "durationMs"
      ), daily AS (
        INSERT INTO "PlayDaily" ("day", "screenId", "mediaId", "screenName", "branchName", "mediaName", "plays", "durationMs", "updatedAt")
        SELECT (ins."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, ${screenId}::uuid, ins."mediaId",
               ${screenName}, ${branchName}, m."displayName", count(*)::int, sum(ins."durationMs")::bigint, now()
        FROM ins JOIN "Media" m ON m."id" = ins."mediaId"
        GROUP BY 1, ins."mediaId", m."displayName"
        ON CONFLICT ("day", "screenId", "mediaId") DO UPDATE SET
          "plays" = "PlayDaily"."plays" + EXCLUDED."plays",
          "durationMs" = "PlayDaily"."durationMs" + EXCLUDED."durationMs",
          "screenName" = EXCLUDED."screenName",
          "branchName" = EXCLUDED."branchName",
          "mediaName" = EXCLUDED."mediaName",
          "updatedAt" = now()
      )
      SELECT count(*)::int AS n FROM ins`;
    // Re-sent batches (the TV did not hear our reply) land here as already-recorded rows.
    return { accepted: n, skipped: entries.length - n };
  }

  /** Raw rows only back the de-duplication; daily totals are kept for good. */
  async prune(): Promise<void> {
    try {
      const { count } = await this.prisma.playLog.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - PLAYLOG_KEEP_DAYS * DAY_MS) } } });
      if (count) this.logger.log(`Pruned ${count} play logs older than ${PLAYLOG_KEEP_DAYS} days`);
    } catch (err) {
      this.logger.error('Play log prune failed', err as Error);
    }
  }

  // ---- Reports ----

  async report(q: PlayReportQueryDto, user: AuthUser): Promise<PlayReport> {
    const where = this.where(q, user);
    const [byMedia, byScreen, byDay] = await Promise.all([
      this.prisma.$queryRaw<{ mediaId: string | null; name: string; plays: number; durationMs: bigint; screens: number }[]>`
        SELECT d."mediaId", COALESCE(m."displayName", max(d."mediaName")) AS name,
               sum(d."plays")::int AS plays, sum(d."durationMs")::bigint AS "durationMs",
               count(DISTINCT COALESCE(d."screenId"::text, d."screenName"))::int AS screens
        FROM "PlayDaily" d
        LEFT JOIN "Media" m ON m."id" = d."mediaId"
        LEFT JOIN "Screen" s ON s."id" = d."screenId"
        WHERE ${where}
        GROUP BY d."mediaId", m."displayName", CASE WHEN d."mediaId" IS NULL THEN d."mediaName" END
        ORDER BY plays DESC, name`,
      this.prisma.$queryRaw<{ screenId: string | null; name: string; branch: string | null; plays: number; durationMs: bigint; ads: number }[]>`
        SELECT d."screenId", COALESCE(s."name", max(d."screenName")) AS name, COALESCE(b."name", max(d."branchName")) AS branch,
               sum(d."plays")::int AS plays, sum(d."durationMs")::bigint AS "durationMs",
               count(DISTINCT COALESCE(d."mediaId"::text, d."mediaName"))::int AS ads
        FROM "PlayDaily" d
        LEFT JOIN "Screen" s ON s."id" = d."screenId"
        LEFT JOIN "Branch" b ON b."id" = s."branchId"
        WHERE ${where}
        GROUP BY d."screenId", s."name", b."name", CASE WHEN d."screenId" IS NULL THEN d."screenName" END
        ORDER BY branch NULLS LAST, name`,
      this.prisma.$queryRaw<{ day: string; plays: number; durationMs: bigint }[]>`
        SELECT to_char(d."day", 'YYYY-MM-DD') AS day, sum(d."plays")::int AS plays, sum(d."durationMs")::bigint AS "durationMs"
        FROM "PlayDaily" d
        LEFT JOIN "Screen" s ON s."id" = d."screenId"
        WHERE ${where}
        GROUP BY d."day"
        ORDER BY d."day"`,
    ]);
    const plays = byMedia.reduce((a, r) => a + r.plays, 0);
    const durationMs = byMedia.reduce((a, r) => a + Number(r.durationMs), 0);
    return {
      from: q.from,
      to: q.to,
      totals: { plays, durationMs, screens: byScreen.length, ads: byMedia.length },
      byMedia: byMedia.map((r) => ({ ...r, durationMs: Number(r.durationMs) })),
      byScreen: byScreen.map((r) => ({ ...r, durationMs: Number(r.durationMs) })),
      byDay: byDay.map((r) => ({ ...r, durationMs: Number(r.durationMs) })),
    };
  }

  /** One row per day, screen and ad. UTF-8 with a BOM so Excel shows Gujarati names correctly. */
  async exportCsv(q: PlayReportQueryDto, user: AuthUser): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ day: string; branch: string | null; screen: string; ad: string; plays: number; durationMs: bigint }[]>`
      SELECT to_char(d."day", 'YYYY-MM-DD') AS day, COALESCE(b."name", d."branchName") AS branch,
             COALESCE(s."name", d."screenName") AS screen, COALESCE(m."displayName", d."mediaName") AS ad,
             d."plays", d."durationMs"
      FROM "PlayDaily" d
      LEFT JOIN "Screen" s ON s."id" = d."screenId"
      LEFT JOIN "Branch" b ON b."id" = s."branchId"
      LEFT JOIN "Media" m ON m."id" = d."mediaId"
      WHERE ${this.where(q, user)}
      ORDER BY d."day", branch NULLS LAST, screen, ad
      LIMIT ${MAX_EXPORT_ROWS}`;
    const lines = [['Date', 'Branch', 'Screen', 'Ad', 'Plays', 'Minutes on screen'].join(',')];
    for (const r of rows) {
      lines.push([r.day, r.branch ?? '', r.screen, r.ad, String(r.plays), (Number(r.durationMs) / 60_000).toFixed(1)].map(csvCell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  private where(q: Filter, user: AuthUser): Prisma.Sql {
    const from = Date.parse(`${q.from}T00:00:00Z`);
    const to = Date.parse(`${q.to}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) throw new BadRequestException('Not a real date');
    if (to < from) throw new BadRequestException('The end date is before the start date');
    if ((to - from) / DAY_MS + 1 > MAX_REPORT_DAYS) throw new BadRequestException(`A report can cover at most ${MAX_REPORT_DAYS} days`);
    const parts = [Prisma.sql`d."day" BETWEEN ${q.from}::date AND ${q.to}::date`];
    if (q.screenId) parts.push(Prisma.sql`d."screenId" = ${q.screenId}::uuid`);
    if (q.mediaId) parts.push(Prisma.sql`d."mediaId" = ${q.mediaId}::uuid`);
    if (q.branchId) parts.push(Prisma.sql`s."branchId" = ${q.branchId}::uuid`);
    if (!isHeadOffice(user)) parts.push(screenScopeSql(user, 's'));
    return Prisma.join(parts, ' AND ');
  }
}

/** Quotes a CSV cell, and stops Excel from reading a name like "=SUM(...)" as a formula. */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
