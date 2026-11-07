import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlaylistDetail, PlaylistSummary } from '@darpan/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';
import { MediaService, mediaInclude } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePlaylistDto, UpdatePlaylistDto } from './playlist.dto';

const detailInclude = {
  createdBy: { select: { name: true } },
  _count: { select: { assignments: true } },
  items: { orderBy: { position: 'asc' }, include: { media: { include: mediaInclude } } },
} satisfies Prisma.PlaylistInclude;

type PlaylistRow = Prisma.PlaylistGetPayload<{ include: typeof detailInclude }>;
type ItemRow = PlaylistRow['items'][number];

/** Seconds this item stays on screen. Videos play their full length unless trimmed by an override. */
export function effectiveSeconds(item: { durationSec: number | null; media: { type: string; durationSec: number | null } }, defaultImageSec: number): number {
  if (item.media.type === 'VIDEO') return item.durationSec ?? item.media.durationSec ?? defaultImageSec;
  return item.durationSec ?? defaultImageSec;
}

function needsAttention(item: ItemRow, now: number): boolean {
  const m = item.media;
  return m.status === 'FAILED' || (m.endDate !== null && m.endDate.getTime() < now);
}

@Injectable()
export class PlaylistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  private summarise(p: PlaylistRow): Omit<PlaylistSummary, 'previews'> {
    const now = Date.now();
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      defaultImageSec: p.defaultImageSec,
      itemCount: p.items.length,
      loopSec: p.items.reduce((sum, i) => sum + effectiveSeconds(i, p.defaultImageSec), 0),
      assignmentCount: p._count.assignments,
      attentionCount: p.items.filter((i) => needsAttention(i, now)).length,
      updatedAt: p.updatedAt.toISOString(),
      createdBy: p.createdBy?.name ?? null,
    };
  }

  private toDetail(p: PlaylistRow): PlaylistDetail {
    return {
      ...this.summarise(p),
      items: p.items.map((i) => ({
        id: i.id,
        position: i.position,
        durationSec: i.durationSec,
        effectiveSec: effectiveSeconds(i, p.defaultImageSec),
        media: this.media.toItem(i.media),
      })),
    };
  }

  async list(): Promise<PlaylistSummary[]> {
    const rows = await this.prisma.playlist.findMany({ include: detailInclude, orderBy: { updatedAt: 'desc' } });
    return rows.map((p) => ({
      ...this.summarise(p),
      previews: p.items
        .filter((i) => i.media.thumbKey)
        .slice(0, 4)
        .map((i) => this.media.toItem(i.media).thumbUrl!),
    }));
  }

  async get(id: string): Promise<PlaylistDetail> {
    return this.toDetail(await this.load(id));
  }

  private async load(id: string): Promise<PlaylistRow> {
    const p = await this.prisma.playlist.findUnique({ where: { id }, include: detailInclude });
    if (!p) throw new NotFoundException('Playlist not found');
    return p;
  }

  async create(dto: CreatePlaylistDto, user: AuthUser, ip?: string): Promise<PlaylistDetail> {
    const p = await this.prisma.playlist.create({
      data: { name: dto.name, description: dto.description ?? null, defaultImageSec: dto.defaultImageSec ?? 10, createdById: user.id },
      include: detailInclude,
    });
    await this.audit.log({ userId: user.id, action: 'playlist.create', entityType: 'Playlist', entityId: p.id, details: { name: p.name }, ipAddress: ip });
    return this.toDetail(p);
  }

  async update(id: string, dto: UpdatePlaylistDto, user: AuthUser, ip?: string): Promise<PlaylistDetail> {
    const before = await this.load(id);

    if (dto.items) {
      const ids = [...new Set(dto.items.map((i) => i.mediaId))];
      const found = await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, displayName: true } });
      const missing = ids.filter((mid) => !found.some((f) => f.id === mid));
      if (missing.length) throw new BadRequestException('Some media in this playlist no longer exists. Reload the page and try again.');
      const failed = found.filter((f) => f.status === 'FAILED');
      if (failed.length) throw new BadRequestException(`"${failed[0]!.displayName}" failed processing and cannot be added.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.playlistItem.deleteMany({ where: { playlistId: id } });
        if (dto.items.length) {
          await tx.playlistItem.createMany({
            data: dto.items.map((i, position) => ({ playlistId: id, mediaId: i.mediaId, position, durationSec: i.durationSec })),
          });
        }
      }
      return tx.playlist.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          defaultImageSec: dto.defaultImageSec,
          updatedAt: new Date(), // bump even when only items changed
        },
        include: detailInclude,
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'playlist.update',
      entityType: 'Playlist',
      entityId: id,
      details: {
        before: { name: before.name, defaultImageSec: before.defaultImageSec, items: before.items.map((i) => [i.mediaId, i.durationSec]) },
        after: { name: updated.name, defaultImageSec: updated.defaultImageSec, items: updated.items.map((i) => [i.mediaId, i.durationSec]) },
      },
      ipAddress: ip,
    });
    return this.toDetail(updated);
  }

  async duplicate(id: string, user: AuthUser, ip?: string): Promise<PlaylistDetail> {
    const src = await this.load(id);
    const copy = await this.prisma.playlist.create({
      data: {
        name: `${src.name} (copy)`.slice(0, 120),
        description: src.description,
        defaultImageSec: src.defaultImageSec,
        createdById: user.id,
        items: { create: src.items.map((i) => ({ mediaId: i.mediaId, position: i.position, durationSec: i.durationSec })) },
      },
      include: detailInclude,
    });
    await this.audit.log({ userId: user.id, action: 'playlist.duplicate', entityType: 'Playlist', entityId: copy.id, details: { from: id }, ipAddress: ip });
    return this.toDetail(copy);
  }

  async remove(id: string, user: AuthUser, ip?: string): Promise<void> {
    const p = await this.load(id);
    if (p._count.assignments > 0) {
      throw new ConflictException(`"${p.name}" is assigned to screens. Unassign it before deleting.`);
    }
    await this.prisma.playlist.delete({ where: { id } }); // items cascade
    await this.audit.log({ userId: user.id, action: 'playlist.delete', entityType: 'Playlist', entityId: id, details: { name: p.name, items: p.items.length }, ipAddress: ip });
  }
}
