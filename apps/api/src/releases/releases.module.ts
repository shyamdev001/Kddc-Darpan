import { Module } from '@nestjs/common';
import { AppDownloadController, ReleasesController } from './releases.controller';
import { ReleasesService } from './releases.service';

@Module({
  controllers: [ReleasesController, AppDownloadController],
  providers: [ReleasesService],
})
export class ReleasesModule {}
