import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CommandsService } from './commands.service';
import { ClaimScreenDto, SendCommandDto, SetPlaylistDto, UpdateScreenDto } from './screen.dto';
import { ScreensService } from './screens.service';

@Controller()
export class ScreensController {
  constructor(
    private readonly screens: ScreensService,
    private readonly commands: CommandsService,
  ) {}

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

  /** Recent remote commands; the dashboard polls this while one is on its way. */
  @SkipThrottle()
  @Get('screens/:id/commands')
  listCommands(@Param('id', ParseUUIDPipe) id: string) {
    return this.commands.list(id);
  }

  @Post('screens/:id/commands')
  @Roles('HO_ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendCommand(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendCommandDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.commands.send(id, dto.type, user, req.ip);
  }

  @Get('screens/:id/screenshots/:commandId')
  async screenshot(@Param('id', ParseUUIDPipe) id: string, @Param('commandId', ParseUUIDPipe) commandId: string, @Res() res: Response) {
    const path = await this.commands.screenshotFile(id, commandId);
    res.sendFile(path, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  }

  @Get('branches')
  branches() {
    return this.screens.branches();
  }
}
