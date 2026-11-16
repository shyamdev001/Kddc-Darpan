import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WebSocketGateway, WebSocketServer, type OnGatewayInit } from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import {
  DASHBOARD_NAMESPACE,
  DASHBOARD_SOCKET_PATH,
  SCREENS_CHANGED_EVENT,
  type ScreensChangedPayload,
} from '@darpan/shared';
import { bufferTime, filter, map, merge, type Subscription } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../auth/auth.constants';
import type { SessionPayload } from '../auth/auth.types';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';

/** Gather changes this long, so 30 TVs reporting at once cause one reload, not 30. */
const BATCH_MS = 400;

/**
 * Live channel to open dashboards. It says only which screens changed (connected, went away,
 * now playing something else, settings edited); the page reloads through the normal API, which
 * applies the user's role and area. Signed in with the same session cookie as the API.
 */
@SkipThrottle()
@WebSocketGateway({
  namespace: DASHBOARD_NAMESPACE,
  path: DASHBOARD_SOCKET_PATH,
  addTrailingSlash: false,
  // Same origin through the dashboard (and Caddy in production): no cross-site access.
  cors: false,
  serveClient: false,
  destroyUpgrade: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class DashboardGateway implements OnGatewayInit, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardGateway.name);
  private sub?: Subscription;

  @WebSocketServer() private readonly ns!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly events: ContentEvents,
  ) {}

  onModuleInit() {
    this.sub = merge(
      this.events.screenUpdates.pipe(map((id) => [id])),
      // Playlist, schedule or broadcast edits change what screens show too.
      this.events.changes.pipe(map((c) => (c.all ? ['*'] : c.screenIds))),
    )
      .pipe(
        bufferTime(BATCH_MS),
        filter((batch) => batch.length > 0),
      )
      .subscribe((batch) => {
        const ids = [...new Set(batch.flat())];
        const payload: ScreensChangedPayload = { screenIds: ids.includes('*') ? [] : ids };
        this.ns?.emit(SCREENS_CHANGED_EVENT, payload);
      });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  afterInit(ns: Namespace) {
    ns.use((socket, next) => {
      this.signedIn(socket)
        .then((ok) => next(ok ? undefined : new Error('unauthorized')))
        .catch((err: Error) => {
          this.logger.error('Dashboard socket auth failed', err);
          next(new Error('server error'));
        });
    });
  }

  /** The same checks as the HTTP guard: a real session of an active user, not revoked by a password change. */
  private async signedIn(socket: Socket): Promise<boolean> {
    const token = readCookie(socket.request.headers.cookie, SESSION_COOKIE);
    if (!token) return false;
    let payload: SessionPayload & { iat?: number; purpose?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      return false;
    }
    if (payload.purpose !== undefined) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, passwordChangedAt: true },
    });
    if (!user?.isActive) return false;
    if (user.passwordChangedAt && (payload.iat ?? 0) * 1000 < user.passwordChangedAt.getTime()) return false;
    return true;
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
