import { Injectable, NotFoundException } from '@nestjs/common';
import type { Manifest, ManifestItem, ManifestPlaylist, ManifestSettings } from '@darpan/shared';
import { createHash } from 'node:crypto';
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
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { ...screenPlaceSelect, orientation: true } });
    if (!screen) throw new NotFoundException();

    const now = new Date();
    const [layers, hours] = await Promise.all([this.resolver.layers(screen, false, now), this.resolver.hours(screen)]);

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
    // The version only changes when what the TV must do changes, so it can skip identical manifests.
    const version = createHash('sha256').update(JSON.stringify({ items, playlists, settings })).digest('hex').slice(0, 16);
    return { version, generatedAt: now.toISOString(), items, playlists, settings };
  }
}
