import { Module } from '@nestjs/common';
import { MediaProcessingService } from './media-processing.service';
import { MediaQueueService } from './media-queue.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaQueueService, MediaProcessingService],
  exports: [MediaService],
})
export class MediaModule {}
