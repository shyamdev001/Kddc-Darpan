import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreatePlaylistDto, UpdatePlaylistDto } from './playlist.dto';
import { PlaylistsService } from './playlists.service';

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list() {
    return this.playlists.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.playlists.get(id);
  }

  @Post()
  @Roles('HO_ADMIN')
  create(@Body() dto: CreatePlaylistDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.playlists.create(dto, user, req.ip);
  }

  @Patch(':id')
  @Roles('HO_ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlaylistDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.playlists.update(id, dto, user, req.ip);
  }

  @Post(':id/duplicate')
  @Roles('HO_ADMIN')
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.playlists.duplicate(id, user, req.ip);
  }

  @Delete(':id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.playlists.remove(id, user, req.ip);
  }
}
