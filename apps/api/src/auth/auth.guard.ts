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
import type { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_COOKIE } from './auth.constants';
import type { SessionPayload } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

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

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true, regionId: true, branchId: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Account disabled');

    const { isActive: _ignored, ...authUser } = user;
    req.user = authUser;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && user.role !== 'SUPER_ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have permission for this action');
    }
    return true;
  }
}
