import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ClaimScreenDto, SetPlaylistDto, UpdateScreenDto } from './screen.dto';
import { ScreensService } from './screens.service';

@Controller()
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}

  @Get('screens')
  list() {
    return this.screens.list();
  }

  @Get('screens/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.screens.detail(id);
  }

  /** Limited so a pairing code cannot be guessed by trying many. */
  @Post('screens/claim')
  @Roles('HO_ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  claim(@Body() dto: ClaimScreenDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.screens.claim(dto, user, req.ip);
  }

  @Patch('screens/:id')
  @Roles('HO_ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScreenDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.screens.update(id, dto, user, req.ip);
  }

  @Put('screens/:id/playlist')
  @Roles('HO_ADMIN')
  setPlaylist(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlaylistDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.screens.setPlaylist(id, dto.playlistId, user, req.ip);
  }

  @Delete('screens/:id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.screens.remove(id, user, req.ip);
  }

  @Get('branches')
  branches() {
    return this.screens.branches();
  }
}
