import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  RECOVERY_CODE_COUNT,
  twoFactorRequired,
  type TwoFactorEnableResponse,
  type TwoFactorSetupResponse,
  type TwoFactorStatus,
  type UserRole,
} from '@darpan/shared';
import * as argon2 from 'argon2';
import * as QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import {
  assertTotpKey,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  newRecoveryCode,
  newSecret,
  otpauthUrl,
  twoFactorPolicy,
  verifyCode,
} from './totp';

/** Two-step sign-in with an authenticator app, plus one-time recovery codes. */
@Injectable()
export class TwoFactorService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // Fail at startup, not at someone's sign-in, when the key is missing or wrong.
    if (process.env.TOTP_ENCRYPTION_KEY || twoFactorPolicy() !== 'off') assertTotpKey();
  }

  required(role: UserRole): boolean {
    return twoFactorRequired(twoFactorPolicy(), role);
  }

  async status(user: AuthUser): Promise<TwoFactorStatus> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabled: true, recoveryCodes: true } });
    return { enabled: row.totpEnabled, required: this.required(user.role), recoveryCodesLeft: row.totpEnabled ? row.recoveryCodes.length : 0 };
  }

  /** Starts setup: a new secret, kept but not in force until a code from the phone confirms it. */
  async setup(user: AuthUser): Promise<TwoFactorSetupResponse> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabled: true, email: true } });
    if (row.totpEnabled) throw new BadRequestException('Two-step sign-in is already on. Turn it off first to move it to a new phone.');
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptSecret(secret), totpLastStep: null } });
    const url = otpauthUrl(secret, row.email);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { qrSvg, secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauthUrl: url };
  }

  async enable(user: AuthUser, code: string, ip?: string): Promise<TwoFactorEnableResponse> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpEnabled: true, totpSecret: true } });
    if (row.totpEnabled) throw new BadRequestException('Two-step sign-in is already on.');
    if (!row.totpSecret) throw new BadRequestException('Start the setup again: scan the QR code first.');
    const step = verifyCode(decryptSecret(row.totpSecret), code.trim(), null);
    if (step === null) throw new BadRequestException('That code is not right. Check the phone shows KDCC Darpan and try the newest code.');
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, totpLastStep: step, recoveryCodes: codes.map(hashRecoveryCode) },
    });
    await this.audit.log({ userId: user.id, action: 'auth.2fa_enable', entityType: 'User', entityId: user.id, ipAddress: ip });
    return { status: await this.status(user), recoveryCodes: codes };
  }

  async disable(user: AuthUser, password: string, code: string, ip?: string): Promise<TwoFactorStatus> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, totpEnabled: true } });
    if (!row.totpEnabled) throw new BadRequestException('Two-step sign-in is not on.');
    if (!(await argon2.verify(row.passwordHash, password).catch(() => false))) throw new BadRequestException('Your password is not right');
    if (!(await this.checkCode(user.id, code))) throw new BadRequestException('That code is not right');
    await this.clear(user.id);
    await this.audit.log({ userId: user.id, action: 'auth.2fa_disable', entityType: 'User', entityId: user.id, ipAddress: ip });
    return this.status(user);
  }

  /** For someone who lost their phone and their recovery codes. Super admins only (UsersController). */
  async adminReset(id: string, actor: AuthUser, ip?: string): Promise<void> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { email: true, totpEnabled: true } });
    if (!row) throw new NotFoundException('User not found');
    if (!row.totpEnabled) throw new BadRequestException('Two-step sign-in is not on for this person');
    await this.clear(id);
    await this.audit.log({ userId: actor.id, action: 'user.reset_2fa', entityType: 'User', entityId: id, details: { email: row.email }, ipAddress: ip });
  }

  /**
   * A 6-digit code from the app, or a recovery code (used up). Each is accepted once: the update
   * only succeeds if no other request used the same step or recovery code first.
   */
  async checkCode(userId: string, input: string): Promise<'app' | 'recovery' | null> {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true, totpSecret: true, totpLastStep: true, recoveryCodes: true } });
    if (!row?.totpEnabled || !row.totpSecret) return null;
    const code = input.replace(/\s/g, '');
    if (/^\d{6}$/.test(code)) {
      const step = verifyCode(decryptSecret(row.totpSecret), code, row.totpLastStep);
      if (step === null) return null;
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      return count === 1 ? 'app' : null;
    }
    const hash = hashRecoveryCode(code);
    if (!row.recoveryCodes.includes(hash)) return null;
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, recoveryCodes: { has: hash } },
      data: { recoveryCodes: row.recoveryCodes.filter((h) => h !== hash) },
    });
    return count === 1 ? 'recovery' : null;
  }

  private clear(id: string) {
    return this.prisma.user.update({ where: { id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, recoveryCodes: [] } });
  }
}
