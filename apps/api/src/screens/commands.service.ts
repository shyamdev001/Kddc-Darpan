import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { COMMAND_REPLY_SEC, SCREEN_OFF_TEST_REPLY_SEC, commandUnsupported, type RemoteCommandType, type ScreenCommandEntry } from '@darpan/shared';
import sharp from 'sharp';
import { unlink } from 'fs/promises';
import type { Subscription } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { cleanCapabilities } from './capabilities';
import { STORAGE, type StorageDriver } from '../storage/storage.types';
import { DevicesGateway } from './devices.gateway';

const HISTORY = 8;

/** Commands that undo each other: never both on their way at once (K8). */
const OPPOSITE: Record<string, string[] | undefined> = {
  kioskUnlock: ['kioskLock', 'kioskExit', 'kioskRemoveOwner'],
  kioskLock: ['kioskUnlock', 'kioskExit', 'kioskRemoveOwner'],
  kioskExit: ['kioskLock', 'kioskUnlock'],
  kioskRemoveOwner: ['kioskLock', 'kioskUnlock'],
};

interface CommandResult {
  shotKey?: string;
  error?: string;
}

/**
 * Remote control of one TV: reload, restart, clear downloaded files, screenshot.
 * Commands go only to a TV that is connected right now; a queued "restart" arriving hours later
 * would surprise whoever is standing at the branch.
 */
@Injectable()
export class CommandsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommandsService.name);
  private sub?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: DevicesGateway,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.sub = this.gateway.acks.subscribe((a) => {
      this.acknowledge(a.screenId, a.commandId, a.ok, a.error).catch((err: Error) => this.logger.error('Could not record a command reply', err));
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  async list(screenId: string): Promise<ScreenCommandEntry[]> {
    await this.expireStale(screenId);
    const rows = await this.prisma.deviceCommand.findMany({
      where: { screenId },
      include: { issuedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY,
    });
    return rows.map((c) => {
      const result = (c.result ?? {}) as CommandResult;
      return {
        id: c.id,
        type: c.type,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
        issuedBy: c.issuedBy?.name ?? null,
        error: result.error ?? null,
        screenshotUrl: c.type === 'screenshot' && c.status === 'ACKED' && result.shotKey ? `/api/screens/${screenId}/screenshots/${c.id}` : null,
      };
    });
  }

  /**
   * [type] is a dashboard command, or one of the kiosk release commands, which only KioskService
   * sends (super admin, fresh two-step code). [extra] goes into the audit row, e.g. the reason.
   */
  async send(
    screenId: string,
    type: RemoteCommandType | 'kioskExit' | 'kioskRemoveOwner',
    user: AuthUser,
    ip?: string,
    extra?: Record<string, string>,
    params?: Record<string, number>,
  ): Promise<ScreenCommandEntry[]> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { id: true, name: true, status: true, capabilities: true } });
    if (!screen) throw new NotFoundException('Screen not found');
    if (screen.status === 'PENDING') throw new ConflictException('Pair this screen before sending it commands.');
    if (type === 'volume' && !(Number.isInteger(params?.level) && params!.level >= 0 && params!.level <= 100)) {
      throw new BadRequestException('Volume must be a whole number from 0 to 100');
    }
    // What this TV reported it cannot do is refused here, not left to fail on the TV.
    const unsupported = commandUnsupported(type, cleanCapabilities(screen.capabilities));
    if (unsupported) throw new ConflictException(unsupported);
    if (!(await this.gateway.isConnected(screenId))) {
      throw new ConflictException('The TV is not connected right now. Commands only reach a TV that is online.');
    }

    // One of each at a time per TV: a second click while the first is on its way adds nothing.
    await this.expireStale(screenId);
    const busy = await this.prisma.deviceCommand.count({ where: { screenId, type, status: { in: ['PENDING', 'SENT'] } } });
    if (busy) return this.list(screenId);
    // Lock and unlock undo each other: one at a time, or the TV ends on whichever arrived last (K8).
    const opposite = OPPOSITE[type];
    if (opposite) {
      const other = await this.prisma.deviceCommand.findFirst({
        where: { screenId, type: { in: opposite }, status: { in: ['PENDING', 'SENT'] } },
        include: { issuedBy: { select: { name: true } } },
      });
      if (other) {
        throw new ConflictException(`${other.issuedBy?.name ?? 'Another admin'} just sent "${other.type}" to this TV. Wait for its answer, then try again.`);
      }
    }

    // Marked SENT before it goes out: a fast TV can reply before emit() returns, and that reply must not be overwritten.
    let cmd;
    try {
      cmd = await this.prisma.deviceCommand.create({ data: { screenId, type, params, issuedById: user.id, status: 'SENT', sentAt: new Date() } });
    } catch (err) {
      // Two admins at the same moment: the database keeps one live command of each type (K8).
      if ((err as { code?: string }).code === 'P2002') return this.list(screenId);
      throw err;
    }
    const sent = await this.gateway.sendCommand(screenId, { commandId: cmd.id, type, ...(params ? { params } : {}) });
    if (!sent) {
      await this.prisma.deviceCommand.updateMany({
        where: { id: cmd.id, status: 'SENT' },
        data: { status: 'FAILED', completedAt: new Date(), result: { error: 'The TV disconnected before it could be told' } },
      });
    }
    await this.audit.log({
      userId: user.id,
      action: `screen.command.${type}`,
      entityType: 'Screen',
      entityId: screenId,
      details: { commandId: cmd.id, screen: screen.name, ...extra, ...params },
      ipAddress: ip,
    });
    return this.list(screenId);
  }

  /** The TV says a command finished (or failed). Ignores commands that are not its own or already closed. */
  async acknowledge(screenId: string, commandId: string, ok: boolean, error?: string): Promise<void> {
    await this.prisma.deviceCommand.updateMany({
      where: { id: commandId, screenId, status: { in: ['PENDING', 'SENT'] } },
      data: ok
        ? { status: 'ACKED', completedAt: new Date() }
        : { status: 'FAILED', completedAt: new Date(), result: { error: (error || 'The TV could not do it').slice(0, 200) } },
    });
  }

  /** The TV uploads a screenshot it was asked for. Re-encoding also proves the upload is an image. */
  async saveScreenshot(screenId: string, commandId: string, uploadPath: string | undefined): Promise<void> {
    const out = uploadPath ? `${uploadPath}.jpg` : undefined;
    try {
      const cmd = await this.prisma.deviceCommand.findUnique({ where: { id: commandId } });
      if (!cmd || cmd.screenId !== screenId || cmd.type !== 'screenshot') throw new NotFoundException('No such screenshot request');
      if (cmd.status !== 'SENT' && cmd.status !== 'PENDING') throw new ConflictException('This screenshot was already handled');
      if (!uploadPath || !out) throw new BadRequestException('Attach the image as "file"');

      try {
        await sharp(uploadPath).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out);
      } catch {
        throw new BadRequestException('That is not a readable image');
      }
      const key = `screenshots/${screenId}/${commandId}.jpg`;
      await this.storage.putFile(key, out, 'image/jpeg');

      // Keep only the newest screenshot per TV.
      const older = await this.prisma.deviceCommand.findMany({
        where: { screenId, type: 'screenshot', status: 'ACKED', id: { not: commandId } },
        select: { id: true, result: true },
      });
      for (const o of older) {
        const k = (o.result as CommandResult | null)?.shotKey;
        if (!k) continue;
        await this.storage.delete(k).catch(() => undefined);
        await this.prisma.deviceCommand.update({ where: { id: o.id }, data: { result: {} } });
      }

      await this.prisma.deviceCommand.update({
        where: { id: commandId },
        data: { status: 'ACKED', completedAt: new Date(), result: { shotKey: key } },
      });
    } finally {
      if (uploadPath) await unlink(uploadPath).catch(() => undefined);
      if (out) await unlink(out).catch(() => undefined); // already moved on success
    }
  }

  /** Before a screen is deleted: its screenshot files (the rows go with the screen). */
  async deleteScreenshots(screenId: string): Promise<void> {
    const rows = await this.prisma.deviceCommand.findMany({ where: { screenId, type: 'screenshot' }, select: { result: true } });
    for (const r of rows) {
      const k = (r.result as CommandResult | null)?.shotKey;
      if (k) await this.storage.delete(k).catch(() => undefined);
    }
  }

  async screenshotFile(screenId: string, commandId: string): Promise<string> {
    const cmd = await this.prisma.deviceCommand.findUnique({ where: { id: commandId }, select: { screenId: true, result: true } });
    const key = cmd?.screenId === screenId ? (cmd.result as CommandResult | null)?.shotKey : undefined;
    if (!key) throw new NotFoundException('That screenshot is no longer kept');
    const path = this.storage.localPath(key);
    if (!path) throw new NotFoundException('File is in remote storage');
    return path;
  }

  /** Commands with no reply long after they were sent: the TV went away or its app predates the command. */
  private async expireStale(screenId: string): Promise<void> {
    const live = { screenId, status: { in: ['PENDING', 'SENT'] as ('PENDING' | 'SENT')[] } };
    const before = (sec: number) => new Date(Date.now() - sec * 1000);
    const n = await this.prisma.deviceCommand.updateMany({
      where: { ...live, type: { not: 'screenOffTest' }, createdAt: { lt: before(COMMAND_REPLY_SEC) } },
      data: { status: 'FAILED', completedAt: new Date(), result: { error: 'No reply from the TV' } },
    });
    // The test waits for the TV to wake by itself; silence means it did not (or it went offline).
    const t = await this.prisma.deviceCommand.updateMany({
      where: { ...live, type: 'screenOffTest', createdAt: { lt: before(SCREEN_OFF_TEST_REPLY_SEC) } },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        result: { error: 'No reply: the TV probably did not come back on by itself. Panel-off stays unused; nights stay black.' },
      },
    });
    if (n.count + t.count) this.logger.log(`${n.count + t.count} command(s) to screen ${screenId} got no reply`);
  }
}
