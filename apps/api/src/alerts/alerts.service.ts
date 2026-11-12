import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ONLINE_WINDOW_MS, hoursOn, type AlertEntry, type AlertSettingsValue, type AlertsResponse } from '@darpan/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { isHeadOffice, screenScope } from '../auth/scope';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlaylistResolver } from '../screens/playlist-resolver.service';
import type { UpdateAlertSettingsDto } from './alert.dto';

const CHECK_EVERY_MS = 60_000;
const RECENT_DAYS = 7;

const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_DAY_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }); // yyyy-mm-dd

const alertInclude = { screen: { select: { id: true, name: true, branch: { select: { name: true } } } } } as const;

function duration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/**
 * Watches for TVs that stop checking in and emails a digest.
 *
 * A screen is only reported while it should be on: inside its display hours, or for screens
 * without hours, inside the alert window. A branch TV switched off at 6 pm is not news; one that
 * did not come on at 10 am is. Every stretch offline is kept (ScreenAlert) for the dashboard.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name);
  private readonly startedAt = Date.now();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PlaylistResolver,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---- Settings ----

  async settings(): Promise<AlertSettingsValue> {
    const row = (await this.prisma.alertSettings.findUnique({ where: { id: 1 } })) ?? (await this.prisma.alertSettings.create({ data: { id: 1 } }));
    return {
      enabled: row.enabled,
      offlineAfterMin: row.offlineAfterMin,
      recipients: row.recipients,
      window: { days: row.daysOfWeek, on: row.onTime, off: row.offTime, closedSaturdays: row.closedSaturdays },
    };
  }

  async updateSettings(dto: UpdateAlertSettingsDto, user: AuthUser, ip?: string): Promise<AlertsResponse> {
    if (dto.window.on === dto.window.off) throw new BadRequestException('The alert window starts and ends at the same time');
    const data = {
      enabled: dto.enabled,
      offlineAfterMin: dto.offlineAfterMin,
      recipients: dto.recipients,
      daysOfWeek: [...new Set(dto.window.days)].sort((a, b) => a - b),
      onTime: dto.window.on,
      offTime: dto.window.off,
      closedSaturdays: [...new Set(dto.window.closedSaturdays)].sort((a, b) => a - b),
    };
    await this.prisma.alertSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await this.audit.log({ userId: user.id, action: 'alert_settings.update', entityType: 'AlertSettings', entityId: '1', details: data, ipAddress: ip });
    return this.overview(user);
  }

  // ---- Dashboard ----

  async overview(user: AuthUser): Promise<AlertsResponse> {
    const scope = { screen: screenScope(user) };
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const [open, recent, settings] = await Promise.all([
      this.prisma.screenAlert.findMany({ where: { resolvedAt: null, ...scope }, include: alertInclude, orderBy: { offlineSince: 'asc' } }),
      this.prisma.screenAlert.findMany({ where: { resolvedAt: { gte: since }, ...scope }, include: alertInclude, orderBy: { resolvedAt: 'desc' }, take: 50 }),
      this.settings(),
    ]);
    const entry = (a: (typeof open)[number]): AlertEntry => ({
      id: a.id,
      screen: { id: a.screen.id, name: a.screen.name ?? 'Unnamed screen' },
      branch: a.screen.branch?.name ?? null,
      offlineSince: a.offlineSince.toISOString(),
      notifiedAt: a.notifiedAt?.toISOString() ?? null,
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
    });
    // Recipient addresses are head office's business.
    const shown = isHeadOffice(user) ? settings : { ...settings, recipients: [] };
    return { open: open.map(entry), recent: recent.map(entry), settings: shown, mailDriver: this.mail.driver };
  }

  async sendTest(user: AuthUser, ip?: string): Promise<{ sentTo: string[] }> {
    const { recipients } = await this.settings();
    if (!recipients.length) throw new BadRequestException('Add at least one email address first');
    await this.mail.send({
      to: recipients,
      subject: 'KDCC Darpan: test alert',
      text: `This is a test from KDCC Darpan, sent by ${user.name}. Offline alerts will arrive at this address.\n\n${this.link()}`,
    });
    await this.audit.log({ userId: user.id, action: 'alert_settings.test_email', entityType: 'AlertSettings', entityId: '1', details: { recipients }, ipAddress: ip });
    return { sentTo: recipients };
  }

  // ---- The check (every minute) ----

  /** `now` and `skipGrace` exist for tests. */
  async check(now = new Date(), skipGrace = false): Promise<void> {
    if (this.running) return;
    // Right after a restart every TV looks silent until it reconnects; give them time.
    if (!skipGrace && Date.now() - this.startedAt < ONLINE_WINDOW_MS) return;
    this.running = true;
    try {
      await this.evaluate(now);
    } catch (err) {
      this.logger.error('Offline check failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  private async evaluate(now: Date): Promise<void> {
    const settings = await this.settings();
    const cutoff = now.getTime() - settings.offlineAfterMin * 60_000;

    const screens = await this.prisma.screen.findMany({
      where: { status: { not: 'PENDING' } },
      select: {
        id: true,
        name: true,
        branchId: true,
        lastSeenAt: true,
        pairedAt: true,
        createdAt: true,
        branch: { select: { name: true, talukaId: true, taluka: { select: { regionId: true } } } },
      },
    });
    if (!screens.length) return;
    const open = new Map((await this.prisma.screenAlert.findMany({ where: { resolvedAt: null } })).map((a) => [a.screenId, a] as const));
    const hours = await this.resolver.hoursMany(screens);
    const shouldBeOn = (id: string) => hoursOn(hours.get(id)?.hours ?? settings.window, now);

    const toNotify: { alertId: string; name: string; branch: string | null; lastSeen: Date }[] = [];
    const recovered: { name: string; branch: string | null; offlineMs: number }[] = [];

    for (const s of screens) {
      const lastSeen = s.lastSeenAt ?? s.pairedAt ?? s.createdAt;
      const offline = lastSeen.getTime() < cutoff;
      const alert = open.get(s.id);
      const name = s.name ?? 'Unnamed screen';

      if (offline) {
        const a = alert ?? (await this.prisma.screenAlert.create({ data: { screenId: s.id, offlineSince: lastSeen } }));
        if (!a.notifiedAt && settings.enabled && shouldBeOn(s.id)) {
          toNotify.push({ alertId: a.id, name, branch: s.branch?.name ?? null, lastSeen });
        }
      } else if (alert) {
        await this.prisma.screenAlert.update({ where: { id: alert.id }, data: { resolvedAt: now } });
        if (alert.notifiedAt) recovered.push({ name, branch: s.branch?.name ?? null, offlineMs: now.getTime() - alert.offlineSince.getTime() });
      }
    }

    if (!toNotify.length && !recovered.length) return;
    if (toNotify.length) {
      await this.prisma.screenAlert.updateMany({ where: { id: { in: toNotify.map((n) => n.alertId) } }, data: { notifiedAt: now } });
    }
    this.logger.log(`Offline check: ${toNotify.length} newly offline, ${recovered.length} back online`);
    if (!settings.enabled || !settings.recipients.length) return;

    await this.mail.send({ to: settings.recipients, ...this.digest(toNotify, recovered, screens.length, now) });
  }

  private digest(
    offline: { name: string; branch: string | null; lastSeen: Date }[],
    back: { name: string; branch: string | null; offlineMs: number }[],
    total: number,
    now: Date,
  ): { subject: string; text: string } {
    const where = (n: { name: string; branch: string | null }) => (n.branch ? `${n.name} (${n.branch})` : n.name);
    const today = IST_DATE.format(now);
    const parts: string[] = [];
    if (offline.length) parts.push(`${offline.length} screen${offline.length === 1 ? '' : 's'} offline`);
    if (back.length) parts.push(`${back.length} back online`);

    const lines: string[] = [];
    // Many at once usually means the server or the head-office internet, not the branches.
    const mass = offline.length >= 5 && offline.length >= total / 2;
    if (mass) lines.push(`${offline.length} of ${total} screens went quiet together. Check the server and its internet connection first.`, '');
    if (offline.length) {
      lines.push('Not checking in:');
      for (const n of offline) {
        const fmt = IST_DATE.format(n.lastSeen) === today ? IST_TIME : IST_DAY_TIME;
        lines.push(`  - ${where(n)}, last heard ${fmt.format(n.lastSeen)}`);
      }
      lines.push('');
    }
    if (back.length) {
      lines.push('Back online:');
      for (const n of back) lines.push(`  - ${where(n)}, was offline ${duration(n.offlineMs)}`);
      lines.push('');
    }
    lines.push(`See all alerts: ${this.link()}`);
    return { subject: `KDCC Darpan: ${parts.join(', ')}${mass ? ' (check the server)' : ''}`, text: lines.join('\n') };
  }

  private link(): string {
    return `${(process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')}/alerts`;
  }
}
