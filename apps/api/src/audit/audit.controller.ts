import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ACTIVITY_EXPORT_MAX, ACTIVITY_PAGE_SIZE, MAX_REPORT_DAYS, type ActivityEntry, type ActivityResponse } from '@darpan/shared';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../auth/decorators';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export class ActivityQueryDto {
  @Matches(DAY, { message: 'from must be a date like 2026-11-01' })
  from!: string;

  @Matches(DAY, { message: 'to must be a date like 2026-11-30' })
  to!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

/**
 * Read-only view of the audit log: who changed what, and when. Super admins only, because it
 * includes failed sign-ins and every person's actions.
 */
@Controller('activity')
@Roles('SUPER_ADMIN')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ActivityQueryDto): Promise<ActivityResponse> {
    const where: Prisma.AuditLogWhereInput = { AND: [this.where(q), this.cursor(q.before)] };
    const [rows, users, areas] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_PAGE_SIZE + 1,
      }),
      this.prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
    ]);
    const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
    const last = page[page.length - 1];
    return {
      entries: page.map(toEntry),
      next: rows.length > ACTIVITY_PAGE_SIZE && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url') : null,
      users,
      areas: areas.map((a) => a.entityType),
    };
  }

  /** UTF-8 with a BOM so Excel shows Gujarati names correctly. */
  @Get('export')
  async export(@Query() q: ActivityQueryDto, @Res() res: Response) {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(q),
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ACTIVITY_EXPORT_MAX,
    });
    const lines = [['Time (India)', 'Person', 'Email', 'Action', 'Area', 'Item', 'Details', 'IP address'].join(',')];
    for (const r of rows) {
      lines.push(
        [
          istTime(r.createdAt),
          r.user?.name ?? '',
          r.user?.email ?? '',
          r.action,
          r.entityType,
          r.entityId ?? '',
          r.details === null ? '' : JSON.stringify(r.details),
          r.ipAddress ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="activity-${q.from}-to-${q.to}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send('﻿' + lines.join('\r\n') + '\r\n');
  }

  /** Dates are India dates: from 00:00 IST on `from` up to the end of `to`. */
  private where(q: ActivityQueryDto): Prisma.AuditLogWhereInput {
    const from = Date.parse(`${q.from}T00:00:00+05:30`);
    const to = Date.parse(`${q.to}T00:00:00+05:30`);
    if (Number.isNaN(from) || Number.isNaN(to)) throw new BadRequestException('Not a real date');
    if (to < from) throw new BadRequestException('The end date is before the start date');
    if ((to - from) / DAY_MS + 1 > MAX_REPORT_DAYS) throw new BadRequestException(`Choose at most ${MAX_REPORT_DAYS} days`);
    return {
      createdAt: { gte: new Date(from), lt: new Date(to + DAY_MS) },
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.area ? { entityType: q.area } : {}),
    };
  }

  private cursor(before?: string): Prisma.AuditLogWhereInput {
    if (!before) return {};
    const [iso, id] = Buffer.from(before, 'base64url').toString().split('|');
    const at = new Date(iso ?? '');
    if (Number.isNaN(at.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('Bad page marker');
    return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] };
  }
}

function toEntry(r: {
  id: string;
  createdAt: Date;
  user: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
}): ActivityEntry {
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    user: r.user,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    details: r.details ?? null,
    ipAddress: r.ipAddress,
  };
}

function istTime(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** Quotes a CSV cell, and stops Excel from reading text like "=SUM(...)" as a formula. */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
