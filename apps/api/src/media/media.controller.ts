import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { MAX_FILES_PER_UPLOAD, MAX_VIDEO_BYTES, mediaTmpDir } from './media.constants';
import { ListMediaQuery, UpdateMediaDto } from './media.dto';
import { MediaService } from './media.service';

const uploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaTmpDir()),
    // Temp name is random + a sanitised extension; the real (Gujarati) name is kept in the database.
    filename: (_req, file, cb) => cb(null, `up-${randomUUID()}${extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '')}`),
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_FILES_PER_UPLOAD },
};

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@Query() query: ListMediaQuery) {
    return this.media.list(query);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.toItem(await this.media.get(id));
  }

  @Post()
  @Roles('HO_ADMIN')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD, uploadOptions))
  upload(@UploadedFiles() files: Express.Multer.File[] | undefined, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!files?.length) throw new BadRequestException('Choose at least one file to upload.');
    return this.media.upload(files, user, req.ip);
  }

  @Patch(':id')
  @Roles('HO_ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMediaDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.media.update(id, dto, user, req.ip);
  }

  @Post(':id/retry')
  @Roles('HO_ADMIN')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.media.retry(id, user, req.ip);
  }

  @Delete(':id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.media.remove(id, user, req.ip);
  }

  // Thumbnails and previews: a page of media loads many at once, so skip the rate limiter.
  @SkipThrottle()
  @Get(':id/thumbnail')
  async thumbnail(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { path, mime } = await this.media.filePath(id, 'thumbnail');
    res.sendFile(path, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  }

  @SkipThrottle()
  @Get(':id/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { path, mime } = await this.media.filePath(id, 'file');
    // sendFile handles Range requests, so videos can be scrubbed in the preview.
    res.sendFile(path, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable' } });
  }
}
