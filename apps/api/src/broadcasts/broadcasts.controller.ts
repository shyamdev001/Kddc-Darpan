import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { BroadcastReach, BroadcastsResponse } from '@darpan/shared';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { BroadcastReachQuery, StartBroadcastDto } from './broadcast.dto';
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

  /** Which of these screens can play a YouTube link: the form warns before anything starts. */
  @Get('reach')
  reach(@Query() q: BroadcastReachQuery): Promise<BroadcastReach> {
    return this.broadcasts.reach(q.level, q.targetId);
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
