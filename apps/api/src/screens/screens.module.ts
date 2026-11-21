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
import { KioskService } from './kiosk.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MediaModule, AuthModule],
  controllers: [ScreensController, DevicesController],
  providers: [ScreensService, ManifestService, PlaylistResolver, DeviceGuard, DevicesGateway, CommandsService, KioskService],
  exports: [ManifestService, PlaylistResolver],
})
export class ScreensModule {}
