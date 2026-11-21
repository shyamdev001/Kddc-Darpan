import { Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { youtubeId, type Manifest, type ManifestApp, type ManifestBroadcast, type ManifestItem, type ManifestPlaylist, type ManifestSettings } from '@darpan/shared';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import { effectiveSeconds } from '../playlists/playlists.service';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { PlaylistResolver, screenPlaceSelect } from './playlist-resolver.service';

function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

/** A manifest built for a TV is reused for this long, unless content changes first. */
export const MANIFEST_CACHE_MS = 30_000;

@Injectable()
export class ManifestService implements OnModuleDestroy {
  // A content change sends "manifest:updated" to every affected TV, and each then fetches its
  // manifest: the one built for the push is kept and handed out, instead of building it twice.
  private readonly cache = new Map<string, { until: number; manifest: Manifest }>();
  // Bumped on every change, so a build that started before a change is never cached after it.
  private generation = 0;
  private readonly sub: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PlaylistResolver,
    events: ContentEvents,
  ) {
    this.sub = events.changes.subscribe((c) => this.invalidate(c.all ? null : c.screenIds));
  }

  onModuleDestroy() {
    this.sub.unsubscribe();
  }

  /** Forget cached manifests: of these screens, or all (null). */
  invalidate(screenIds: string[] | null): void {
    this.generation++;
    if (screenIds === null) this.cache.clear();
    else for (const id of screenIds) this.cache.delete(id);
  }

  /** For the TV's own fetch: the recently built manifest when nothing changed since, else a new one. */
  async forDevice(screenId: string, now = Date.now()): Promise<Manifest> {
    const hit = this.cache.get(screenId);
    if (hit && now < hit.until) return hit.manifest;
    return this.build(screenId);
  }

  /**
   * What this TV should play. It lists every playlist that may play (timed ones first, with their
   * time slots) so the TV can switch at the right moment on its own, even when offline.
   * Only processed (READY) files with a checksum are listed, and ads that have already ended are
   * left out. Upcoming ads are included with validFrom so the TV can download them early.
   */
  async build(screenId: string): Promise<Manifest> {
    const generation = this.generation;
    const manifest = await this.buildFresh(screenId);
    if (generation === this.generation) {
      // Never kept past a broadcast's end: the next fetch must already be without it.
      const ends = manifest.broadcast?.endsAt ? Date.parse(manifest.broadcast.endsAt) : Infinity;
      this.cache.set(screenId, { until: Math.min(Date.now() + MANIFEST_CACHE_MS, ends), manifest });
    }
    return manifest;
  }

  private async buildFresh(screenId: string): Promise<Manifest> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { ...screenPlaceSelect, orientation: true, testUpdates: true } });
    if (!screen) throw new NotFoundException();

    const now = new Date();
    const [layers, hours, broadcasts, pin] = await Promise.all([
      this.resolver.layers(screen, false, now),
      this.resolver.hours(screen),
      this.resolver.broadcastsMany([screen], now),
      this.prisma.kioskSettings.findUnique({ where: { id: 1 }, select: { pinSalt: true, pinHash: true, pinIterations: true } }),
    ]);

    const ids = [...new Set(layers.map((l) => l.playlistId))];
    const rows = await this.prisma.playlist.findMany({
      where: { id: { in: ids } },
      include: { items: { orderBy: { position: 'asc' }, include: { media: true } } },
    });
    const byId = new Map(rows.map((p) => [p.id, p]));

    const media = new Map<string, ManifestItem>();
    const playlists: ManifestPlaylist[] = [];
    for (const layer of layers) {
      const p = byId.get(layer.playlistId);
      if (!p) continue;
      const usable = p.items.filter(
        (i) => i.media.status === 'READY' && i.media.storageKey && i.media.sha256 && !(i.media.endDate && i.media.endDate < now),
      );
      // A timed playlist with nothing to show would leave the screen blank in its slot: skip it so the next one plays.
      if (!usable.length && layer.slots.length) continue;
      for (const i of usable) {
        if (media.has(i.media.id)) continue;
        media.set(i.media.id, {
          mediaId: i.media.id,
          url: `${publicBase()}/api/devices/media/${i.media.id}`,
          sha256: i.media.sha256!,
          size: Number(i.media.sizeBytes ?? 0),
          type: i.media.type,
          durationSec: effectiveSeconds(i, p.defaultImageSec),
          validFrom: i.media.startDate?.toISOString() ?? null,
          validUntil: i.media.endDate?.toISOString() ?? null,
        });
      }
      playlists.push({
        id: p.id,
        name: p.name,
        slots: layer.slots,
        items: usable.map((i) => ({ mediaId: i.media.id, durationSec: effectiveSeconds(i, p.defaultImageSec) })),
      });
    }

    // The default slide comes first, so a new TV downloads it before anything else.
    const fallback = await this.prisma.media.findFirst({
      where: { defaultSlide: true, status: 'READY', type: 'IMAGE', storageKey: { not: null }, sha256: { not: null } },
    });
    const fallbackItem: ManifestItem | null = fallback
      ? (media.get(fallback.id) ?? {
          mediaId: fallback.id,
          url: `${publicBase()}/api/devices/media/${fallback.id}`,
          sha256: fallback.sha256!,
          size: Number(fallback.sizeBytes ?? 0),
          type: fallback.type,
          durationSec: 10,
          validFrom: null,
          validUntil: null,
        })
      : null;
    const items = fallbackItem ? [fallbackItem, ...[...media.values()].filter((i) => i.mediaId !== fallbackItem.mediaId)] : [...media.values()];
    const fallbackMediaId = fallbackItem?.mediaId ?? null;
    const sync = screen.branchId ? ((await this.prisma.branch.findUnique({ where: { id: screen.branchId }, select: { syncPlayback: true } }))?.syncPlayback ?? false) : false;
    // The local unlock PIN (K1), as a salted hash the TV checks offline; never the PIN itself.
    const kioskPin = pin?.pinSalt && pin.pinHash && pin.pinIterations ? { salt: pin.pinSalt, hash: pin.pinHash, iterations: pin.pinIterations } : null;
    const settings: ManifestSettings = { orientation: screen.orientation, hours: hours?.hours ?? null, sync, kioskPin };
    const app = await this.appOffer(screen.testUpdates);
    const broadcast = toManifestBroadcast(broadcasts.get(screen.id) ?? null);
    // The version only changes when what the TV must do changes, so it can skip identical manifests.
    const version = createHash('sha256').update(JSON.stringify({ items, playlists, settings, app, broadcast, fallbackMediaId })).digest('hex').slice(0, 16);
    return { version, generatedAt: now.toISOString(), items, playlists, settings, app, broadcast, fallbackMediaId };
  }

  /** The newest app build offered to this screen: released to all, or in test and this is a test screen. */
  private async appOffer(testScreen: boolean): Promise<ManifestApp | null> {
    const r = await this.prisma.appRelease.findFirst({
      where: { stage: { in: testScreen ? ['ALL', 'TEST'] : ['ALL'] } },
      orderBy: { versionCode: 'desc' },
    });
    if (!r) return null;
    return {
      versionCode: r.versionCode,
      versionName: r.versionName,
      url: `${publicBase()}/api/devices/app/${r.id}`,
      sha256: r.sha256,
      size: Number(r.sizeBytes),
      installNow: r.installNow,
    };
  }
}

type BroadcastRow = Prisma.BroadcastGetPayload<{ include: { media: true } }>;

function toManifestBroadcast(b: BroadcastRow | null): ManifestBroadcast | null {
  if (!b) return null;
  const m = b.media;
  const media: ManifestItem | null =
    b.kind === 'MEDIA' && m && m.status === 'READY' && m.storageKey && m.sha256
      ? {
          mediaId: m.id,
          url: `${publicBase()}/api/devices/media/${m.id}`,
          sha256: m.sha256,
          size: Number(m.sizeBytes ?? 0),
          type: m.type,
          durationSec: m.durationSec ?? 10,
          validFrom: null,
          validUntil: null,
        }
      : null;
  const ytId = b.kind === 'LINK' && b.url ? (b.youtubeId ?? youtubeId(b.url)) : null;
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    message: b.message,
    media,
    link: b.kind !== 'LINK' || !b.url ? null : ytId ? { type: 'youtube', youtubeId: ytId } : { type: 'stream', url: b.url },
    muted: b.muted,
    startedAt: b.startedAt.toISOString(),
    endsAt: b.endsAt?.toISOString() ?? null,
  };
}
