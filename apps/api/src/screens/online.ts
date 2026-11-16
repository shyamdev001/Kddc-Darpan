import { ONLINE_WINDOW_MS } from '@darpan/shared';
import type { Prisma, ScreenStatus } from '../generated/prisma/client';

/**
 * Online = the TV holds its live connection (the gateway sets ONLINE on connect, OFFLINE on
 * disconnect) and was heard from recently. The time window alone kept a switched-off TV "online"
 * for up to 3 minutes; the status alone could stick if the server missed a disconnect.
 */
export function isOnline(s: { status: ScreenStatus; lastSeenAt: Date | null }, now = Date.now()): boolean {
  return s.status === 'ONLINE' && s.lastSeenAt !== null && now - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

/** The same rule as a database filter. */
export function onlineWhere(now = Date.now()): Prisma.ScreenWhereInput {
  return { status: 'ONLINE', lastSeenAt: { gte: new Date(now - ONLINE_WINDOW_MS) } };
}
