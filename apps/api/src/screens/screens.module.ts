import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { DevicesController } from './devices.controller';
import { ManifestService } from './manifest.service';
import { PlaylistResolver } from './playlist-resolver.service';
import { ScreensController } from './screens.controller';
import { ScreensService } from './screens.service';
import { DeviceGuard } from './device-auth';
import { DevicesGateway } from './devices.gateway';
import { CommandsService } from './commands.service';

@Module({
  imports: [MediaModule],
  controllers: [ScreensController, DevicesController],
  providers: [ScreensService, ManifestService, PlaylistResolver, DeviceGuard, DevicesGateway, CommandsService],
  exports: [ManifestService, PlaylistResolver],
})
export class ScreensModule {}
