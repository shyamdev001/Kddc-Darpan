import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreateScheduleDto, SetDisplayHoursDto, UpdateScheduleDto } from './schedule.dto';
import { SchedulesService } from './schedules.service';

/** Timed playlists (dayparting) and display hours (when screens are on). */
@Controller()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get('schedules')
  @Roles('HO_ADMIN')
  list() {
    return this.schedules.list();
  }

  @Post('schedules')
  @Roles('HO_ADMIN')
  create(@Body() dto: CreateScheduleDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.schedules.create(dto, user, req.ip);
  }

  @Patch('schedules/:id')
  @Roles('HO_ADMIN')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.schedules.update(id, dto, user, req.ip);
  }

  @Delete('schedules/:id')
  @Roles('HO_ADMIN')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.schedules.remove(id, user, req.ip);
  }

  @Get('display-hours')
  @Roles('HO_ADMIN')
  hours() {
    return this.schedules.listHours();
  }

  @Put('display-hours')
  @Roles('HO_ADMIN')
  setHours(@Body() dto: SetDisplayHoursDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.schedules.setHours(dto.level, dto.targetId, dto.hours ?? null, user, req.ip);
  }
}
