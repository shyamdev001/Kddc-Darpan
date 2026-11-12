import { Injectable, NotFoundException } from '@nestjs/common';
import { youtubeId, type Manifest, type ManifestApp, type ManifestBroadcast, type ManifestItem, type ManifestPlaylist, type ManifestSettings } from '@darpan/shared';
import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import { effectiveSeconds } from '../playlists/playlists.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlaylistResolver, screenPlaceSelect } from './playlist-resolver.service';

function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

@Injectable()
export class ManifestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PlaylistResolver,
  ) {}

  /**
   * What this TV should play. It lists every playlist that may play (timed ones first, with their
   * time slots) so the TV can switch at the right moment on its own, even when offline.
   * Only processed (READY) files with a checksum are listed, and ads that have already ended are
   * left out. Upcoming ads are included with validFrom so the TV can download them early.
   */
  async build(screenId: string): Promise<Manifest> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { ...screenPlaceSelect, orientation: true, testUpdates: true } });
    if (!screen) throw new NotFoundException();

    const now = new Date();
    const [layers, hours, broadcasts] = await Promise.all([
      this.resolver.layers(screen, false, now),
      this.resolver.hours(screen),
      this.resolver.broadcastsMany([screen], now),
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

    const items = [...media.values()];
    const settings: ManifestSettings = { orientation: screen.orientation, hours: hours?.hours ?? null };
    const app = await this.appOffer(screen.testUpdates);
    const broadcast = toManifestBroadcast(broadcasts.get(screen.id) ?? null);
    // The version only changes when what the TV must do changes, so it can skip identical manifests.
    const version = createHash('sha256').update(JSON.stringify({ items, playlists, settings, app, broadcast })).digest('hex').slice(0, 16);
    return { version, generatedAt: now.toISOString(), items, playlists, settings, app, broadcast };
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
    endsAt: b.endsAt?.toISOString() ?? null,
  };
}
