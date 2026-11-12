import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserEntry, UserRole, UsersResponse } from '@darpan/shared';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto, UpdateUserDto } from './users.dto';

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  regionId: true,
  branchId: true,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Dashboard accounts. Only a SUPER_ADMIN manages them (see UsersController). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<UsersResponse> {
    const [users, regions, branches] = await Promise.all([
      this.prisma.user.findMany({ select: userSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      this.prisma.region.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.branch.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    ]);
    const regionById = new Map(regions.map((r) => [r.id, r]));
    const branchById = new Map(branches.map((b) => [b.id, b]));
    return {
      users: users.map(
        (u): UserEntry => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.isActive,
          region: u.regionId ? (regionById.get(u.regionId) ?? null) : null,
          branch: u.branchId ? (branchById.get(u.branchId) ?? null) : null,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }),
      ),
      regions,
      branches,
    };
  }

  async create(dto: CreateUserDto, actor: AuthUser, ip?: string): Promise<UsersResponse> {
    const scope = await this.scopeFor(dto.role, dto.regionId ?? null, dto.branchId ?? null);
    if (await this.prisma.user.count({ where: { email: dto.email } })) {
      throw new ConflictException('Someone already has an account with that email');
    }
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, role: dto.role, ...scope, passwordHash: await hashPassword(dto.password) },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'user.create',
      entityType: 'User',
      entityId: user.id,
      details: { email: user.email, role: user.role, ...scope },
      ipAddress: ip,
    });
    return this.overview();
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, ip?: string): Promise<UsersResponse> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const role = dto.role ?? user.role;
    const isActive = dto.isActive ?? user.isActive;
    if (id === actor.id && (role !== user.role || !isActive)) {
      throw new BadRequestException('You cannot change your own role or turn off your own account');
    }
    if (user.role === 'SUPER_ADMIN' && user.isActive && (role !== 'SUPER_ADMIN' || !isActive)) {
      const others = await this.prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true, id: { not: id } } });
      if (!others) throw new BadRequestException('Keep at least one active super admin');
    }
    const scope = await this.scopeFor(
      role,
      dto.regionId !== undefined ? dto.regionId : user.regionId,
      dto.branchId !== undefined ? dto.branchId : user.branchId,
    );
    const data = { name: dto.name ?? user.name, role, isActive, ...scope };
    await this.prisma.user.update({ where: { id }, data });
    const before = user as unknown as Record<string, unknown>;
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => before[k] !== v));
    const action = !isActive && user.isActive ? 'user.deactivate' : isActive && !user.isActive ? 'user.activate' : 'user.update';
    await this.audit.log({ userId: actor.id, action, entityType: 'User', entityId: id, details: { email: user.email, changed }, ipAddress: ip });
    return this.overview();
  }

  async resetPassword(id: string, password: string, actor: AuthUser, ip?: string): Promise<UsersResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('User not found');
    // passwordChangedAt signs the person out everywhere (see AuthGuard). Rounded up to the next whole
    // second, because a session's issue time is in whole seconds.
    const passwordChangedAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), passwordChangedAt } });
    await this.audit.log({ userId: actor.id, action: 'user.reset_password', entityType: 'User', entityId: id, details: { email: user.email }, ipAddress: ip });
    return this.overview();
  }

  /** Region managers need a region, branch viewers a branch; head office roles have neither. */
  private async scopeFor(role: UserRole, regionId: string | null, branchId: string | null) {
    if (role === 'REGION_MANAGER') {
      if (!regionId) throw new BadRequestException('Choose the region this manager looks after');
      if (!(await this.prisma.region.count({ where: { id: regionId } }))) throw new BadRequestException('That region does not exist');
      return { regionId, branchId: null };
    }
    if (role === 'BRANCH_VIEWER') {
      if (!branchId) throw new BadRequestException('Choose the branch this person belongs to');
      if (!(await this.prisma.branch.count({ where: { id: branchId } }))) throw new BadRequestException('That branch does not exist');
      return { regionId: null, branchId };
    }
    return { regionId: null, branchId: null };
  }
}
