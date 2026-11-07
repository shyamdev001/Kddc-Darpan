import { Inject, Injectable, Logger } from '@nestjs/common';
import { mkdtemp, rm, stat } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE, type StorageDriver } from '../storage/storage.types';
import { sha256File } from './file-utils';
import { mediaTmpDir } from './media.constants';
import { transcodeImage, transcodeVideo } from './transcode';

/** Processes one media item. Called by the queue worker, one job at a time. */
@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async process(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return; // deleted while queued
    if (media.status === 'READY') return;

    await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'PROCESSING', errorMessage: null } });
    const started = Date.now();
    const workDir = await mkdtemp(join(mediaTmpDir(), `job-${mediaId.slice(0, 8)}-`));
    const original = await this.storage.getLocalCopy(media.originalKey);

    try {
      const result =
        media.type === 'IMAGE'
          ? await transcodeImage(original.path, workDir, mediaId)
          : await transcodeVideo(original.path, workDir, mediaId);

      const [sha256, { size }] = await Promise.all([sha256File(result.outPath), stat(result.outPath)]);
      const storageKey = `media/${mediaId}${result.extension}`;
      const thumbKey = `thumbs/${mediaId}.webp`;
      await this.storage.putFile(storageKey, result.outPath, result.mimeType);
      await this.storage.putFile(thumbKey, result.thumbPath, 'image/webp');

      await this.prisma.media.update({
        where: { id: mediaId },
        data: {
          status: 'READY',
          storageKey,
          thumbKey,
          mimeType: result.mimeType,
          sizeBytes: BigInt(size),
          sha256,
          width: result.width,
          height: result.height,
          durationSec: result.durationSec,
          errorMessage: null,
        },
      });
      this.logger.log(`Processed ${media.type.toLowerCase()} ${mediaId} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      this.logger.warn(`Processing failed for ${mediaId}: ${message}`);
      // A bad file fails the same way every time, so record it instead of retrying.
      await this.prisma.media.update({ where: { id: mediaId }, data: { status: 'FAILED', errorMessage: message } }).catch(() => undefined);
    } finally {
      await original.release();
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
