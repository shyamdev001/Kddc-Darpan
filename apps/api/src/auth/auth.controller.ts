import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { TwoFactorEnableResponse, TwoFactorSetupResponse, TwoFactorStatus } from '@darpan/shared';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CHALLENGE_COOKIE, CHALLENGE_TTL_MIN, SESSION_COOKIE, sessionTtlHours } from './auth.constants';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { AllowWithout2fa, CurrentUser, Public } from './decorators';
import { ChangeOwnPasswordDto } from '../users/users.dto';
import { DisableTwoFactorDto, LoginDto, TwoFactorCodeDto } from './login.dto';
import { TwoFactorService } from './two-factor.service';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // not readable from browser JavaScript
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    path: '/',
  };
}

/** The challenge cookie only travels to the sign-in routes. */
function challengeCookieOptions(): CookieOptions {
  return { ...cookieOptions(), path: '/api/auth' };
}

@Controller('auth')
@AllowWithout2fa() // everything here works before two-step sign-in is set up
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts per minute per IP
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, req.ip);
    if ('challenge' in result) {
      res.cookie(CHALLENGE_COOKIE, result.challenge, { ...challengeCookieOptions(), maxAge: CHALLENGE_TTL_MIN * 60_000 });
      return { needsCode: true };
    }
    res.cookie(SESSION_COOKIE, result.token, { ...cookieOptions(), maxAge: sessionTtlHours() * 3600_000 });
    return { user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/code')
  @HttpCode(200)
  async loginCode(@Body() dto: TwoFactorCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const challenge: unknown = req.cookies?.[CHALLENGE_COOKIE];
    const { token, user } = await this.auth.loginWithCode(typeof challenge === 'string' ? challenge : undefined, dto.code, req.ip);
    res.clearCookie(CHALLENGE_COOKIE, challengeCookieOptions());
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
  async me(@CurrentUser() user: AuthUser) {
    return { user, twoFactor: await this.twoFactor.status(user) };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setup2fa(@CurrentUser() user: AuthUser): Promise<TwoFactorSetupResponse> {
    return this.twoFactor.setup(user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(200)
  enable2fa(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<TwoFactorEnableResponse> {
    return this.twoFactor.enable(user, dto.code, req.ip);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/disable')
  @HttpCode(200)
  disable2fa(@Body() dto: DisableTwoFactorDto, @CurrentUser() user: AuthUser, @Req() req: Request): Promise<TwoFactorStatus> {
    return this.twoFactor.disable(user, dto.password, dto.code, req.ip);
  }
}
