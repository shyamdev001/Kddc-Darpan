import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { twoFactorRequired } from '@darpan/shared';
import type { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE } from './auth.constants';
import type { SessionPayload } from './auth.types';
import { ALLOW_WITHOUT_2FA_KEY, IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { twoFactorPolicy } from './totp';

/**
 * Global guard: every HTTP route needs a valid session cookie unless marked @Public().
 * Also enforces @Roles(). The user is re-read from the database on each request so a
 * deactivated account or changed role takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // Socket.IO devices use their own auth

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Not logged in');

    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }
    // A half-finished sign-in (password right, code not yet given) is not a session.
    if ((payload as { purpose?: unknown }).purpose !== undefined) throw new UnauthorizedException('Not logged in');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true, regionId: true, branchId: true, passwordChangedAt: true, totpEnabled: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Account disabled');
    // A password change or reset signs out every session issued before it.
    const issued = (payload as SessionPayload & { iat?: number }).iat ?? 0;
    if (user.passwordChangedAt && issued * 1000 < user.passwordChangedAt.getTime()) {
      throw new UnauthorizedException('Session expired');
    }

    const { isActive: _ignored, passwordChangedAt: _changed, totpEnabled, ...authUser } = user;
    req.user = authUser;

    if (
      !totpEnabled &&
      twoFactorRequired(twoFactorPolicy(), user.role) &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_2FA_KEY, targets)
    ) {
      throw new ForbiddenException({ statusCode: 403, code: '2FA_REQUIRED', message: 'Turn on two-step sign-in on your Account page first' });
    }

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && user.role !== 'SUPER_ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}
