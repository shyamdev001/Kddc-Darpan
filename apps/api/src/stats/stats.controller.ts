import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** A screen counts as online if it sent a heartbeat in the last 3 minutes (heartbeat is every 60 s). */
const ONLINE_WINDOW_MS = 3 * 60_000;
/** Ads ending within this many days show as "expiring soon". */
const EXPIRY_WINDOW_DAYS = 7;

@Controller('stats')
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview() {
    const now = new Date();
    const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const expiryCutoff = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000);

    const [screensTotal, screensOnline, screensUnpaired, branches, media, mediaExpiring, playlists, assignments] =
      await this.prisma.$transaction([
        this.prisma.screen.count({ where: { branchId: { not: null } } }),
        this.prisma.screen.count({ where: { branchId: { not: null }, lastSeenAt: { gte: onlineSince } } }),
        this.prisma.screen.count({ where: { branchId: null } }),
        this.prisma.branch.count(),
        this.prisma.media.count(),
        this.prisma.media.count({ where: { endDate: { gte: now, lte: expiryCutoff } } }),
        this.prisma.playlist.count(),
        this.prisma.assignment.count(),
      ]);

    return {
      screens: { total: screensTotal, online: screensOnline, waitingToPair: screensUnpaired },
      branches,
      media: { total: media, expiringSoon: mediaExpiring },
      playlists,
      assignments,
      generatedAt: now.toISOString(),
    };
  }
}
