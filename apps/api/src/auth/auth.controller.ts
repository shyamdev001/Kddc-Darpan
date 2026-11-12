import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_COOKIE, sessionTtlHours } from './auth.constants';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser, Public } from './decorators';
import { ChangeOwnPasswordDto } from '../users/users.dto';
import { LoginDto } from './login.dto';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // not readable from browser JavaScript
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts per minute per IP
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto.email, dto.password, req.ip);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: sessionTtlHours() * 3600_000 });
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user, req.ip);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @Body() dto: ChangeOwnPasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, req.ip);
    res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: sessionTtlHours() * 3600_000 });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}
