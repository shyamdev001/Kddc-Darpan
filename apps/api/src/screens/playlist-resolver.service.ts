import { Injectable } from '@nestjs/common';
import { slotsActive, slotsExpired, type DisplayHoursValue, type PlaylistSource, type TimeSlot } from '@darpan/shared';
import type { AssignmentTarget } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Most specific wins: a playlist set on the screen beats its branch, then taluka, region, all. */
const RANK: Record<AssignmentTarget, number> = { SCREEN: 4, BRANCH: 3, TALUKA: 2, REGION: 1, ALL: 0 };

export interface ResolvedPlaylist {
  playlistId: string;
  name: string;
  source: PlaylistSource;
  /** Empty for the always-on playlist of a level. */
  slots: TimeSlot[];
}

interface ScreenPlace {
  id: string;
  branchId: string | null;
  branch: { talukaId: string; taluka: { regionId: string } } | null;
}

type Target = { targetType: AssignmentTarget; screenId: string | null; branchId: string | null; talukaId: string | null; regionId: string | null };

/** Does an assignment (or display-hours row) set at some level apply to this screen? */
function appliesTo(a: Target, s: ScreenPlace, skipScreen: boolean): boolean {
  if (a.targetType === 'SCREEN') return !skipScreen && a.screenId === s.id;
  if (s.branchId === null) return false; // a screen with no branch only follows its own settings
  switch (a.targetType) {
    case 'BRANCH':
      return a.branchId === s.branchId;
    case 'TALUKA':
      return a.talukaId === s.branch?.talukaId;
    case 'REGION':
      return a.regionId === s.branch?.taluka.regionId;
    default:
      return true;
  }
}

export const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

@Injectable()
export class PlaylistResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every playlist that may play on each screen, most important first: closer level first, and
   * within a level, timed (scheduled) playlists before the always-on one. Ended schedules are
   * dropped, and the list stops at the first always-on playlist since nothing after it can play.
   */
  async layersMany(screens: ScreenPlace[], skipScreen = false, at = new Date()): Promise<Map<string, ResolvedPlaylist[]>> {
    const out = new Map<string, ResolvedPlaylist[]>();
    if (!screens.length) return out;

    const ids = (pick: (s: ScreenPlace) => string | null | undefined) => [...new Set(screens.map(pick).filter((x): x is string => !!x))];
    const rows = await this.prisma.assignment.findMany({
      where: {
        OR: [
          { targetType: 'SCREEN', screenId: { in: ids((s) => s.id) } },
          { targetType: 'BRANCH', branchId: { in: ids((s) => s.branchId) } },
          { targetType: 'TALUKA', talukaId: { in: ids((s) => s.branch?.talukaId) } },
          { targetType: 'REGION', regionId: { in: ids((s) => s.branch?.taluka.regionId) } },
          { targetType: 'ALL' },
        ],
      },
      include: { playlist: { select: { name: true } }, schedules: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const candidates = rows
      .map((a) => ({
        a,
        slots: a.schedules.map<TimeSlot>((s) => ({
          days: s.daysOfWeek,
          start: s.startTime,
          end: s.endTime,
          fromDate: dateOnly(s.startDate),
          toDate: dateOnly(s.endDate),
        })),
      }))
      .filter((c) => !slotsExpired(c.slots, at))
      // stable sort keeps priority/newest order inside each group
      .sort((x, y) => RANK[y.a.targetType] - RANK[x.a.targetType] || Number(y.slots.length > 0) - Number(x.slots.length > 0));

    for (const s of screens) {
      const layers: ResolvedPlaylist[] = [];
      for (const c of candidates) {
        if (!appliesTo(c.a, s, skipScreen)) continue;
        layers.push({ playlistId: c.a.playlistId, name: c.a.playlist.name, source: c.a.targetType, slots: c.slots });
        if (!c.slots.length) break;
      }
      out.set(s.id, layers);
    }
    return out;
  }

  /** What each screen plays at this moment (the screens list). */
  async resolveMany(screens: ScreenPlace[], skipScreen = false, at = new Date()): Promise<Map<string, ResolvedPlaylist>> {
    const layers = await this.layersMany(screens, skipScreen, at);
    const out = new Map<string, ResolvedPlaylist>();
    for (const [id, list] of layers) {
      const now = list.find((l) => slotsActive(l.slots, at));
      if (now) out.set(id, now);
    }
    return out;
  }

  async resolve(screen: ScreenPlace, skipScreen = false, at = new Date()): Promise<ResolvedPlaylist | null> {
    return (await this.resolveMany([screen], skipScreen, at)).get(screen.id) ?? null;
  }

  async layers(screen: ScreenPlace, skipScreen = false, at = new Date()): Promise<ResolvedPlaylist[]> {
    return (await this.layersMany([screen], skipScreen, at)).get(screen.id) ?? [];
  }

  /** Display hours from the closest level that sets them; null = always on. */
  async hoursMany(screens: ScreenPlace[]): Promise<Map<string, { hours: DisplayHoursValue; source: PlaylistSource } | null>> {
    const rows = await this.prisma.displayHours.findMany();
    const out = new Map<string, { hours: DisplayHoursValue; source: PlaylistSource } | null>();
    for (const s of screens) {
      let best: (typeof rows)[number] | undefined;
      for (const r of rows) if (appliesTo(r, s, false) && (!best || RANK[r.targetType] > RANK[best.targetType])) best = r;
      out.set(
        s.id,
        best
          ? { source: best.targetType, hours: { days: best.daysOfWeek, on: best.onTime, off: best.offTime, closedSaturdays: best.closedSaturdays, brightness: best.brightness } }
          : null,
      );
    }
    return out;
  }

  async hours(screen: ScreenPlace) {
    return (await this.hoursMany([screen])).get(screen.id) ?? null;
  }
}

export const screenPlaceSelect = {
  id: true,
  branchId: true,
  branch: { select: { talukaId: true, taluka: { select: { regionId: true } } } },
} as const;
