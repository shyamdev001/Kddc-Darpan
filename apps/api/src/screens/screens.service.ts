import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { cleanCapabilities, cleanUnplayable, recentTvOff } from './capabilities';
import { cleanPlaySync } from './play-sync';
import { crashReport } from './crash-report';
import {
  KIOSK_STATES,
  PAIRING_CODE_TTL_MS,
  type BranchOption,
  type DeviceStatusResponse,
  type FleetSummary,
  type KioskState,
  type LiveWallResponse,
  type RegisterDeviceResponse,
  type ScreenDetail,
  type ScreenFiles,
  type ScreenListResponse,
  type ScreenSummary,
} from '@darpan/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { branchScope, isHeadOffice, screenScope } from '../auth/scope';
import { Prisma } from '../generated/prisma/client';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { isOnline } from './online';
import { fleetSummary } from './fleet';
import { newDeviceToken, newPairingCode } from './device-auth';
import { CommandsService } from './commands.service';
import { DevicesGateway } from './devices.gateway';
import { PlaylistResolver, type ResolvedPlaylist } from './playlist-resolver.service';
import type { ClaimScreenDto, RegisterDeviceDto, UpdateScreenDto } from './screen.dto';

const screenInclude = {
  branch: { select: { id: true, name: true, code: true, talukaId: true, syncPlayback: true, taluka: { select: { regionId: true } } } },
  currentMedia: { select: { id: true, displayName: true } },
  assignments: { where: { targetType: 'SCREEN', schedules: { none: {} } }, select: { playlistId: true } },
} satisfies Prisma.ScreenInclude;

type ScreenRow = Prisma.ScreenGetPayload<{ include: typeof screenInclude }>;

/**
 * A replacement TV starts with a clean slate: everything below was reported by the old TV and says
 * nothing about the new one. Its first heartbeat fills them in.
 */
const NEW_TV_STATE = {
  storageFreeMb: null,
  storageTotalMb: null,
  ramFreeMb: null,
  ramTotalMb: null,
  currentMediaId: null,
  manifestVersion: null,
  kioskState: null,
  appVersionCode: null,
  updateStatus: null,
  kioskUntil: null,
  adbEnabled: null,
  filesReady: null,
  filesTotal: null,
  downloadError: null,
  lastCrash: Prisma.DbNull,
  unplayable: Prisma.DbNull,
  tvOff: Prisma.DbNull,
  safeMode: false,
  capabilities: Prisma.DbNull,
  playSync: Prisma.DbNull,
  broadcastId: null,
  broadcastStatus: null,
} satisfies Prisma.ScreenUncheckedUpdateInput;

const BAD_CODE = 'That code is not valid or has expired. Check the 6-digit code on the TV and try again.';

function isUniqueViolation(err: unknown, field: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && JSON.stringify(err.meta ?? {}).includes(field);
}

/** A TV that registered but was never paired, and has not asked for its code for this long, is gone. */
export const PENDING_KEEP_DAYS = 7;
const PRUNE_EVERY_MS = 24 * 3_600_000;

@Injectable()
export class ScreensService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScreensService.name);
  private timer?: NodeJS.Timeout;

  onModuleInit() {
    this.timer = setInterval(() => void this.prunePending().catch((e) => this.logger.warn(`Pending cleanup failed: ${(e as Error).message}`)), PRUNE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Removes registrations nobody paired: never named, and silent for a week. A TV still showing
   * its code asks for a fresh one now and then (which touches the row), so it is never removed;
   * one removed by mistake simply registers again. Paired screens are never touched.
   */
  async prunePending(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - PENDING_KEEP_DAYS * 86_400_000);
    const { count } = await this.prisma.screen.deleteMany({
      where: { status: 'PENDING', name: null, pairedAt: null, updatedAt: { lt: before } },
    });
    if (count) this.logger.log(`Removed ${count} TV registration(s) never paired in ${PENDING_KEEP_DAYS} days`);
    return count;
  }

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
   * First boot of the TV app, or after its data was cleared.
   *
   * A hardware id that belongs to a paired screen does NOT take that screen over: anyone who learns
   * a TV's id could otherwise knock it off air. The caller gets a replacement token that can only
   * show a pairing code; the paired TV's own token keeps working (and the screen keeps playing)
   * until head office enters that code on the dashboard, which moves the screen to the new token.
   */
  async register(dto: RegisterDeviceDto, ip?: string): Promise<RegisterDeviceResponse> {
    const existing = await this.prisma.screen.findUnique({
      where: { hardwareId: dto.hardwareId },
      select: { id: true, status: true, name: true },
    });
    const { token, hash } = newDeviceToken();

    if (existing && existing.status !== 'PENDING') {
      const screen = await this.withFreshCode((code, expires) =>
        this.prisma.screen.update({
          where: { id: existing.id },
          data: { replacementTokenHash: hash, pairingCode: code, pairingExpires: expires },
        }),
      );
      await this.audit.log({
        userId: null,
        action: 'screen.replacement_request',
        entityType: 'Screen',
        entityId: screen.id,
        details: { name: existing.name, model: dto.model },
        ipAddress: ip,
      });
      return {
        deviceId: screen.id,
        deviceToken: token,
        pairingCode: screen.pairingCode!,
        pairingExpiresAt: screen.pairingExpires!.toISOString(),
      };
    }

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
            data: { ...info, deviceTokenHash: hash, pairingCode: code, pairingExpires: expires },
          })
        : this.prisma.screen.create({
            data: { ...info, hardwareId: dto.hardwareId, deviceTokenHash: hash, pairingCode: code, pairingExpires: expires },
          }),
    );
    return {
      deviceId: screen.id,
      deviceToken: token,
      pairingCode: screen.pairingCode!,
      pairingExpiresAt: screen.pairingExpires!.toISOString(),
    };
  }

  /**
   * Polled by the TV while it shows the code. Issues a fresh code once the old one expires.
   * `replacement`: the caller holds a replacement token (see register), so it is not paired yet
   * even though the screen itself is.
   */
  async deviceStatus(id: string, replacement = false): Promise<DeviceStatusResponse> {
    let s = await this.prisma.screen.findUniqueOrThrow({ where: { id } });
    const waiting = replacement || s.status === 'PENDING';
    if (waiting && (!s.pairingCode || !s.pairingExpires || s.pairingExpires.getTime() < Date.now())) {
      s = await this.withFreshCode((code, expires) =>
        this.prisma.screen.update({ where: { id }, data: { pairingCode: code, pairingExpires: expires } }),
      );
    }
    return {
      paired: !waiting,
      pairingCode: waiting ? s.pairingCode : null,
      pairingExpiresAt: waiting ? (s.pairingExpires?.toISOString() ?? null) : null,
      screenName: waiting ? null : s.name,
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

  /** What the screens in the user's area are and can do, counted (DC6). Same screens as the list. */
  async fleet(user: AuthUser): Promise<FleetSummary> {
    const now = Date.now();
    const rows = await this.prisma.screen.findMany({
      where: { NOT: { status: 'PENDING', name: null }, ...screenScope(user) },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        model: true,
        osVersion: true,
        appVersion: true,
        capabilities: true,
        unplayable: true,
        tvOff: true,
        branch: { select: { name: true } },
      },
    });
    return fleetSummary(rows.map((r) => ({ ...r, online: isOnline(r, now), branch: r.branch?.name ?? null })));
  }

  /**
   * The Live wall: what every screen in the user's area shows right now, from what the TVs report.
   * TVs report each new item as it comes on, so this is a few seconds old at most while they are online.
   */
  async live(user: AuthUser): Promise<LiveWallResponse> {
    const now = new Date();
    const rows = await this.prisma.screen.findMany({
      where: { NOT: { status: 'PENDING', name: null }, ...screenScope(user) },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        orientation: true,
        broadcastId: true,
        broadcastStatus: true,
        filesReady: true,
        filesTotal: true,
        downloadError: true,
        safeMode: true,
        branch: { select: { id: true, name: true, taluka: { select: { region: { select: { id: true, name: true } } } } } },
        currentMedia: { select: { id: true, displayName: true, type: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    const online = (r: (typeof rows)[number]) => isOnline(r, now.getTime());

    // Only broadcasts that are still running: a TV that missed the end must not show as broadcasting.
    const castIds = [...new Set(rows.filter(online).map((r) => r.broadcastId).filter((x): x is string => !!x))];
    const casts = castIds.length
      ? await this.prisma.broadcast.findMany({
          where: { id: { in: castIds }, endedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          select: { id: true, kind: true, title: true, message: true, mediaId: true, youtubeId: true },
        })
      : [];
    const castById = new Map(casts.map((c) => [c.id, c]));

    return {
      at: now.toISOString(),
      items: rows.map((r) => {
        const on = online(r);
        const cast = on && r.broadcastId ? castById.get(r.broadcastId) : undefined;
        return {
          id: r.id,
          name: r.name ?? 'Unnamed screen',
          online: on,
          lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
          orientation: r.orientation,
          branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
          region: r.branch ? r.branch.taluka.region : null,
          nowPlaying: on && !cast ? r.currentMedia : null,
          broadcast: cast ? { ...cast, status: r.broadcastStatus } : null,
          files: screenFiles(r),
          safeMode: on && r.safeMode,
        };
      }),
    };
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
    const reported = Array.isArray(s.unplayable) ? cleanUnplayable(s.unplayable) : [];
    const [playlist, layers, inherited, hours, unplayableMedia] = await Promise.all([
      this.resolver.resolve(s),
      this.resolver.layers(s),
      this.resolver.layers(s, true),
      this.resolver.hours(s),
      reported.length
        ? this.prisma.media.findMany({ where: { id: { in: reported.map((u) => u.mediaId) } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
    ]);
    const mediaName = new Map(unplayableMedia.map((m) => [m.id, m.displayName]));
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
      adbEnabled: s.adbEnabled,
      files: screenFiles(s),
      crash: screenCrash(s.lastCrash),
      safeMode: s.safeMode,
      // Ads deleted since are left out: nothing to act on.
      tvOff: recentTvOff(s.tvOff, Date.now()),
      unplayable: reported.flatMap((u) => (mediaName.has(u.mediaId) ? [{ mediaId: u.mediaId, name: mediaName.get(u.mediaId)!, reason: u.reason }] : [])),
      capabilities: cleanCapabilities(s.capabilities),
      playSync: cleanPlaySync(s.playSync),
      syncPlayback: s.branch?.syncPlayback ?? false,
      pairedAt: s.pairedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      ownPlaylistId: s.assignments[0]?.playlistId ?? null,
    };
  }

  async claim(dto: ClaimScreenDto, user: AuthUser, ip?: string): Promise<ScreenDetail> {
    const screen = await this.prisma.screen.findUnique({ where: { pairingCode: dto.pairingCode } });
    const replacing = !!screen && screen.status !== 'PENDING' && screen.replacementTokenHash !== null;
    if (!screen || (screen.status !== 'PENDING' && !replacing) || !screen.pairingExpires || screen.pairingExpires < new Date()) {
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
          // A replacement: the TV that showed this code becomes the screen; the old token stops working.
          ...(replacing ? { deviceTokenHash: screen.replacementTokenHash!, replacementTokenHash: null } : {}),
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
      action: replacing ? 'screen.replace' : screen.name ? 'screen.repair' : 'screen.claim',
      entityType: 'Screen',
      entityId: screen.id,
      details: { name: dto.name, branchId: dto.branchId, playlistId: dto.playlistId ?? null, hardwareId: screen.hardwareId },
      ipAddress: ip,
    });
    // The old device's live connection used the old token: close it.
    if (replacing) this.gateway.disconnectScreen(screen.id);
    this.events.screensChanged(screen.id);
    return this.detail(screen.id, user);
  }

  /**
   * A TV that was factory reset (its Android id changes) or swapped for another one registers as a
   * new TV and shows a code. Entering that code here moves the new TV onto this screen: the screen
   * keeps its id, name, branch, playlists, schedules and history, and the new TV plays them. The
   * new TV's own registration is removed, and whatever TV held this screen before loses access.
   */
  async replaceDevice(id: string, pairingCode: string, user: AuthUser, ip?: string): Promise<ScreenDetail> {
    await this.detail(id, user);
    const old = await this.prisma.screen.findUniqueOrThrow({ where: { id }, select: { name: true, hardwareId: true, model: true } });
    const fresh = await this.prisma.screen.findUnique({ where: { pairingCode } });
    const usable = !!fresh && !!fresh.pairingExpires && fresh.pairingExpires > new Date();
    // The same TV registered again (app data cleared): its replacement token takes over, as in claim.
    const sameTv = usable && fresh.id === id && fresh.replacementTokenHash !== null;
    const newTv = usable && fresh.id !== id && fresh.status === 'PENDING' && fresh.name === null && fresh.pairedAt === null;
    if (!fresh || (!sameTv && !newTv)) {
      await this.audit.log({ userId: user.id, action: 'screen.replace_failed', entityType: 'Screen', entityId: id, ipAddress: ip });
      throw new BadRequestException(
        usable && fresh.id !== id && fresh.status !== 'PENDING'
          ? 'That code is for another screen that is already paired. Check the code on the TV.'
          : BAD_CODE,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Its hardware id and token move to this screen and both are unique, so the row goes first.
      if (newTv) await tx.screen.delete({ where: { id: fresh.id } });
      await tx.screen.update({
        where: { id },
        data: {
          status: 'ONLINE',
          pairingCode: null,
          pairingExpires: null,
          pairedAt: new Date(),
          replacementTokenHash: null,
          ...(newTv
            ? {
                hardwareId: fresh.hardwareId,
                deviceTokenHash: fresh.deviceTokenHash,
                model: fresh.model,
                osVersion: fresh.osVersion,
                appVersion: fresh.appVersion,
                resolution: fresh.resolution,
                ipAddress: fresh.ipAddress,
                lastSeenAt: fresh.lastSeenAt,
                ...NEW_TV_STATE,
              }
            : { deviceTokenHash: fresh.replacementTokenHash! }),
        },
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'screen.replace',
      entityType: 'Screen',
      entityId: id,
      details: { name: old.name, oldHardwareId: old.hardwareId, newHardwareId: fresh.hardwareId, oldModel: old.model, newModel: fresh.model },
      ipAddress: ip,
    });
    // Whatever TV held this screen used the old token: close its live connection.
    this.gateway.disconnectScreen(id);
    this.events.screensChanged(id);
    return this.detail(id, user);
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
    this.gateway.removeScreen(id);
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
      online: isOnline(s),
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

function screenFiles(s: { filesReady: number | null; filesTotal: number | null; downloadError: string | null }): ScreenFiles | null {
  return s.filesReady === null || s.filesTotal === null ? null : { ready: s.filesReady, total: s.filesTotal, error: s.downloadError };
}

function screenCrash(v: unknown): ScreenDetail['crash'] {
  const c = crashReport(v);
  return c ? { ...c, at: new Date(c.at).toISOString() } : null;
}
