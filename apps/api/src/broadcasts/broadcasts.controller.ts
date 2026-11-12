import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { BroadcastsResponse } from '@darpan/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { StartBroadcastDto } from './broadcast.dto';
import { BroadcastsService } from './broadcasts.service';

/** Head office only: one wrong broadcast reaches every branch at once. */
@Controller('broadcasts')
@Roles('HO_ADMIN')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  list(): Promise<BroadcastsResponse> {
    return this.broadcasts.list();
  }

  @Post()
  start(@Body() dto: StartBroadcastDto, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<BroadcastsResponse> {
    return this.broadcasts.start(dto, user, req.ip);
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<BroadcastsResponse> {
    return this.broadcasts.stop(id, user, req.ip);
  }
}
