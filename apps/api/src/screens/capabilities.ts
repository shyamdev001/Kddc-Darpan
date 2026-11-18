import type { TvCapabilities } from '@darpan/shared';

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

const NETWORK_TYPES = ['ethernet', 'wifi', 'other', 'none'] as const;

/** Videos the TV cannot play (DC3): known shape only, at most 20, reasons cut short. */
export function cleanUnplayable(v: unknown[]): { mediaId: string; reason: string }[] {
  const out: { mediaId: string; reason: string }[] = [];
  for (const x of v.slice(0, 20)) {
    const o = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
    if (typeof o.mediaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.mediaId)) continue;
    out.push({ mediaId: o.mediaId, reason: text(o.reason, 120) ?? 'cannot play on this TV' });
  }
  return out;
}

/** Keeps only the known fields, each checked and short. null when it is not a capabilities object at all. */
export function cleanCapabilities(v: unknown): TvCapabilities | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  const sdk = int(c.sdk, 1, 100);
  if (sdk === null) return null;
  const wv = typeof c.webView === 'object' && c.webView !== null ? (c.webView as Record<string, unknown>) : null;
  const wvPackage = text(wv?.package, 100);
  const wvVersion = text(wv?.version, 60);
  const net = typeof c.network === 'object' && c.network !== null ? (c.network as Record<string, unknown>) : {};
  const type = (NETWORK_TYPES as readonly unknown[]).includes(net.type) ? (net.type as TvCapabilities['network']['type']) : 'other';
  return {
    sdk,
    webView: wvPackage && wvVersion ? { package: wvPackage, version: wvVersion, major: int(wv?.major, 1, 999) } : null,
    h264_1080p: bool(c.h264_1080p),
    hevc: bool(c.hevc),
    deviceOwner: c.deviceOwner === true,
    brightness: bool(c.brightness),
    network: { type, wifiDbm: type === 'wifi' ? int(net.wifiDbm, -127, 0) : null },
    screenOff: bool(c.screenOff),
    videoInScreenshot: bool(c.videoInScreenshot),
  };
}
