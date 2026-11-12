import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isYoutubeHost, youtubeId, type BroadcastEntry, type BroadcastScreenCount, type BroadcastsResponse, type PlaylistSource } from '@darpan/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlaylistResolver, screenPlaceSelect } from '../screens/playlist-resolver.service';
import type { StartBroadcastDto } from './broadcast.dto';

const include = {
  media: { select: { id: true, originalName: true, displayName: true, type: true } },
  screen: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  taluka: { select: { id: true, name: true } },
  region: { select: { id: true, name: true } },
  startedBy: { select: { name: true } },
  endedBy: { select: { name: true } },
} as const;
type Row = Prisma.BroadcastGetPayload<{ include: typeof include }>;

const RECENT = 20;

/** Urgent messages and live streams that take over screens. Head office only (see controller). */
@Injectable()
export class BroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
    private readonly resolver: PlaylistResolver,
  ) {}

  async list(): Promise<BroadcastsResponse> {
    const now = new Date();
    const running = { endedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } satisfies Prisma.BroadcastWhereInput;
    const [active, recent] = await Promise.all([
      this.prisma.broadcast.findMany({ where: running, include, orderBy: { startedAt: 'desc' } }),
      this.prisma.broadcast.findMany({ where: { NOT: running }, include, orderBy: { startedAt: 'desc' }, take: RECENT }),
    ]);
    const counts = await this.screenCounts(active.map((b) => b.id), now);
    return {
      active: active.map((b) => toEntry(b, true, counts.get(b.id))),
      recent: recent.map((b) => toEntry(b, false)),
    };
  }

  async start(dto: StartBroadcastDto, user: AuthUser, ip?: string): Promise<BroadcastsResponse> {
    const target = await this.target(dto.level, dto.targetId);
    const title = clean(dto.title);
    const message = clean(dto.message);
    let url: string | null = null;
    let ytId: string | null = null;

    if (dto.kind === 'MESSAGE' && !message) throw new BadRequestException('Type the message to show');
    if (dto.kind === 'MEDIA') {
      const m = await this.prisma.media.findUnique({ where: { id: dto.mediaId } });
      if (!m) throw new BadRequestException('That poster or video no longer exists');
      if (m.status !== 'READY' || !m.sha256) throw new BadRequestException('That file is still being processed. Try again in a minute.');
    }
    if (dto.kind === 'LINK') {
      url = (dto.url ?? '').trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new BadRequestException('That is not a full link. It should start with https://');
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new BadRequestException('Only http and https links can be played');
      if (isYoutubeHost(url)) {
        ytId = youtubeId(url);
        if (!ytId) {
          throw new BadRequestException(
            'This YouTube link does not point to one video. Open the live video itself, press Share, and paste that link.',
          );
        }
      }
    }

    const b = await this.prisma.broadcast.create({
      data: {
        kind: dto.kind,
        title,
        message,
        mediaId: dto.kind === 'MEDIA' ? dto.mediaId : null,
        url,
        youtubeId: ytId,
        muted: dto.muted ?? false,
        targetType: dto.level,
        ...target.fields,
        endsAt: dto.durationMin ? new Date(Date.now() + dto.durationMin * 60_000) : null,
        startedById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'broadcast.start',
      entityType: 'Broadcast',
      entityId: b.id,
      details: { kind: b.kind, where: target.name, title, message, url, mediaId: b.mediaId, muted: b.muted, endsAt: b.endsAt?.toISOString() ?? null },
      ipAddress: ip,
    });
    await this.notify(target.screens);
    return this.list();
  }

  async stop(id: string, user: AuthUser, ip?: string): Promise<BroadcastsResponse> {
    const b = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Broadcast not found');
    if (b.endedAt || (b.endsAt && b.endsAt <= new Date())) throw new BadRequestException('This broadcast has already ended');
    await this.prisma.broadcast.update({ where: { id }, data: { endedAt: new Date(), endedById: user.id } });
    await this.audit.log({ userId: user.id, action: 'broadcast.stop', entityType: 'Broadcast', entityId: id, details: { title: b.title, kind: b.kind }, ipAddress: ip });
    const level = b.targetType as PlaylistSource;
    await this.notify(this.screensWhere(level, b));
    return this.list();
  }

  /** For each running broadcast: the screens showing it now, by what their TVs report. */
  private async screenCounts(ids: string[], now: Date) {
    const out = new Map<string, { count: BroadcastScreenCount; problems: { screen: string; status: string }[] }>();
    if (!ids.length) return out;
    const screens = await this.prisma.screen.findMany({
      where: { status: { not: 'PENDING' } },
      select: { ...screenPlaceSelect, name: true, status: true, broadcastId: true, broadcastStatus: true },
    });
    const winners = await this.resolver.broadcastsMany(screens, now);
    for (const id of ids) out.set(id, { count: { total: 0, playing: 0, loading: 0, error: 0, waiting: 0 }, problems: [] });
    for (const s of screens) {
      const w = winners.get(s.id);
      const entry = w ? out.get(w.id) : undefined;
      if (!entry) continue;
      const c = entry.count;
      c.total++;
      const status = s.broadcastId === w!.id ? (s.broadcastStatus ?? '') : '';
      if (s.status !== 'ONLINE' || !status) c.waiting++;
      else if (status === 'playing') c.playing++;
      else if (status.startsWith('error')) {
        c.error++;
        if (entry.problems.length < 5) entry.problems.push({ screen: s.name ?? 'Unnamed screen', status: status.replace(/^error:\s*/, '') });
      } else c.loading++;
    }
    return out;
  }

  private async target(level: PlaylistSource, id: string | undefined) {
    const missing = () => new BadRequestException('That place or screen no longer exists. Reload and try again.');
    switch (level) {
      case 'ALL':
        return { fields: {}, name: 'Every screen', screens: {} as Prisma.ScreenWhereInput };
      case 'REGION': {
        const r = await this.prisma.region.findUnique({ where: { id } });
        if (!r) throw missing();
        return { fields: { regionId: r.id }, name: r.name, screens: this.screensWhere(level, { regionId: r.id }) };
      }
      case 'TALUKA': {
        const t = await this.prisma.taluka.findUnique({ where: { id } });
        if (!t) throw missing();
        return { fields: { talukaId: t.id }, name: t.name, screens: this.screensWhere(level, { talukaId: t.id }) };
      }
      case 'BRANCH': {
        const b = await this.prisma.branch.findUnique({ where: { id } });
        if (!b) throw missing();
        return { fields: { branchId: b.id }, name: b.name, screens: this.screensWhere(level, { branchId: b.id }) };
      }
      case 'SCREEN': {
        const s = await this.prisma.screen.findUnique({ where: { id } });
        if (!s || s.name === null) throw missing();
        return { fields: { screenId: s.id }, name: s.name, screens: this.screensWhere(level, { screenId: s.id }) };
      }
    }
  }

  private screensWhere(
    level: PlaylistSource,
    ids: { screenId?: string | null; branchId?: string | null; talukaId?: string | null; regionId?: string | null },
  ): Prisma.ScreenWhereInput {
    switch (level) {
      case 'SCREEN':
        return { id: ids.screenId ?? undefined };
      case 'BRANCH':
        return { branchId: ids.branchId ?? undefined };
      case 'TALUKA':
        return { branch: { talukaId: ids.talukaId ?? undefined } };
      case 'REGION':
        return { branch: { taluka: { regionId: ids.regionId ?? undefined } } };
      default:
        return {};
    }
  }

  private async notify(where: Prisma.ScreenWhereInput) {
    const rows = await this.prisma.screen.findMany({ where: { ...where, status: { not: 'PENDING' } }, select: { id: true } });
    this.events.screensChanged(...rows.map((r) => r.id));
  }
}

function clean(s: string | undefined): string | null {
  const t = s?.replace(/\r\n/g, '\n').trim();
  return t ? t : null;
}

function toEntry(b: Row, active: boolean, status?: { count: BroadcastScreenCount; problems: { screen: string; status: string }[] }): BroadcastEntry {
  const target = b.screen ?? b.branch ?? b.taluka ?? b.region;
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    message: b.message,
    media: b.media ? { id: b.media.id, name: b.media.displayName ?? b.media.originalName, type: b.media.type } : null,
    url: b.url,
    isYoutube: !!b.youtubeId,
    muted: b.muted,
    level: b.targetType as PlaylistSource,
    target: target ? { id: target.id, name: target.name ?? 'Unnamed screen' } : null,
    startedAt: b.startedAt.toISOString(),
    endsAt: b.endsAt?.toISOString() ?? null,
    endedAt: b.endedAt?.toISOString() ?? null,
    startedBy: b.startedBy?.name ?? null,
    endedBy: b.endedBy?.name ?? null,
    active,
    screens: active ? (status?.count ?? { total: 0, playing: 0, loading: 0, error: 0, waiting: 0 }) : null,
    problems: status?.problems ?? [],
  };
}
