import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { DeviceStatusResponse, Manifest, RegisterDeviceResponse } from '@darpan/shared';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators';
import { mediaTmpDir } from '../media/media.constants';
import { MediaService } from '../media/media.service';
import { CommandsService } from './commands.service';
import { DeviceGuard } from './device-auth';
import { ManifestService } from './manifest.service';
import { RegisterDeviceDto } from './screen.dto';
import { ScreensService } from './screens.service';

/** Routes the TV app calls. Authenticated by device token, not by a user session. */
@Public()
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly screens: ScreensService,
    private readonly manifests: ManifestService,
    private readonly media: MediaService,
    private readonly commands: CommandsService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@Body() dto: RegisterDeviceDto, @Req() req: Request): Promise<RegisterDeviceResponse> {
    return this.screens.register(dto, req.ip);
  }

  @Get('status')
  @UseGuards(DeviceGuard)
  status(@Req() req: Request): Promise<DeviceStatusResponse> {
    return this.screens.deviceStatus(req.screen!.id);
  }

  @Get('manifest')
  @UseGuards(DeviceGuard)
  manifest(@Req() req: Request): Promise<Manifest> {
    if (req.screen!.status === 'PENDING') throw new ForbiddenException('Screen is not paired yet');
    return this.manifests.build(req.screen!.id);
  }

  /** Media download for TVs. sendFile supports Range, so interrupted downloads can resume. */
  @SkipThrottle()
  @Get('media/:id')
  @UseGuards(DeviceGuard)
  async file(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    if (req.screen!.status === 'PENDING') throw new ForbiddenException('Screen is not paired yet');
    const { path, mime } = await this.media.filePath(id, 'file').catch(() => {
      throw new NotFoundException('Media not found');
    });
    res.sendFile(path, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  }

  /** Screenshot the dashboard asked for (command `screenshot`). JPEG or PNG, at most 8 MB. */
  @Post('commands/:commandId/screenshot')
  @HttpCode(204)
  @UseGuards(DeviceGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: (_req, _file, cb) => cb(null, mediaTmpDir()), filename: (_req, _file, cb) => cb(null, `shot-${randomUUID()}`) }),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  async screenshot(@Param('commandId', ParseUUIDPipe) commandId: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    await this.commands.saveScreenshot(req.screen!.id, commandId, file?.path);
  }
}
