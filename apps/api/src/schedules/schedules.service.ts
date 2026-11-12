import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  slotsActive,
  slotsExpired,
  toMinutes,
  type DisplayHoursEntry,
  type DisplayHoursValue,
  type PlaylistSource,
  type ScheduleEntry,
  type TimeSlot,
} from '@darpan/shared';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { dateOnly } from '../screens/playlist-resolver.service';
import type { CreateScheduleDto, DisplayHoursDto, UpdateScheduleDto } from './schedule.dto';

const targetInclude = {
  screen: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  taluka: { select: { id: true, name: true } },
  region: { select: { id: true, name: true } },
} as const;

type WithTargets = {
  targetType: PlaylistSource;
  screen: { id: string; name: string | null } | null;
  branch: { id: string; name: string } | null;
  taluka: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
};

function targetOf(r: WithTargets): { id: string; name: string } | null {
  const t = r.screen ?? r.branch ?? r.taluka ?? r.region;
  return t ? { id: t.id, name: t.name ?? 'Unnamed screen' } : null;
}

/** "YYYY-MM-DD" as a DATE column value. */
const asDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: ContentEvents,
  ) {}

  // ---- Timed playlists ----

  async list(): Promise<ScheduleEntry[]> {
    const rows = await this.prisma.assignment.findMany({
      where: { schedules: { some: {} } },
      include: { ...targetInclude, playlist: { select: { id: true, name: true } }, schedules: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return rows.map((a) => {
      const slots = a.schedules.map<TimeSlot>((s) => ({
        days: s.daysOfWeek,
        start: s.startTime,
        end: s.endTime,
        fromDate: dateOnly(s.startDate),
        toDate: dateOnly(s.endDate),
      }));
      return {
        id: a.id,
        level: a.targetType,
        target: targetOf(a),
        playlist: a.playlist,
        slots,
        activeNow: slotsActive(slots, now),
        expired: slotsExpired(slots, now),
        createdAt: a.createdAt.toISOString(),
      };
    });
  }

  async create(dto: CreateScheduleDto, user: AuthUser, ip?: string): Promise<ScheduleEntry> {
    const slots = this.checkSlots(dto.slots);
    await this.assertPlaylist(dto.playlistId);
    const target = await this.target(dto.level, dto.targetId);
    const a = await this.prisma.assignment.create({
      data: {
        playlistId: dto.playlistId,
        targetType: dto.level,
        ...target.fields,
        schedules: { create: slots.map((s) => this.slotData(s)) },
      },
    });
    await this.log(user, ip, 'schedule.create', a.id, { level: dto.level, target: target.name, playlistId: dto.playlistId, slots } as unknown as Prisma.InputJsonValue);
    await this.notify(target.screens);
    return this.entry(a.id);
  }

  async update(id: string, dto: UpdateScheduleDto, user: AuthUser, ip?: string): Promise<ScheduleEntry> {
    const before = await this.entry(id);
    const slots = this.checkSlots(dto.slots);
    await this.assertPlaylist(dto.playlistId);
    await this.prisma.$transaction(async (tx) => {
      await tx.schedule.deleteMany({ where: { assignmentId: id } });
      await tx.assignment.update({
        where: { id },
        data: { playlistId: dto.playlistId, schedules: { create: slots.map((s) => this.slotData(s)) } },
      });
    });
    await this.log(user, ip, 'schedule.update', id, {
      before: { playlistId: before.playlist.id, slots: before.slots },
      after: { playlistId: dto.playlistId, slots },
    } as unknown as Prisma.InputJsonValue);
    await this.notify((await this.target(before.level, before.target?.id)).screens);
    return this.entry(id);
  }

  async remove(id: string, user: AuthUser, ip?: string): Promise<void> {
    const before = await this.entry(id);
    await this.prisma.assignment.delete({ where: { id } });
    await this.log(user, ip, 'schedule.remove', id, {
      level: before.level,
      target: before.target?.name ?? null,
      playlist: before.playlist.name,
      slots: before.slots,
    } as unknown as Prisma.InputJsonValue);
    await this.notify((await this.target(before.level, before.target?.id)).screens);
  }

  private async entry(id: string): Promise<ScheduleEntry> {
    const e = (await this.list()).find((x) => x.id === id);
    if (!e) throw new NotFoundException('That schedule no longer exists');
    return e;
  }

  /** Cleans up slots and rejects ones that would never, or always, play. */
  private checkSlots(slots: TimeSlot[]): TimeSlot[] {
    return slots.map((s, i) => {
      const n = slots.length > 1 ? ` (time ${i + 1})` : '';
      const days = [...new Set(s.days)].sort((a, b) => a - b);
      const slot: TimeSlot = { days: days.length === 7 ? [] : days, start: s.start, end: s.end, fromDate: s.fromDate, toDate: s.toDate };
      if (!slot.days.length && !slot.start && !slot.end && !slot.fromDate && !slot.toDate) {
        throw new BadRequestException(`Choose days, times or dates${n}. To play all the time, set it as the main playlist instead.`);
      }
      if (slot.start && slot.end && toMinutes(slot.start) === toMinutes(slot.end)) {
        throw new BadRequestException(`Start and end time are the same${n}`);
      }
      if (slot.fromDate && slot.toDate && slot.fromDate > slot.toDate) {
        throw new BadRequestException(`The end date is before the start date${n}`);
      }
      return slot;
    });
  }

  private slotData(s: TimeSlot) {
    return { daysOfWeek: s.days, startTime: s.start, endTime: s.end, startDate: asDate(s.fromDate), endDate: asDate(s.toDate) };
  }

  // ---- Display hours ----

  async listHours(): Promise<DisplayHoursEntry[]> {
    const rows = await this.prisma.displayHours.findMany({ include: targetInclude, orderBy: { updatedAt: 'desc' } });
    const order: Record<PlaylistSource, number> = { ALL: 0, REGION: 1, TALUKA: 2, BRANCH: 3, SCREEN: 4 };
    return rows
      .map((r) => ({
        id: r.id,
        level: r.targetType,
        target: targetOf(r),
        hours: { days: r.daysOfWeek, on: r.onTime, off: r.offTime, closedSaturdays: r.closedSaturdays, brightness: r.brightness },
      }))
      .sort((a, b) => order[a.level] - order[b.level] || (a.target?.name ?? '').localeCompare(b.target?.name ?? ''));
  }

  async setHours(level: PlaylistSource, targetId: string | undefined, dto: DisplayHoursDto | null, user: AuthUser, ip?: string) {
    const target = await this.target(level, targetId);
    let hours: DisplayHoursValue | null = null;
    if (dto) {
      if (dto.on === dto.off) throw new BadRequestException('On and off time are the same');
      const days = [...new Set(dto.days)].sort((a, b) => a - b);
      hours = { days, on: dto.on, off: dto.off, closedSaturdays: [...new Set(dto.closedSaturdays)].sort(), brightness: dto.brightness ?? null };
    }
    const where = { targetType: level, ...target.fields };
    const before = await this.prisma.displayHours.findFirst({ where });
    await this.prisma.$transaction(async (tx) => {
      await tx.displayHours.deleteMany({ where });
      if (hours) {
        await tx.displayHours.create({
          data: { ...where, daysOfWeek: hours.days, onTime: hours.on, offTime: hours.off, closedSaturdays: hours.closedSaturdays, brightness: hours.brightness ?? null },
        });
      }
    });
    await this.log(user, ip, 'display_hours.set', targetId ?? null, {
      level,
      target: target.name,
      before: before
        ? { days: before.daysOfWeek, on: before.onTime, off: before.offTime, closedSaturdays: before.closedSaturdays, brightness: before.brightness }
        : null,
      after: hours,
    } as unknown as Prisma.InputJsonValue);
    await this.notify(target.screens);
    return this.listHours();
  }

  // ---- helpers ----

  /** Checks the target exists; returns its column values, name and the screens under it. */
  private async target(level: PlaylistSource, id: string | undefined) {
    const missing = () => new BadRequestException('That place or screen no longer exists. Reload and try again.');
    switch (level) {
      case 'ALL':
        return { fields: {}, name: 'Every screen', screens: {} as Prisma.ScreenWhereInput };
      case 'REGION': {
        const r = await this.prisma.region.findUnique({ where: { id } });
        if (!r) throw missing();
        return { fields: { regionId: r.id }, name: r.name, screens: { branch: { taluka: { regionId: r.id } } } };
      }
      case 'TALUKA': {
        const t = await this.prisma.taluka.findUnique({ where: { id } });
        if (!t) throw missing();
        return { fields: { talukaId: t.id }, name: t.name, screens: { branch: { talukaId: t.id } } };
      }
      case 'BRANCH': {
        const b = await this.prisma.branch.findUnique({ where: { id } });
        if (!b) throw missing();
        return { fields: { branchId: b.id }, name: b.name, screens: { branchId: b.id } };
      }
      case 'SCREEN': {
        const s = await this.prisma.screen.findUnique({ where: { id } });
        if (!s || s.name === null) throw missing();
        return { fields: { screenId: s.id }, name: s.name, screens: { id: s.id } };
      }
    }
  }

  private async assertPlaylist(id: string) {
    if (!(await this.prisma.playlist.count({ where: { id } }))) {
      throw new BadRequestException('That playlist does not exist. Reload and try again.');
    }
  }

  private async notify(where: Prisma.ScreenWhereInput) {
    const rows = await this.prisma.screen.findMany({ where: { ...where, status: { not: 'PENDING' } }, select: { id: true } });
    this.events.screensChanged(...rows.map((r) => r.id));
  }

  private log(user: AuthUser, ip: string | undefined, action: string, entityId: string | null, details: Prisma.InputJsonValue) {
    return this.audit.log({ userId: user.id, action, entityType: action.startsWith('display') ? 'DisplayHours' : 'Schedule', entityId, details, ipAddress: ip });
  }
}
