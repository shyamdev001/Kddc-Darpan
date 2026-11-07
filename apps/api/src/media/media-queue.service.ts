import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { MediaProcessingService } from './media-processing.service';
import { MEDIA_QUEUE } from './media.constants';

interface MediaJob {
  mediaId: string;
}

/**
 * Background jobs live in PostgreSQL (pg-boss schema "pgboss"), so queued work survives a restart
 * and there is no Redis to run. One media item is processed at a time to keep the machine responsive.
 */
@Injectable()
export class MediaQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaQueueService.name);
  private readonly boss: PgBoss;

  constructor(private readonly processing: MediaProcessingService) {
    this.boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: 'pgboss' });
    this.boss.on('error', (err: Error) => this.logger.error(`Queue error: ${err.message}`));
  }

  async onModuleInit() {
    await this.boss.start();
    if (!(await this.boss.getQueue(MEDIA_QUEUE))) {
      await this.boss.createQueue(MEDIA_QUEUE, {
        retryLimit: 1, // only if the API stopped mid-job; bad files are marked FAILED instead
        retryDelay: 30,
        expireInSeconds: 60 * 60, // a long video conversion can take a while
      });
    }
    await this.boss.work<MediaJob>(MEDIA_QUEUE, { batchSize: 1, localConcurrency: 1 }, async ([job]) => {
      if (job) await this.processing.process(job.data.mediaId);
    });
    this.logger.log('Media processing worker started');
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  }

  async enqueue(mediaId: string): Promise<void> {
    await this.boss.send(MEDIA_QUEUE, { mediaId }, { singletonKey: mediaId });
  }
}
