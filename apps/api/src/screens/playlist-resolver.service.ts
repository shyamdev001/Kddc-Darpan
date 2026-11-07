import { Injectable } from '@nestjs/common';
import type { PlaylistSource } from '@darpan/shared';
import type { AssignmentTarget } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Most specific wins: a playlist set on the screen beats its branch, then taluka, region, all. */
const RANK: Record<AssignmentTarget, number> = { SCREEN: 4, BRANCH: 3, TALUKA: 2, REGION: 1, ALL: 0 };

export interface ResolvedPlaylist {
  playlistId: string;
  name: string;
  source: PlaylistSource;
}

interface ScreenPlace {
  id: string;
  branchId: string | null;
  branch: { talukaId: string; taluka: { regionId: string } } | null;
}

@Injectable()
export class PlaylistResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves many screens with one query (the screens list). */
  /** With skipScreen, ignores playlists set on the screen itself: what it would play without one. */
  async resolveMany(screens: ScreenPlace[], skipScreen = false): Promise<Map<string, ResolvedPlaylist>> {
    const out = new Map<string, ResolvedPlaylist>();
    if (!screens.length) return out;

    const ids = (pick: (s: ScreenPlace) => string | null | undefined) => [...new Set(screens.map(pick).filter((x): x is string => !!x))];
    const assignments = await this.prisma.assignment.findMany({
      where: {
        OR: [
          { targetType: 'SCREEN', screenId: { in: ids((s) => s.id) } },
          { targetType: 'BRANCH', branchId: { in: ids((s) => s.branchId) } },
          { targetType: 'TALUKA', talukaId: { in: ids((s) => s.branch?.talukaId) } },
          { targetType: 'REGION', regionId: { in: ids((s) => s.branch?.taluka.regionId) } },
          { targetType: 'ALL' },
        ],
      },
      include: { playlist: { select: { name: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    for (const s of screens) {
      let best: (typeof assignments)[number] | undefined;
      for (const a of assignments) {
        const applies =
          (!skipScreen && a.targetType === 'SCREEN' && a.screenId === s.id) ||
          (s.branchId !== null &&
            ((a.targetType === 'BRANCH' && a.branchId === s.branchId) ||
              (a.targetType === 'TALUKA' && a.talukaId === s.branch?.talukaId) ||
              (a.targetType === 'REGION' && a.regionId === s.branch?.taluka.regionId) ||
              a.targetType === 'ALL'));
        // assignments are already sorted by priority then newest, so keep the first of the highest rank
        if (applies && (!best || RANK[a.targetType] > RANK[best.targetType])) best = a;
      }
      if (best) out.set(s.id, { playlistId: best.playlistId, name: best.playlist.name, source: best.targetType });
    }
    return out;
  }

  async resolve(screen: ScreenPlace, skipScreen = false): Promise<ResolvedPlaylist | null> {
    return (await this.resolveMany([screen], skipScreen)).get(screen.id) ?? null;
  }
}

export const screenPlaceSelect = {
  id: true,
  branchId: true,
  branch: { select: { talukaId: true, taluka: { select: { regionId: true } } } },
} as const;
