import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ONLINE_WINDOW_MS,
  type BranchNode,
  type PlaceLevel,
  type PlacePlaylist,
  type PlaceTree,
  type RegionNode,
  type ScreenCounts,
  type TalukaNode,
} from '@darpan/shared';
import { Prisma, type AssignmentTarget } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateBranchDto,
  CreateRegionDto,
  CreateTalukaDto,
  UpdateBranchDto,
  UpdateRegionDto,
  UpdateTalukaDto,
} from './place.dto';

function uniqueClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const counts = (): ScreenCounts => ({ total: 0, online: 0 });
const add = (into: ScreenCounts, from: ScreenCounts) => {
  into.total += from.total;
  into.online += from.online;
};

@Injectable()
export class PlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
  ) {}

  /** The whole Region > Taluka > Branch tree with screen counts and the playlist set at each level. */
  async tree(): Promise<PlaceTree> {
    const [regions, assignments, screens] = await Promise.all([
      this.prisma.region.findMany({
        orderBy: { name: 'asc' },
        include: {
          talukas: {
            orderBy: { name: 'asc' },
            include: { branches: { orderBy: { name: 'asc' } } },
          },
        },
      }),
      this.prisma.assignment.findMany({
        where: { targetType: { in: ['ALL', 'REGION', 'TALUKA', 'BRANCH'] }, schedules: { none: {} } }, // the always-on playlist; timed ones are on Schedules
        include: { playlist: { select: { id: true, name: true } } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.screen.findMany({
        where: { status: { not: 'PENDING' }, branchId: { not: null } },
        select: { branchId: true, lastSeenAt: true },
      }),
    ]);

    // first assignment per target wins (already sorted by priority, then newest)
    const own = new Map<string, PlacePlaylist>();
    for (const a of assignments) {
      const key = `${a.targetType}:${a.regionId ?? a.talukaId ?? a.branchId ?? ''}`;
      if (!own.has(key)) own.set(key, a.playlist);
    }

    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    const perBranch = new Map<string, ScreenCounts>();
    for (const s of screens) {
      const c = perBranch.get(s.branchId!) ?? counts();
      c.total++;
      if (s.lastSeenAt && s.lastSeenAt.getTime() > cutoff) c.online++;
      perBranch.set(s.branchId!, c);
    }

    const total = counts();
    const regionNodes: RegionNode[] = regions.map((r) => {
      const rc = counts();
      const talukas: TalukaNode[] = r.talukas.map((t) => {
        const tc = counts();
        const branches: BranchNode[] = t.branches.map((b) => {
          const bc = perBranch.get(b.id) ?? counts();
          add(tc, bc);
          return { id: b.id, code: b.code, name: b.name, address: b.address, playlist: own.get(`BRANCH:${b.id}`) ?? null, screens: bc };
        });
        add(rc, tc);
        return { id: t.id, name: t.name, playlist: own.get(`TALUKA:${t.id}`) ?? null, screens: tc, branches };
      });
      add(total, rc);
      return { id: r.id, name: r.name, playlist: own.get(`REGION:${r.id}`) ?? null, screens: rc, talukas };
    });

    return { allPlaylist: own.get('ALL:') ?? null, screens: total, regions: regionNodes };
  }

  // ---- Regions ----

  async createRegion(dto: CreateRegionDto, user: AuthUser, ip?: string) {
    try {
      const r = await this.prisma.region.create({ data: { name: dto.name } });
      await this.log(user, ip, 'region.create', 'Region', r.id, { name: r.name });
      return r;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`There is already a region called ${dto.name}`);
      throw err;
    }
  }

  async updateRegion(id: string, dto: UpdateRegionDto, user: AuthUser, ip?: string) {
    const before = await this.prisma.region.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('That region no longer exists');
    try {
      const r = await this.prisma.region.update({ where: { id }, data: { name: dto.name } });
      await this.log(user, ip, 'region.update', 'Region', id, { before: before.name, after: r.name });
      return r;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`There is already a region called ${dto.name}`);
      throw err;
    }
  }

  async removeRegion(id: string, user: AuthUser, ip?: string) {
    const r = await this.prisma.region.findUnique({ where: { id }, include: { _count: { select: { talukas: true, managers: true } } } });
    if (!r) throw new NotFoundException('That region no longer exists');
    if (r._count.talukas) throw new BadRequestException(`Move or delete the ${plural(r._count.talukas, "taluka", "talukas")} in ${r.name} first`);
    if (r._count.managers) throw new BadRequestException(`${r.name} still has region managers. Change their region first.`);
    await this.prisma.region.delete({ where: { id } });
    await this.log(user, ip, 'region.remove', 'Region', id, { name: r.name });
  }

  // ---- Talukas ----

  async createTaluka(dto: CreateTalukaDto, user: AuthUser, ip?: string) {
    await this.assertExists('region', dto.regionId);
    try {
      const t = await this.prisma.taluka.create({ data: { name: dto.name, regionId: dto.regionId } });
      await this.log(user, ip, 'taluka.create', 'Taluka', t.id, { name: t.name, regionId: t.regionId });
      return t;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`That region already has a taluka called ${dto.name}`);
      throw err;
    }
  }

  async updateTaluka(id: string, dto: UpdateTalukaDto, user: AuthUser, ip?: string) {
    const before = await this.prisma.taluka.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('That taluka no longer exists');
    if (dto.regionId) await this.assertExists('region', dto.regionId);
    try {
      const t = await this.prisma.taluka.update({ where: { id }, data: { name: dto.name, regionId: dto.regionId } });
      await this.log(user, ip, 'taluka.update', 'Taluka', id, {
        before: { name: before.name, regionId: before.regionId },
        after: { name: t.name, regionId: t.regionId },
      });
      // a taluka moved to another region may now inherit a different playlist
      if (t.regionId !== before.regionId) await this.notify({ branch: { talukaId: id } });
      return t;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`That region already has a taluka called ${dto.name ?? before.name}`);
      throw err;
    }
  }

  async removeTaluka(id: string, user: AuthUser, ip?: string) {
    const t = await this.prisma.taluka.findUnique({ where: { id }, include: { _count: { select: { branches: true } } } });
    if (!t) throw new NotFoundException('That taluka no longer exists');
    if (t._count.branches) throw new BadRequestException(`Move or delete the ${plural(t._count.branches, "branch", "branches")} in ${t.name} first`);
    await this.prisma.taluka.delete({ where: { id } });
    await this.log(user, ip, 'taluka.remove', 'Taluka', id, { name: t.name });
  }

  // ---- Branches ----

  async createBranch(dto: CreateBranchDto, user: AuthUser, ip?: string) {
    await this.assertExists('taluka', dto.talukaId);
    try {
      const b = await this.prisma.branch.create({
        data: { name: dto.name, code: dto.code ?? null, address: dto.address ?? null, talukaId: dto.talukaId },
      });
      await this.log(user, ip, 'branch.create', 'Branch', b.id, { name: b.name, code: b.code, talukaId: b.talukaId });
      return b;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`Branch code ${dto.code} is already used by another branch`);
      throw err;
    }
  }

  async updateBranch(id: string, dto: UpdateBranchDto, user: AuthUser, ip?: string) {
    const before = await this.prisma.branch.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('That branch no longer exists');
    if (dto.talukaId) await this.assertExists('taluka', dto.talukaId);
    try {
      const b = await this.prisma.branch.update({
        where: { id },
        data: { name: dto.name, code: dto.code, address: dto.address, talukaId: dto.talukaId },
      });
      await this.log(user, ip, 'branch.update', 'Branch', id, {
        before: { name: before.name, code: before.code, address: before.address, talukaId: before.talukaId },
        after: { name: b.name, code: b.code, address: b.address, talukaId: b.talukaId },
      });
      if (b.talukaId !== before.talukaId) await this.notify({ branchId: id });
      return b;
    } catch (err) {
      if (uniqueClash(err)) throw new ConflictException(`Branch code ${dto.code} is already used by another branch`);
      throw err;
    }
  }

  async removeBranch(id: string, user: AuthUser, ip?: string) {
    const b = await this.prisma.branch.findUnique({ where: { id }, include: { _count: { select: { screens: true, viewers: true } } } });
    if (!b) throw new NotFoundException('That branch no longer exists');
    if (b._count.screens) throw new BadRequestException(`${b.name} still has ${plural(b._count.screens, "screen", "screens")}. Move or remove them first.`);
    if (b._count.viewers) throw new BadRequestException(`${b.name} still has users. Change their branch first.`);
    await this.prisma.branch.delete({ where: { id } });
    await this.log(user, ip, 'branch.remove', 'Branch', id, { name: b.name, code: b.code });
  }

  // ---- Playlist at a level ----

  async setPlaylist(level: PlaceLevel, id: string | undefined, playlistId: string | null, user: AuthUser, ip?: string): Promise<PlaceTree> {
    if (playlistId && !(await this.prisma.playlist.count({ where: { id: playlistId } }))) {
      throw new BadRequestException('That playlist does not exist. Reload and try again.');
    }
    const target = level as AssignmentTarget;
    let where: Prisma.AssignmentWhereInput;
    let data: Prisma.AssignmentUncheckedCreateInput;
    let screens: Prisma.ScreenWhereInput;
    switch (level) {
      case 'ALL':
        where = { targetType: 'ALL' };
        data = { playlistId: playlistId!, targetType: target };
        screens = {};
        break;
      case 'REGION':
        await this.assertExists('region', id!);
        where = { targetType: 'REGION', regionId: id };
        data = { playlistId: playlistId!, targetType: target, regionId: id };
        screens = { branch: { taluka: { regionId: id } } };
        break;
      case 'TALUKA':
        await this.assertExists('taluka', id!);
        where = { targetType: 'TALUKA', talukaId: id };
        data = { playlistId: playlistId!, targetType: target, talukaId: id };
        screens = { branch: { talukaId: id } };
        break;
      case 'BRANCH':
        await this.assertExists('branch', id!);
        where = { targetType: 'BRANCH', branchId: id };
        data = { playlistId: playlistId!, targetType: target, branchId: id };
        screens = { branchId: id };
        break;
    }

    where = { ...where, schedules: { none: {} } }; // leave timed (scheduled) playlists alone
    const before = await this.prisma.assignment.findFirst({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    await this.prisma.$transaction(async (tx) => {
      await tx.assignment.deleteMany({ where });
      if (playlistId) await tx.assignment.create({ data });
    });
    await this.log(user, ip, 'place.assign_playlist', level === 'ALL' ? 'All' : level[0] + level.slice(1).toLowerCase(), id ?? null, {
      level,
      before: before?.playlistId ?? null,
      after: playlistId,
    });
    await this.notify(screens);
    return this.tree();
  }

  // ---- helpers ----

  /** Tells connected TVs under this part of the tree to fetch their manifest again. */
  private async notify(where: Prisma.ScreenWhereInput) {
    const rows = await this.prisma.screen.findMany({ where: { ...where, status: { not: 'PENDING' } }, select: { id: true } });
    this.events.screensChanged(...rows.map((r) => r.id));
  }

  private async assertExists(kind: 'region' | 'taluka' | 'branch', id: string) {
    const n =
      kind === 'region'
        ? await this.prisma.region.count({ where: { id } })
        : kind === 'taluka'
          ? await this.prisma.taluka.count({ where: { id } })
          : await this.prisma.branch.count({ where: { id } });
    if (!n) throw new BadRequestException(`That ${kind} no longer exists. Reload and try again.`);
  }

  private log(user: AuthUser, ip: string | undefined, action: string, entityType: string, entityId: string | null, details: Prisma.InputJsonValue) {
    return this.audit.log({ userId: user.id, action, entityType, entityId, details, ipAddress: ip });
  }
}
