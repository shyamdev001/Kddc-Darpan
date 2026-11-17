import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { statfs } from 'node:fs/promises';
import { Public } from './auth/decorators';
import { PrismaService } from './prisma/prisma.service';

/** Below this much free space the server is about to stop accepting uploads and database writes. */
export function minFreeDiskMb(): number {
  const gb = Number(process.env.HEALTH_MIN_FREE_GB ?? 2);
  return Math.round((Number.isFinite(gb) && gb > 0 ? gb : 2) * 1024);
}
/** An upload still waiting for processing after this long means the media worker is stuck. */
export const STUCK_QUEUE_MIN = 30;

export interface HealthReport {
  /** "ok", or "warn" with the reasons in `warnings`. Uptime Kuma watches for "status":"ok". */
  status: 'ok' | 'warn';
  db: 'ok';
  time: string;
  disk: { freeMb: number; totalMb: number } | null;
  queue: { waiting: number; oldestWaitingMin: number | null };
  warnings: string[];
}

/** Pure rule, so it can be tested with any numbers. */
export function healthWarnings(disk: HealthReport['disk'], queue: HealthReport['queue'], minFreeMb = minFreeDiskMb()): string[] {
  const warnings: string[] = [];
  if (disk && disk.freeMb < minFreeMb) warnings.push(`Low disk space: ${(disk.freeMb / 1024).toFixed(1)} GB free`);
  if (queue.oldestWaitingMin !== null && queue.oldestWaitingMin >= STUCK_QUEUE_MIN) {
    warnings.push(`Media processing is stuck: ${queue.waiting} upload(s) waiting, oldest ${queue.oldestWaitingMin} min`);
  }
  return warnings;
}

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthReport> {
    await this.prisma.$queryRaw`SELECT 1`;
    const [disk, queue] = await Promise.all([this.disk(), this.queue()]);
    const warnings = healthWarnings(disk, queue);
    return { status: warnings.length ? 'warn' : 'ok', db: 'ok', time: new Date().toISOString(), disk, queue, warnings };
  }

  /** Free space where uploads are kept (on the server: the same disk as the database). */
  private async disk(): Promise<HealthReport['disk']> {
    const dir = process.env.STORAGE_DRIVER === 's3' ? process.cwd() : (process.env.STORAGE_LOCAL_DIR ?? process.cwd());
    try {
      const s = await statfs(dir);
      const mb = (blocks: number) => Math.floor((blocks * s.bsize) / (1024 * 1024));
      return { freeMb: mb(s.bavail), totalMb: mb(s.blocks) };
    } catch {
      return null;
    }
  }

  /** Uploads not yet processed, and how long the oldest has waited. */
  private async queue(): Promise<HealthReport['queue']> {
    const where = { status: { in: ['UPLOADED' as const, 'PROCESSING' as const] } };
    const [waiting, oldest] = await Promise.all([
      this.prisma.media.count({ where }),
      this.prisma.media.findFirst({ where, orderBy: { updatedAt: 'asc' }, select: { updatedAt: true } }),
    ]);
    return { waiting, oldestWaitingMin: oldest ? Math.floor((Date.now() - oldest.updatedAt.getTime()) / 60_000) : null };
  }
}
