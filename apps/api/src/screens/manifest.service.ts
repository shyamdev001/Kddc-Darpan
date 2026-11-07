import { Injectable, NotFoundException } from '@nestjs/common';
import type { Manifest, ManifestItem } from '@darpan/shared';
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
   * What this TV should play. Only processed (READY) files with a checksum are listed, and ads
   * that have already ended are left out. Upcoming ads are included with validFrom so the TV can
   * download them early and start them on time, even if it is offline that day.
   */
  async build(screenId: string): Promise<Manifest> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { ...screenPlaceSelect, orientation: true } });
    if (!screen) throw new NotFoundException();

    const resolved = await this.resolver.resolve(screen);
    const now = new Date();
    let items: ManifestItem[] = [];

    if (resolved) {
      const playlist = await this.prisma.playlist.findUnique({
        where: { id: resolved.playlistId },
        include: { items: { orderBy: { position: 'asc' }, include: { media: true } } },
      });
      items = (playlist?.items ?? [])
        .filter((i) => i.media.status === 'READY' && i.media.storageKey && i.media.sha256 && !(i.media.endDate && i.media.endDate < now))
        .map((i) => ({
          mediaId: i.media.id,
          url: `${publicBase()}/api/devices/media/${i.media.id}`,
          sha256: i.media.sha256!,
          size: Number(i.media.sizeBytes ?? 0),
          type: i.media.type,
          durationSec: effectiveSeconds(i, playlist!.defaultImageSec),
          validFrom: i.media.startDate?.toISOString() ?? null,
          validUntil: i.media.endDate?.toISOString() ?? null,
        }));
    }

    const settings = { orientation: screen.orientation };
    // The version only changes when what the TV must do changes, so it can skip identical manifests.
    const version = createHash('sha256').update(JSON.stringify({ items, settings })).digest('hex').slice(0, 16);
    return { version, generatedAt: now.toISOString(), items, schedule: [], settings };
  }
}
