import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { MAX_APK_BYTES } from '@darpan/shared';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { mediaTmpDir } from '../media/media.constants';
import { DeviceGuard } from '../screens/device-auth';
import { SetTestScreensDto, UpdateReleaseDto, UploadReleaseDto } from './release.dto';
import { ReleasesService } from './releases.service';

@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @Roles('HO_ADMIN')
  list() {
    return this.releases.overview();
  }

  @Post()
  @Roles('HO_ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, mediaTmpDir()),
        filename: (_req, _file, cb) => cb(null, `apk-${randomUUID()}`),
      }),
      limits: { fileSize: MAX_APK_BYTES, files: 1 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: UploadReleaseDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.releases.upload(file, dto.notes, user, req.ip);
  }

  @Put('test-screens')
  @Roles('HO_ADMIN')
  setTestScreens(@Body() dto: SetTestScreensDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.releases.setTestScreens(dto.screenIds, user, req.ip);
  }

  @Patch(':id')
  @Roles('HO_ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReleaseDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.releases.update(id, dto, user, req.ip);
  }

  @Delete(':id')
  @Roles('HO_ADMIN')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.releases.remove(id, user, req.ip);
  }
}

/** APK download for TVs. sendFile supports Range, so an interrupted download can resume. */
@Public()
@Controller('devices')
export class AppDownloadController {
  constructor(private readonly releases: ReleasesService) {}

  @SkipThrottle()
  @Get('app/:id')
  @UseGuards(DeviceGuard)
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const path = await this.releases.filePath(id);
    res.sendFile(path, {
      headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  }
}
