import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MediaItem, MediaListResponse, UploadResult } from '@darpan/shared';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { extname } from 'path';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE, type StorageDriver } from '../storage/storage.types';
import { decodeUploadName, displayNameFrom, sha256File } from './file-utils';
import { MediaQueueService } from './media-queue.service';
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, VIDEO_EXTENSIONS } from './media.constants';
import type { ListMediaQuery, UpdateMediaDto } from './media.dto';

export const mediaInclude = {
  uploadedBy: { select: { name: true } },
  playlistItems: { select: { playlistId: true } },
} satisfies Prisma.MediaInclude;

type MediaRow = Prisma.MediaGetPayload<{ include: typeof mediaInclude }>;

/** Number of distinct playlists using this media (one playlist may repeat an item). */
function playlistCount(m: MediaRow): number {
  return new Set(m.playlistItems.map((i) => i.playlistId)).size;
}

const MB = 1024 * 1024;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: MediaQueueService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly events: ContentEvents,
  ) {}

  toItem(m: MediaRow): MediaItem {
    const v = m.updatedAt.getTime();
    return {
      id: m.id,
      displayName: m.displayName,
      originalName: m.originalName,
      type: m.type,
      status: m.status,
      errorMessage: m.errorMessage,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      sizeBytes: Number(m.sizeBytes ?? m.originalSizeBytes),
      originalSizeBytes: Number(m.originalSizeBytes),
      startDate: m.startDate?.toISOString() ?? null,
      endDate: m.endDate?.toISOString() ?? null,
      tags: m.tags,
      usedInPlaylists: playlistCount(m),
      uploadedBy: m.uploadedBy?.name ?? null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      thumbUrl: m.thumbKey ? `/api/media/${m.id}/thumbnail?v=${v}` : null,
      fileUrl: m.storageKey ? `/api/media/${m.id}/file?v=${v}` : null,
    };
  }

  async list(query: ListMediaQuery): Promise<MediaListResponse> {
    const where: Prisma.MediaWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    const q = query.q?.normalize('NFC').trim();
    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { originalName: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    const [rows, grouped] = await Promise.all([
      this.prisma.media.findMany({ where, include: mediaInclude, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.media.groupBy({ by: ['type', 'status'], _count: { _all: true }, orderBy: { type: 'asc' } }),
    ]);

    const counts = { all: 0, images: 0, videos: 0, processing: 0, failed: 0 };
    for (const g of grouped) {
      const n = (g._count as { _all: number })._all;
      counts.all += n;
      if (g.type === 'IMAGE') counts.images += n;
      else counts.videos += n;
      if (g.status === 'UPLOADED' || g.status === 'PROCESSING') counts.processing += n;
      if (g.status === 'FAILED') counts.failed += n;
    }
    return { items: rows.map((r) => this.toItem(r)), counts };
  }

  async get(id: string): Promise<MediaRow> {
    const media = await this.prisma.media.findUnique({ where: { id }, include: mediaInclude });
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  async upload(files: Express.Multer.File[], user: AuthUser, ip?: string): Promise<UploadResult> {
    const result: UploadResult = { created: [], duplicates: [], rejected: [] };

    for (const file of files) {
      const fileName = decodeUploadName(file.originalname);
      try {
        const ext = extname(fileName).toLowerCase();
        const type = IMAGE_EXTENSIONS.has(ext) ? 'IMAGE' : VIDEO_EXTENSIONS.has(ext) ? 'VIDEO' : null;
        if (!type) {
          result.rejected.push({ fileName, reason: 'Only JPG, PNG, WebP images and MP4, MOV, M4V, WebM videos can be uploaded.' });
          continue;
        }
        const limit = type === 'IMAGE' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        if (file.size > limit) {
          result.rejected.push({ fileName, reason: `${type === 'IMAGE' ? 'Images' : 'Videos'} can be up to ${limit / MB} MB.` });
          continue;
        }
        if (file.size === 0) {
          result.rejected.push({ fileName, reason: 'The file is empty.' });
          continue;
        }

        const originalSha256 = await sha256File(file.path);
        const existing = await this.prisma.media.findFirst({ where: { originalSha256 }, select: { id: true, displayName: true } });
        if (existing) {
          result.duplicates.push({ fileName, existingId: existing.id, existingName: existing.displayName });
          continue;
        }

        const id = randomUUID();
        const originalKey = `originals/${id}${ext}`;
        await this.storage.putFile(originalKey, file.path, file.mimetype);

        const media = await this.prisma.media.create({
          data: {
            id,
            originalName: fileName,
            displayName: displayNameFrom(fileName),
            type,
            status: 'UPLOADED',
            originalKey,
            originalSha256,
            originalSizeBytes: BigInt(file.size),
            originalMimeType: file.mimetype || 'application/octet-stream',
            uploadedById: user.id,
          },
          include: mediaInclude,
        });
        await this.audit.log({
          userId: user.id,
          action: 'media.upload',
          entityType: 'Media',
          entityId: id,
          details: { fileName, type, sizeBytes: file.size },
          ipAddress: ip,
        });
        await this.queue.enqueue(id);
        result.created.push(this.toItem(media));
      } finally {
        await rm(file.path, { force: true }); // no-op if it was moved into storage
      }
    }
    return result;
  }

  async update(id: string, dto: UpdateMediaDto, user: AuthUser, ip?: string): Promise<MediaItem> {
    const before = await this.get(id);
    const data: Prisma.MediaUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.tags !== undefined) {
      data.tags = [...new Set(dto.tags.map((t) => t.normalize('NFC').trim()).filter(Boolean))];
    }

    const start = data.startDate !== undefined ? (data.startDate as Date | null) : before.startDate;
    const end = data.endDate !== undefined ? (data.endDate as Date | null) : before.endDate;
    if (start && end && end <= start) throw new BadRequestException('The end date must be after the start date.');

    const media = await this.prisma.media.update({ where: { id }, data, include: mediaInclude });
    await this.audit.log({
      userId: user.id,
      action: 'media.update',
      entityType: 'Media',
      entityId: id,
      details: {
        before: { displayName: before.displayName, startDate: before.startDate, endDate: before.endDate, tags: before.tags },
        after: { displayName: media.displayName, startDate: media.startDate, endDate: media.endDate, tags: media.tags },
      } as unknown as Prisma.InputJsonValue,
      ipAddress: ip,
    });
    this.events.contentChanged(); // ad dates or name may change what screens play
    return this.toItem(media);
  }

  async retry(id: string, user: AuthUser, ip?: string): Promise<MediaItem> {
    const media = await this.get(id);
    if (media.status !== 'FAILED') throw new ConflictException('Only media that failed processing can be retried.');
    const updated = await this.prisma.media.update({
      where: { id },
      data: { status: 'UPLOADED', errorMessage: null },
      include: mediaInclude,
    });
    await this.queue.enqueue(id);
    await this.audit.log({ userId: user.id, action: 'media.retry', entityType: 'Media', entityId: id, ipAddress: ip });
    return this.toItem(updated);
  }

  async remove(id: string, user: AuthUser, ip?: string): Promise<void> {
    const media = await this.get(id);
    const uses = playlistCount(media);
    if (uses > 0) {
      throw new ConflictException(`Remove "${media.displayName}" from ${uses} playlist${uses === 1 ? '' : 's'} before deleting it.`);
    }
    await this.prisma.media.delete({ where: { id } });
    await Promise.all(
      [media.originalKey, media.storageKey, media.thumbKey]
        .filter((k): k is string => !!k)
        .map((k) => this.storage.delete(k).catch(() => undefined)),
    );
    await this.audit.log({
      userId: user.id,
      action: 'media.delete',
      entityType: 'Media',
      entityId: id,
      details: { displayName: media.displayName, originalName: media.originalName },
      ipAddress: ip,
    });
  }

  /** Absolute path for streaming to the dashboard (local driver only for now). */
  async filePath(id: string, which: 'file' | 'thumbnail'): Promise<{ path: string; mime: string }> {
    const media = await this.prisma.media.findUnique({ where: { id }, select: { storageKey: true, thumbKey: true, mimeType: true } });
    const key = which === 'file' ? media?.storageKey : media?.thumbKey;
    if (!media || !key) throw new NotFoundException(which === 'file' ? 'This media is not ready yet' : 'No thumbnail yet');
    const path = this.storage.localPath(key);
    if (!path) throw new NotFoundException('File is in remote storage');
    return { path, mime: which === 'file' ? (media.mimeType ?? 'application/octet-stream') : 'image/webp' };
  }
}
