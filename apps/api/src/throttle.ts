import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Which proxies may tell us the client's real address (X-Forwarded-For). From TRUST_PROXY:
 * a hop count ("1"), or Express names/addresses/ranges ("loopback", "172.16.0.0/12", comma-separated).
 * Default "loopback": the dashboard's Next.js server on the same machine in development.
 * In Docker, Caddy and the dashboard sit on the Docker network, not loopback, so production sets this;
 * without it every request seems to come from the proxy and all users and TVs share one rate limit.
 * "true" (trust anyone) is refused: then any client could pick its own address and dodge the limits.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): number | string {
  const value = (raw ?? '').trim();
  if (!value) return 'loopback';
  if (/^\d+$/.test(value)) return Number(value);
  if (/^(true|\*)$/i.test(value)) {
    throw new Error('TRUST_PROXY=true would let any client fake its address. Use the proxy network, e.g. 172.16.0.0/12, or a hop count.');
  }
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
}

/**
 * Rate limits per person, and per TV for the TV's own routes. Branch TVs can share one public
 * address (a branch router, a bank-wide gateway), so counting them by address would let 101 TVs
 * use up one shared allowance after a playlist change.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const auth = req.headers?.authorization;
    const path: string = req.originalUrl ?? req.url ?? '';
    if (typeof auth === 'string' && auth.startsWith('Bearer ') && path.startsWith('/api/devices/')) {
      return 'tv:' + createHash('sha256').update(auth.slice(7).trim()).digest('hex').slice(0, 32);
    }
    return req.ip ?? 'unknown';
  }
}
