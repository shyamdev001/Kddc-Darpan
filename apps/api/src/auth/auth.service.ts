import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CHALLENGE_TTL_MIN } from './auth.constants';
import type { AuthUser, ChallengePayload, SessionPayload } from './auth.types';
import { TwoFactorService } from './two-factor.service';

/** Either signed in, or the password was right and the 6-digit code is next. */
export type LoginResult = { token: string; user: AuthUser } | { challenge: string };

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
    private readonly twoFactor: TwoFactorService,
  ) {}

  async login(email: string, password: string, ip?: string): Promise<LoginResult> {
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

    if (user.totpEnabled) {
      const challenge: ChallengePayload = { sub: user.id, purpose: '2fa' };
      return { challenge: await this.jwt.signAsync(challenge, { expiresIn: `${CHALLENGE_TTL_MIN}m` }) };
    }
    return this.finishLogin(user.id, ip, 'password');
  }

  /** Second step: the challenge from the password step plus a code from the phone (or a recovery code). */
  async loginWithCode(challengeToken: string | undefined, code: string, ip?: string): Promise<{ token: string; user: AuthUser }> {
    const expired = new UnauthorizedException('Sign-in took too long. Enter your email and password again.');
    if (!challengeToken) throw expired;
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(challengeToken);
    } catch {
      throw expired;
    }
    if (payload.purpose !== '2fa') throw expired;
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, totpEnabled: true } });
    if (!user?.isActive) throw expired;
    // Turned off by an admin in the meantime: the password step alone was enough after all.
    if (!user.totpEnabled) return this.finishLogin(payload.sub, ip, 'password');

    const method = await this.twoFactor.checkCode(payload.sub, code);
    if (!method) {
      await this.audit.log({ userId: payload.sub, action: 'auth.2fa_failed', entityType: 'User', entityId: payload.sub, ipAddress: ip });
      throw new UnauthorizedException('That code is not right. Use the newest code on your phone.');
    }
    return this.finishLogin(payload.sub, ip, method === 'recovery' ? 'recovery_code' : 'app_code');
  }

  private async finishLogin(id: string, ip: string | undefined, method: 'password' | 'app_code' | 'recovery_code') {
    const user = await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      details: method === 'password' ? undefined : { with: method },
      ipAddress: ip,
    });

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

  /** Returns a fresh session token: the change signs out every other session. */
  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, ip?: string): Promise<string> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await argon2.verify(row.passwordHash, currentPassword).catch(() => false))) {
      await this.audit.log({ userId: user.id, action: 'auth.password_change_failed', entityType: 'User', entityId: user.id, ipAddress: ip });
      throw new BadRequestException('Your current password is not right');
    }
    if (currentPassword === newPassword) throw new BadRequestException('Choose a new password, not the current one');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    // Whole seconds, like the token's issue time, so the new session is not refused.
    const passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt } });
    await this.audit.log({ userId: user.id, action: 'auth.password_change', entityType: 'User', entityId: user.id, ipAddress: ip });
    const payload: SessionPayload = { sub: user.id, role: user.role };
    return this.jwt.signAsync(payload);
  }

  async logout(user: AuthUser, ip?: string): Promise<void> {
    await this.audit.log({ userId: user.id, action: 'auth.logout', entityType: 'User', entityId: user.id, ipAddress: ip });
  }
}
