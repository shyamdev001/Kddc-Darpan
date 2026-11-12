import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import { DEVICE_NAMESPACE, KIOSK_STATES, type CommandAckPayload, type DeviceCommandPayload, type HeartbeatPayload } from '@darpan/shared';
import { bufferTime, filter, Subject, type Subscription } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import { ContentEvents } from '../events/content-events';
import { PrismaService } from '../prisma/prisma.service';
import { hashDeviceToken } from './device-auth';
import { ManifestService } from './manifest.service';

interface DeviceData {
  screenId: string;
}

const room = (screenId: string) => `screen:${screenId}`;
const mb = (bytes: unknown) => (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes / 1_048_576) : undefined);
const shortText = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);

/**
 * Live channel to the TVs. A TV connects with its device token, sends a heartbeat every 60 s,
 * and is told `manifest:updated` whenever what it should play changes.
 */
// The HTTP rate limiter does not apply to sockets (it reads req.ip, which a socket message lacks).
@SkipThrottle()
@WebSocketGateway({ namespace: DEVICE_NAMESPACE, cors: false, pingInterval: 25_000, pingTimeout: 20_000 })
export class DevicesGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicesGateway.name);
  private sub?: Subscription;

  /** Command replies from TVs; CommandsService records them (kept here to avoid a circular dependency). */
  readonly acks = new Subject<{ screenId: string; commandId: string; ok: boolean; error?: string }>();

  @WebSocketServer() private readonly ns!: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly manifests: ManifestService,
    private readonly events: ContentEvents,
  ) {}

  onModuleInit() {
    // Collect changes for 2 s, so saving a playlist with 30 edits sends one update, not 30.
    this.sub = this.events.changes
      .pipe(
        bufferTime(2_000),
        filter((batch) => batch.length > 0),
      )
      .subscribe((batch) => {
        const all = batch.some((c) => c.all);
        const ids = all ? null : [...new Set(batch.flatMap((c) => (c.all ? [] : c.screenIds)))];
        void this.pushManifests(ids);
      });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  /**
   * Authenticate in middleware, not in handleConnection: the client only sees `connect` after this
   * finishes, so its first heartbeat can never arrive before we know which screen it is.
   * A bad token fails the handshake with `connect_error` "unauthorized"; the TV then registers again.
   */
  afterInit(ns: Namespace) {
    ns.use((socket, next) => {
      const auth = socket.handshake.auth as { token?: unknown } | undefined;
      const token = typeof auth?.token === 'string' ? auth.token : '';
      if (!token) return next(new Error('unauthorized'));
      this.prisma.screen
        .findUnique({ where: { deviceTokenHash: hashDeviceToken(token) }, select: { id: true, status: true } })
        .then(async (screen) => {
          if (!screen) return next(new Error('unauthorized'));
          (socket.data as DeviceData).screenId = screen.id;
          await socket.join(room(screen.id));
          await this.prisma.screen.update({
            where: { id: screen.id },
            data: {
              lastSeenAt: new Date(),
              ipAddress: socket.handshake.address || null,
              ...(screen.status !== 'PENDING' ? { status: 'ONLINE' } : {}),
            },
          });
          next();
        })
        .catch((err: Error) => {
          this.logger.error('Device socket auth failed', err);
          next(new Error('server error'));
        });
    });
  }

  handleConnection(socket: Socket) {
    this.logger.log(`Screen ${(socket.data as DeviceData).screenId} connected`);
  }

  async handleDisconnect(socket: Socket) {
    const screenId = (socket.data as Partial<DeviceData>).screenId;
    if (!screenId) return;
    // Another connection from the same TV may still be open (reconnect race); only mark offline if none is.
    const still = await this.ns.in(room(screenId)).fetchSockets();
    if (still.length === 0) {
      await this.prisma.screen.updateMany({ where: { id: screenId, status: 'ONLINE' }, data: { status: 'OFFLINE' } });
    }
  }

  @SubscribeMessage('heartbeat')
  async heartbeat(@ConnectedSocket() socket: Socket, @MessageBody() body: Partial<HeartbeatPayload> | undefined) {
    const screenId = (socket.data as Partial<DeviceData>).screenId;
    if (!screenId || typeof body !== 'object' || body === null) return { ok: false };

    // currentMediaId is a foreign key: only store it if that media still exists.
    let currentMediaId: string | null = null;
    if (typeof body.currentMediaId === 'string' && /^[0-9a-f-]{36}$/i.test(body.currentMediaId)) {
      const exists = await this.prisma.media.count({ where: { id: body.currentMediaId } });
      currentMediaId = exists ? body.currentMediaId : null;
    }

    await this.prisma.screen.updateMany({
      where: { id: screenId },
      data: {
        lastSeenAt: new Date(),
        currentMediaId,
        storageFreeMb: mb(body.storageFreeBytes),
        storageTotalMb: mb(body.storageTotalBytes),
        ramFreeMb: mb(body.ramFreeBytes),
        ramTotalMb: mb(body.ramTotalBytes),
        appVersion: shortText(body.appVersion, 40),
        manifestVersion: shortText(body.manifestVersion, 64),
        ...(Number.isInteger(body.appVersionCode) && body.appVersionCode! > 0 && body.appVersionCode! < 2 ** 31
          ? { appVersionCode: body.appVersionCode }
          : {}),
        ...('updateStatus' in body ? { updateStatus: shortText(body.updateStatus, 200) ?? null } : {}),
        // Older app versions send no kiosk fields: leave what we had.
        ...(typeof body.kiosk === 'string' && (KIOSK_STATES as readonly string[]).includes(body.kiosk)
          ? { kioskState: body.kiosk, kioskUntil: kioskUntil(body.kiosk, body.kioskUntil) }
          : {}),
      },
    });
    return { ok: true };
  }

  @SubscribeMessage('command:ack')
  commandAck(@ConnectedSocket() socket: Socket, @MessageBody() body: Partial<CommandAckPayload> | undefined) {
    const screenId = (socket.data as Partial<DeviceData>).screenId;
    if (!screenId || typeof body !== 'object' || body === null) return { ok: false };
    if (typeof body.commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.commandId)) return { ok: false };
    this.acks.next({ screenId, commandId: body.commandId, ok: body.ok === true, error: shortText(body.error, 200) });
    return { ok: true };
  }

  async isConnected(screenId: string): Promise<boolean> {
    return (await this.ns.in(room(screenId)).fetchSockets()).length > 0;
  }

  /** Sends a command to a connected TV; false when it is not connected. */
  async sendCommand(screenId: string, payload: DeviceCommandPayload): Promise<boolean> {
    if (!(await this.isConnected(screenId))) return false;
    this.ns.to(room(screenId)).emit('command', payload);
    return true;
  }

  /** Forcibly disconnect a TV (it was removed from the dashboard). */
  disconnectScreen(screenId: string) {
    this.ns.in(room(screenId)).disconnectSockets(true);
  }

  /** Tells each connected TV (or just `screenIds`) its current manifest version. */
  private async pushManifests(screenIds: string[] | null) {
    try {
      const sockets = await this.ns.fetchSockets();
      const connected = new Set(sockets.map((s) => (s.data as Partial<DeviceData>).screenId).filter((x): x is string => !!x));
      const targets = (screenIds ?? [...connected]).filter((id) => connected.has(id));
      for (const id of targets) {
        const paired = await this.prisma.screen.count({ where: { id, status: { not: 'PENDING' } } });
        if (!paired) continue;
        const { version } = await this.manifests.build(id);
        this.ns.to(room(id)).emit('manifest:updated', { version });
      }
      if (targets.length) this.logger.log(`manifest:updated sent to ${targets.length} screen(s)`);
    } catch (err) {
      this.logger.error('Failed to push manifest updates', err as Error);
    }
  }
}

/** Maintenance end time from the TV, ignored unless it is soon (a TV clock can be wrong). */
function kioskUntil(state: string, value: unknown): Date | null {
  if (state !== 'maintenance' || typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > Date.now() - 60_000 && t < Date.now() + 24 * 3_600_000 ? new Date(t) : null;
}
