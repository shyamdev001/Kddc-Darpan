import { Controller, Get } from '@nestjs/common';
import { ONLINE_WINDOW_MS } from '@darpan/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { branchScope, isHeadOffice, screenScope } from '../auth/scope';
import { PrismaService } from '../prisma/prisma.service';

/** Ads ending within this many days show as "expiring soon". */
const EXPIRY_WINDOW_DAYS = 7;

@Controller('stats')
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const scope = screenScope(user);
    const ho = isHeadOffice(user);
    const now = new Date();
    const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const expiryCutoff = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000);

    const [screensTotal, screensOnline, screensUnpaired, branches, media, mediaExpiring, playlists, assignments] =
      await this.prisma.$transaction([
        this.prisma.screen.count({ where: { NOT: { status: 'PENDING', name: null }, ...scope } }),
        this.prisma.screen.count({ where: { status: { not: 'PENDING' }, lastSeenAt: { gte: onlineSince }, ...scope } }),
        this.prisma.screen.count({ where: { status: 'PENDING', name: null, pairingExpires: { gt: now }, ...(ho ? {} : { id: { in: [] } }) } }),
        this.prisma.branch.count({ where: branchScope(user) }),
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
