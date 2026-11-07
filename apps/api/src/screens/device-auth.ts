import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** The TV making this request, attached by DeviceGuard. */
export interface DeviceScreen {
  id: string;
  status: 'PENDING' | 'ONLINE' | 'OFFLINE';
}

declare module 'express' {
  interface Request {
    screen?: DeviceScreen;
  }
}

/** 256-bit random token. High entropy, so a plain SHA-256 is enough to store it safely. */
export function newDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newPairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Only rewrite lastSeenAt when it is older than this, to keep DB writes low with ~100 TVs. */
const TOUCH_EVERY_MS = 30_000;

/**
 * Authenticates a TV by `Authorization: Bearer <deviceToken>`.
 * Device routes are @Public() for the user guard and use this guard instead.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Device token missing');

    const screen = await this.prisma.screen.findUnique({
      where: { deviceTokenHash: hashDeviceToken(token) },
      select: { id: true, status: true, lastSeenAt: true },
    });
    if (!screen) throw new UnauthorizedException('Unknown device. Register again.');

    if (!screen.lastSeenAt || Date.now() - screen.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.screen.update({ where: { id: screen.id }, data: { lastSeenAt: new Date(), ipAddress: req.ip ?? null } });
    }
    req.screen = { id: screen.id, status: screen.status };
    return true;
  }
}
