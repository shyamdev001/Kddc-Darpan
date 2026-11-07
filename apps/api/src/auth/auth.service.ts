import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, SessionPayload } from './auth.types';

const INVALID = 'Invalid email or password';

@Injectable()
export class AuthService {
  // Verified against when the email does not exist, so both cases take the same time.
  private readonly dummyHash = argon2.hash('timing-equaliser-not-a-real-password', {
    type: argon2.argon2id,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string): Promise<{ token: string; user: AuthUser }> {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    const hash = user?.passwordHash ?? (await this.dummyHash);
    const passwordOk = await argon2.verify(hash, password).catch(() => false);

    if (!user || !passwordOk || !user.isActive) {
      await this.audit.log({
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        details: { email: normalised, reason: !user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive' },
        ipAddress: ip,
      });
      throw new UnauthorizedException(INVALID);
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ipAddress: ip });

    const payload: SessionPayload = { sub: user.id, role: user.role };
    const token = await this.jwt.signAsync(payload);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        regionId: user.regionId,
        branchId: user.branchId,
      },
    };
  }

  async logout(user: AuthUser, ip?: string): Promise<void> {
    await this.audit.log({ userId: user.id, action: 'auth.logout', entityType: 'User', entityId: user.id, ipAddress: ip });
  }
}
