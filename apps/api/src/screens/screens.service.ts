import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  KIOSK_STATES,
  ONLINE_WINDOW_MS,
  PAIRING_CODE_TTL_MS,
  type BranchOption,
  type DeviceStatusResponse,
  type KioskState,
  type RegisterDeviceResponse,
  type ScreenDetail,
  type ScreenListResponse,
  type ScreenSummary,
} from '@darpan/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { branchScope, isHeadOffice, screenScope } from '../auth/scope';
import { Prisma } from '../generated/prisma/client';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { newDeviceToken, newPairingCode } from './device-auth';
import { CommandsService } from './commands.service';
import { DevicesGateway } from './devices.gateway';
import { PlaylistResolver, type ResolvedPlaylist } from './playlist-resolver.service';
import type { ClaimScreenDto, RegisterDeviceDto, UpdateScreenDto } from './screen.dto';

const screenInclude = {
  branch: { select: { id: true, name: true, code: true, talukaId: true, taluka: { select: { regionId: true } } } },
  currentMedia: { select: { id: true, displayName: true } },
  assignments: { where: { targetType: 'SCREEN', schedules: { none: {} } }, select: { playlistId: true } },
} satisfies Prisma.ScreenInclude;

type ScreenRow = Prisma.ScreenGetPayload<{ include: typeof screenInclude }>;

const BAD_CODE = 'That code is not valid or has expired. Check the 6-digit code on the TV and try again.';

function isUniqueViolation(err: unknown, field: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && JSON.stringify(err.meta ?? {}).includes(field);
}

@Injectable()
export class ScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: PlaylistResolver,
    private readonly events: ContentEvents,
    private readonly gateway: DevicesGateway,
    private readonly commands: CommandsService,
  ) {}

  // ---------- TV side ----------

  /**
   * First boot of the TV app, or after its data was cleared. A TV that was already paired and
   * registers again goes back to "needs pairing" (name, branch and playlist are kept), because
   * its old token was lost with the app data.
   */
  async register(dto: RegisterDeviceDto, ip?: string): Promise<RegisterDeviceResponse> {
    const existing = await this.prisma.screen.findUnique({
      where: { hardwareId: dto.hardwareId },
      select: { id: true, status: true, name: true },
    });
    const { token, hash } = newDeviceToken();
    const info = {
      model: dto.model,
      osVersion: dto.osVersion,
      resolution: dto.resolution,
      appVersion: dto.appVersion ?? null,
      ipAddress: ip ?? null,
      lastSeenAt: new Date(),
    };

    const screen = await this.withFreshCode((code, expires) =>
      existing
        ? this.prisma.screen.update({
            where: { id: existing.id },
            data: { ...info, deviceTokenHash: hash, pairingCode: code, pairingExpires: expires, status: 'PENDING' },
          })
        : this.prisma.screen.create({
            data: { ...info, hardwareId: dto.hardwareId, deviceTokenHash: hash, pairingCode: code, pairingExpires: expires },
          }),
    );

    if (existing && existing.status !== 'PENDING') {
      await this.audit.log({
        userId: null,
        action: 'screen.reregister',
        entityType: 'Screen',
        entityId: screen.id,
        details: { name: existing.name },
        ipAddress: ip,
      });
    }
    return {
      deviceId: screen.id,
      deviceToken: token,
      pairingCode: screen.pairingCode!,
      pairingExpiresAt: screen.pairingExpires!.toISOString(),
    };
  }

  /** Polled by the TV while it shows the code. Issues a fresh code once the old one expires. */
  async deviceStatus(id: string): Promise<DeviceStatusResponse> {
    let s = await this.prisma.screen.findUniqueOrThrow({ where: { id } });
    if (s.status === 'PENDING' && (!s.pairingCode || !s.pairingExpires || s.pairingExpires.getTime() < Date.now())) {
      s = await this.withFreshCode((code, expires) =>
        this.prisma.screen.update({ where: { id }, data: { pairingCode: code, pairingExpires: expires } }),
      );
    }
    const paired = s.status !== 'PENDING';
    return {
      paired,
      pairingCode: paired ? null : s.pairingCode,
      pairingExpiresAt: paired ? null : (s.pairingExpires?.toISOString() ?? null),
      screenName: paired ? s.name : null,
    };
  }

  /** Runs `write` with a new pairing code, retrying on the rare collision with a code in use. */
  private async withFreshCode<T>(write: (code: string, expires: Date) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await write(newPairingCode(), new Date(Date.now() + PAIRING_CODE_TTL_MS));
      } catch (err) {
        if (attempt < 5 && isUniqueViolation(err, 'pairingCode')) continue;
        throw err;
      }
    }
  }

  // ---------- Dashboard side ----------

  async list(user: AuthUser): Promise<ScreenListResponse> {
    const now = new Date();
    const [rows, waitingToPair] = await Promise.all([
      // Unnamed pending rows are TVs showing a code; they appear in the list once claimed.
      this.prisma.screen.findMany({
        where: { NOT: { status: 'PENDING', name: null }, ...screenScope(user) },
        include: screenInclude,
        orderBy: [{ name: 'asc' }],
      }),
      isHeadOffice(user) ? this.prisma.screen.count({ where: { status: 'PENDING', name: null, pairingExpires: { gt: now } } }) : 0,
    ]);
    const playlists = await this.resolver.resolveMany(rows);
    return { items: rows.map((r) => this.toSummary(r, playlists.get(r.id) ?? null)), waitingToPair };
  }

  /** 404, not 403, for a screen outside the user's area, so ids cannot be probed. */
  async assertVisible(id: string, user: AuthUser): Promise<void> {
    if (isHeadOffice(user)) return;
    if (!(await this.prisma.screen.count({ where: { id, ...screenScope(user) } }))) throw new NotFoundException('Screen not found');
  }

  async detail(id: string, user: AuthUser): Promise<ScreenDetail> {
    await this.assertVisible(id, user);
    const s = await this.prisma.screen.findUnique({ where: { id }, include: screenInclude });
    if (!s || (s.status === 'PENDING' && s.name === null)) throw new NotFoundException('Screen not found');
    const [playlist, layers, inherited, hours] = await Promise.all([
      this.resolver.resolve(s),
      this.resolver.layers(s),
      this.resolver.layers(s, true),
      this.resolver.hours(s),
    ]);
    // the always-on playlist from the levels above: what "follow its branch" means
    const fallback = inherited.find((l) => !l.slots.length) ?? null;
    return {
      ...this.toSummary(s, playlist),
      fallbackPlaylist: fallback ? { id: fallback.playlistId, name: fallback.name, source: fallback.source } : null,
      scheduled: layers.filter((l) => l.slots.length).map((l) => ({ id: l.playlistId, name: l.name, source: l.source, slots: l.slots })),
      hours,
      osVersion: s.osVersion,
      resolution: s.resolution,
      ipAddress: s.ipAddress,
      storageFreeMb: s.storageFreeMb,
      storageTotalMb: s.storageTotalMb,
      ramFreeMb: s.ramFreeMb,
      ramTotalMb: s.ramTotalMb,
      manifestVersion: s.manifestVersion,
      kiosk: isKiosk(s.kioskState) ? s.kioskState : null,
      kioskUntil: s.kioskUntil?.toISOString() ?? null,
      pairedAt: s.pairedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      ownPlaylistId: s.assignments[0]?.playlistId ?? null,
    };
  }

  async claim(dto: ClaimScreenDto, user: AuthUser, ip?: string): Promise<ScreenDetail> {
    const screen = await this.prisma.screen.findUnique({ where: { pairingCode: dto.pairingCode } });
    if (!screen || screen.status !== 'PENDING' || !screen.pairingExpires || screen.pairingExpires < new Date()) {
      await this.audit.log({ userId: user.id, action: 'screen.claim_failed', entityType: 'Screen', ipAddress: ip });
      throw new BadRequestException(BAD_CODE);
    }
    await this.assertBranch(dto.branchId);
    if (dto.playlistId) await this.assertPlaylist(dto.playlistId);

    await this.prisma.$transaction(async (tx) => {
      await tx.screen.update({
        where: { id: screen.id },
        data: {
          name: dto.name,
          branchId: dto.branchId,
          orientation: dto.orientation ?? screen.orientation,
          status: 'ONLINE',
          pairingCode: null,
          pairingExpires: null,
          pairedAt: new Date(),
        },
      });
      if (dto.playlistId !== undefined) {
        await tx.assignment.deleteMany({ where: { screenId: screen.id, targetType: 'SCREEN', schedules: { none: {} } } });
        if (dto.playlistId) {
          await tx.assignment.create({ data: { playlistId: dto.playlistId, targetType: 'SCREEN', screenId: screen.id } });
        }
      }
    });
    await this.audit.log({
      userId: user.id,
      action: screen.name ? 'screen.repair' : 'screen.claim',
      entityType: 'Screen',
      entityId: screen.id,
      details: { name: dto.name, branchId: dto.branchId, playlistId: dto.playlistId ?? null, hardwareId: screen.hardwareId },
      ipAddress: ip,
    });
    this.events.screensChanged(screen.id);
    return this.detail(screen.id, user);
  }

  async update(id: string, dto: UpdateScreenDto, user: AuthUser, ip?: string): Promise<ScreenDetail> {
    const before = await this.detail(id, user);
    if (dto.branchId) await this.assertBranch(dto.branchId);
    await this.prisma.screen.update({
      where: { id },
      data: { name: dto.name, branchId: dto.branchId, orientation: dto.orientation },
    });
    const after = await this.detail(id, user);
    await this.audit.log({
      userId: user.id,
      action: 'screen.update',
      entityType: 'Screen',
      entityId: id,
      details: {
        before: { name: before.name, branchId: before.branch?.id ?? null, orientation: before.orientation },
        after: { name: after.name, branchId: after.branch?.id ?? null, orientation: after.orientation },
      },
      ipAddress: ip,
    });
    this.events.screensChanged(id);
    return after;
  }

  /** Sets, or clears with null, the playlist assigned directly to this screen. */
  async setPlaylist(id: string, playlistId: string | null, user: AuthUser, ip?: string): Promise<ScreenDetail> {
    const before = await this.detail(id, user);
    if (playlistId) await this.assertPlaylist(playlistId);
    await this.prisma.$transaction(async (tx) => {
      await tx.assignment.deleteMany({ where: { screenId: id, targetType: 'SCREEN', schedules: { none: {} } } });
      if (playlistId) await tx.assignment.create({ data: { playlistId, targetType: 'SCREEN', screenId: id } });
    });
    await this.audit.log({
      userId: user.id,
      action: 'screen.assign_playlist',
      entityType: 'Screen',
      entityId: id,
      details: { before: before.ownPlaylistId, after: playlistId },
      ipAddress: ip,
    });
    this.events.screensChanged(id);
    return this.detail(id, user);
  }

  /** Forgets the TV. Its token stops working; the app registers again and shows a new code. */
  async remove(id: string, user: AuthUser, ip?: string): Promise<void> {
    const s = await this.detail(id, user);
    await this.commands.deleteScreenshots(id);
    await this.prisma.screen.delete({ where: { id } });
    this.gateway.disconnectScreen(id);
    await this.audit.log({
      userId: user.id,
      action: 'screen.remove',
      entityType: 'Screen',
      entityId: id,
      details: { name: s.name, branch: s.branch?.name ?? null, model: s.model },
      ipAddress: ip,
    });
  }

  async branches(user: AuthUser): Promise<BranchOption[]> {
    const rows = await this.prisma.branch.findMany({
      where: branchScope(user),
      include: { taluka: { select: { name: true, region: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((b) => ({ id: b.id, name: b.name, code: b.code, taluka: b.taluka.name, region: b.taluka.region.name }));
  }

  private async assertBranch(id: string) {
    if (!(await this.prisma.branch.count({ where: { id } }))) throw new BadRequestException('That branch does not exist');
  }

  private async assertPlaylist(id: string) {
    if (!(await this.prisma.playlist.count({ where: { id } }))) {
      throw new BadRequestException('That playlist does not exist. Reload and try again.');
    }
  }

  private toSummary(s: ScreenRow, playlist: ResolvedPlaylist | null): ScreenSummary {
    const paired = s.status !== 'PENDING';
    return {
      id: s.id,
      name: s.name ?? 'Unnamed screen',
      paired,
      online: paired && s.lastSeenAt !== null && Date.now() - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      orientation: s.orientation,
      branch: s.branch ? { id: s.branch.id, name: s.branch.name, code: s.branch.code } : null,
      playlist: playlist ? { id: playlist.playlistId, name: playlist.name, source: playlist.source } : null,
      model: s.model,
      appVersion: s.appVersion,
      nowPlaying: s.currentMedia,
    };
  }
}

function isKiosk(v: string | null): v is KioskState {
  return v !== null && (KIOSK_STATES as readonly string[]).includes(v);
}
