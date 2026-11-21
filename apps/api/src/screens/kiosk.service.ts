import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { KIOSK_PIN_PATTERN, type KioskPinHash, type KioskPinStatus, type KioskReleaseAction, type ScreenCommandEntry } from '@darpan/shared';
import { pbkdf2Sync, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { TwoFactorService } from '../auth/two-factor.service';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { CommandsService } from './commands.service';

/** PBKDF2-HMAC-SHA1 rounds: about a quarter of a second on a weak TV, which checks it offline. */
export const KIOSK_PIN_ITERATIONS = 20_000;

/** The salted hash the TVs get (and the database keeps). Exported for tests. */
export function hashKioskPin(pin: string, salt: Buffer, iterations = KIOSK_PIN_ITERATIONS): KioskPinHash {
  return { salt: salt.toString('hex'), hash: pbkdf2Sync(pin, salt, iterations, 32, 'sha1').toString('hex'), iterations };
}

/**
 * The kiosk escape hatches that need head office (docs/AUDIT.md, K1 and K7):
 * - the PIN for the local unlock on the TVs (Menu five times, then the PIN), set by a super admin;
 * - taking one TV out of kiosk mode, or out of device owner, for decommissioning.
 * Both need a two-step code entered now, not just a signed-in session, and both are audit-logged.
 */
@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twoFactor: TwoFactorService,
    private readonly commands: CommandsService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
  ) {}

  async pinStatus(): Promise<KioskPinStatus> {
    const row = await this.prisma.kioskSettings.findUnique({ where: { id: 1 } });
    if (!row?.pinHash || !row.pinSetAt) return { set: false, updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: null };
    const by = row.pinSetById ? await this.prisma.user.findUnique({ where: { id: row.pinSetById }, select: { name: true } }) : null;
    return { set: true, updatedAt: row.pinSetAt.toISOString(), updatedBy: by?.name ?? null };
  }

  /** What goes into every manifest: the hash only, or null when no PIN is set. */
  async pinForManifest(): Promise<KioskPinHash | null> {
    const row = await this.prisma.kioskSettings.findUnique({ where: { id: 1 } });
    if (!row?.pinSalt || !row.pinHash || !row.pinIterations) return null;
    return { salt: row.pinSalt, hash: row.pinHash, iterations: row.pinIterations };
  }

  async setPin(pin: string | null, code: string, user: AuthUser, ip?: string): Promise<KioskPinStatus> {
    if (pin !== null && !KIOSK_PIN_PATTERN.test(pin)) throw new BadRequestException('The PIN must be 6 to 12 digits.');
    if (pin !== null && /^(\d)\1+$/.test(pin)) throw new BadRequestException('Use different digits, not the same one repeated.');
    await this.stepUp(user, code);
    const data = pin === null
      ? { pinSalt: null, pinHash: null, pinIterations: null, pinSetAt: null, pinSetById: null }
      : (() => {
          const h = hashKioskPin(pin, randomBytes(16));
          return { pinSalt: h.salt, pinHash: h.hash, pinIterations: h.iterations, pinSetAt: new Date(), pinSetById: user.id };
        })();
    await this.prisma.kioskSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.log({
      userId: user.id,
      action: pin === null ? 'kiosk.pin.remove' : 'kiosk.pin.set',
      entityType: 'KioskSettings',
      entityId: '1',
      ipAddress: ip,
    });
    this.events.contentChanged(); // every TV gets the new hash in its manifest
    return this.pinStatus();
  }

  /** Takes one TV out of kiosk mode (exit) or out of device owner too (removeOwner). Super admin only. */
  async release(screenId: string, action: KioskReleaseAction, code: string, confirmName: string, reason: string, user: AuthUser, ip?: string): Promise<ScreenCommandEntry[]> {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only a super admin can take a TV out of kiosk mode.');
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { name: true, kioskState: true } });
    if (!screen) throw new NotFoundException('Screen not found');
    const name = (screen.name ?? '').trim().normalize('NFC');
    if (!name || confirmName.trim().normalize('NFC').toLowerCase() !== name.toLowerCase()) {
      throw new BadRequestException('Type the screen\'s name exactly as shown, to make sure it is the right TV.');
    }
    const why = reason.trim();
    if (why.length < 5) throw new BadRequestException('Say why, in a few words. It is kept in the activity log.');
    if (screen.kioskState === 'off') throw new ConflictException('This TV is not in kiosk mode.');
    await this.stepUp(user, code);
    return this.commands.send(screenId, action === 'exit' ? 'kioskExit' : 'kioskRemoveOwner', user, ip, { reason: why.slice(0, 300) });
  }

  private async stepUp(user: AuthUser, code: string): Promise<void> {
    const status = await this.twoFactor.status(user);
    if (!status.enabled) throw new ForbiddenException('Turn on two-step sign-in first (your profile). This change needs a code from the app.');
    if (!(await this.twoFactor.checkCode(user.id, code))) {
      throw new BadRequestException('That code is not right, or it was just used. Wait for the next code in the app and try again.');
    }
  }
}
