import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { UpdateAlertSettingsDto } from './alert.dto';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  overview() {
    return this.alerts.overview();
  }

  @Put('settings')
  @Roles('HO_ADMIN')
  update(@Body() dto: UpdateAlertSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.alerts.updateSettings(dto, user, req.ip);
  }

  @Post('test')
  @Roles('HO_ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  test(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.alerts.sendTest(user, req.ip);
  }
}
