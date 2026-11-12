import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  KIOSK_STATES,
  ONLINE_WINDOW_MS,
  TV_APP_PACKAGE,
  type AppReleaseEntry,
  type KioskState,
  type ReleasesResponse,
} from '@darpan/shared';
import { unlink } from 'fs/promises';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import { sha256File } from '../media/file-utils';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE, type StorageDriver } from '../storage/storage.types';
import { readApkInfo, type ApkInfo } from './apk-info';
import type { UpdateReleaseDto } from './release.dto';

const APK_MIME = 'application/vnd.android.package-archive';

/**
 * TV app updates. An uploaded APK starts in TEST (offered only to test screens); moving it to ALL
 * offers it to every screen. TVs install the newest version offered to them (see ManifestService).
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async overview(): Promise<ReleasesResponse> {
    const [rows, screens] = await Promise.all([
      this.prisma.appRelease.findMany({ orderBy: { versionCode: 'desc' }, include: { uploadedBy: { select: { name: true } } } }),
      this.prisma.screen.findMany({
        where: { status: { not: 'PENDING' } },
        orderBy: [{ testUpdates: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          lastSeenAt: true,
          testUpdates: true,
          appVersion: true,
          appVersionCode: true,
          kioskState: true,
          updateStatus: true,
          branch: { select: { name: true } },
        },
      }),
    ]);
    const onVersion = new Map<number, number>();
    for (const s of screens) if (s.appVersionCode) onVersion.set(s.appVersionCode, (onVersion.get(s.appVersionCode) ?? 0) + 1);
    const now = Date.now();
    return {
      releases: rows.map(
        (r): AppReleaseEntry => ({
          id: r.id,
          versionCode: r.versionCode,
          versionName: r.versionName,
          sizeBytes: Number(r.sizeBytes),
          sha256: r.sha256,
          notes: r.notes,
          stage: r.stage,
          createdAt: r.createdAt.toISOString(),
          uploadedBy: r.uploadedBy?.name ?? null,
          screensOnIt: onVersion.get(r.versionCode) ?? 0,
        }),
      ),
      screens: screens.map((s) => ({
        id: s.id,
        name: s.name ?? 'Unnamed screen',
        branch: s.branch?.name ?? null,
        online: !!s.lastSeenAt && now - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
        testUpdates: s.testUpdates,
        appVersion: s.appVersion,
        appVersionCode: s.appVersionCode,
        kiosk: (KIOSK_STATES as readonly string[]).includes(s.kioskState ?? '') ? (s.kioskState as KioskState) : null,
        updateStatus: s.updateStatus,
      })),
    };
  }

  async upload(file: Express.Multer.File | undefined, notes: string | undefined, user: AuthUser, ip?: string): Promise<ReleasesResponse> {
    if (!file) throw new BadRequestException('Choose the APK file to upload.');
    try {
      let info: ApkInfo;
      try {
        info = await readApkInfo(file.path);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
      if (info.packageName !== TV_APP_PACKAGE) {
        throw new BadRequestException(`This APK is "${info.packageName}", not the KDCC Darpan TV app (${TV_APP_PACKAGE}).`);
      }
      const existing = await this.prisma.appRelease.findUnique({ where: { versionCode: info.versionCode } });
      if (existing) throw new ConflictException(`Version ${info.versionName} (build ${info.versionCode}) is already uploaded.`);

      const sha256 = await sha256File(file.path);
      const key = `releases/darpan-${info.versionCode}.apk`;
      await this.storage.putFile(key, file.path, APK_MIME);
      const release = await this.prisma.appRelease.create({
        data: {
          versionCode: info.versionCode,
          versionName: info.versionName,
          storageKey: key,
          sha256,
          sizeBytes: BigInt(file.size),
          notes: notes || null,
          uploadedById: user.id,
        },
      });
      await this.audit.log({
        userId: user.id,
        action: 'release.upload',
        entityType: 'AppRelease',
        entityId: release.id,
        details: { versionCode: info.versionCode, versionName: info.versionName, sha256 },
        ipAddress: ip,
      });
      this.events.contentChanged(); // test screens may now have an update
      return this.overview();
    } finally {
      await unlink(file.path).catch(() => undefined); // already moved into storage, or rejected
    }
  }

  async update(id: string, dto: UpdateReleaseDto, user: AuthUser, ip?: string): Promise<ReleasesResponse> {
    const r = await this.prisma.appRelease.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Release not found');
    const data: { stage?: typeof r.stage; notes?: string | null } = {};
    if (dto.stage !== undefined) data.stage = dto.stage;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    await this.prisma.appRelease.update({ where: { id }, data });
    const stageChanged = data.stage !== undefined && data.stage !== r.stage;
    await this.audit.log({
      userId: user.id,
      action: stageChanged ? `release.stage.${data.stage!.toLowerCase()}` : 'release.update',
      entityType: 'AppRelease',
      entityId: id,
      details: { versionCode: r.versionCode, from: r.stage, ...data },
      ipAddress: ip,
    });
    if (stageChanged) this.events.contentChanged();
    return this.overview();
  }

  async remove(id: string, user: AuthUser, ip?: string): Promise<ReleasesResponse> {
    const r = await this.prisma.appRelease.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Release not found');
    await this.prisma.appRelease.delete({ where: { id } });
    await this.storage.delete(r.storageKey).catch(() => undefined);
    await this.audit.log({
      userId: user.id,
      action: 'release.delete',
      entityType: 'AppRelease',
      entityId: id,
      details: { versionCode: r.versionCode, versionName: r.versionName, stage: r.stage },
      ipAddress: ip,
    });
    this.events.contentChanged();
    return this.overview();
  }

  async setTestScreens(screenIds: string[], user: AuthUser, ip?: string): Promise<ReleasesResponse> {
    const wanted = new Set(screenIds);
    const current = await this.prisma.screen.findMany({
      where: { OR: [{ testUpdates: true }, { id: { in: [...wanted] } }] },
      select: { id: true, testUpdates: true },
    });
    const add = current.filter((s) => !s.testUpdates && wanted.has(s.id)).map((s) => s.id);
    const drop = current.filter((s) => s.testUpdates && !wanted.has(s.id)).map((s) => s.id);
    if (add.length || drop.length) {
      await this.prisma.$transaction([
        this.prisma.screen.updateMany({ where: { id: { in: add } }, data: { testUpdates: true } }),
        this.prisma.screen.updateMany({ where: { id: { in: drop } }, data: { testUpdates: false } }),
      ]);
      await this.audit.log({ userId: user.id, action: 'release.test_screens', entityType: 'Screen', details: { added: add, removed: drop }, ipAddress: ip });
      this.events.screensChanged(...add, ...drop);
    }
    return this.overview();
  }

  /** For the TV download route. */
  async filePath(id: string): Promise<string> {
    const r = await this.prisma.appRelease.findUnique({ where: { id }, select: { storageKey: true } });
    const path = r ? this.storage.localPath(r.storageKey) : null;
    if (!path) throw new NotFoundException('Release not found');
    return path;
  }
}
