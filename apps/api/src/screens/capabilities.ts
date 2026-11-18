import { TV_PLATFORMS, type TvCapabilities, type TvCodecSupport, type TvDeviceFacts, type TvDisplayFacts, type TvVideoFacts } from '@darpan/shared';

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

const NETWORK_TYPES = ['ethernet', 'wifi', 'other', 'none'] as const;
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function device(v: unknown): TvDeviceFacts | null {
  const o = obj(v);
  const model = text(o?.model, 80);
  if (!o || !model) return null;
  return {
    brand: text(o.brand, 40) ?? '',
    manufacturer: text(o.manufacturer, 40) ?? '',
    model,
    chipset: text(o.chipset, 80),
    os: text(o.os, 60) ?? '',
  };
}

function display(v: unknown): TvDisplayFacts | null {
  const o = obj(v);
  const width = int(o?.width, 1, 10_000);
  const height = int(o?.height, 1, 10_000);
  if (!o || width === null || height === null) return null;
  return {
    width,
    height,
    dpi: int(o.dpi, 1, 2_000),
    panelWidth: int(o.panelWidth, 1, 10_000),
    panelHeight: int(o.panelHeight, 1, 10_000),
    refreshHz: int(o.refreshHz, 1, 1_000),
  };
}

function codec(v: unknown): TvCodecSupport | null {
  const o = obj(v);
  if (!o || typeof o.ours !== 'boolean') return null;
  return { profile: text(o.profile, 40) ?? 'not reported', level: text(o.level, 30) ?? 'not reported', ours: o.ours, portrait: o.portrait === true };
}

function video(v: unknown): TvVideoFacts | null {
  const o = obj(v);
  if (!o) return null;
  const decoders: TvVideoFacts['decoders'] = [];
  for (const d of Array.isArray(o.decoders) ? o.decoders.slice(0, 40) : []) {
    const x = obj(d);
    const name = text(x?.name, 80);
    const type = text(x?.type, 30);
    if (name && type) decoders.push({ name, type, hardware: x?.hardware === true });
  }
  return { avc: codec(o.avc), hevc: codec(o.hevc), decoders };
}

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
    // Fuller report (DC4); older apps send none of these.
    device: device(c.device),
    display: display(c.display),
    video: video(c.video),
    platform: (TV_PLATFORMS as readonly unknown[]).includes(c.platform) ? (c.platform as TvCapabilities['platform']) : null,
  };
}

/**
 * The model, Android version and resolution columns, kept current from the heartbeat: they were
 * read only at registration, so a firmware update never showed (DC4). Empty when the app is older.
 */
export function screenFacts(c: TvCapabilities | null): { model?: string; osVersion?: string; resolution?: string } {
  if (!c) return {};
  const out: { model?: string; osVersion?: string; resolution?: string } = {};
  if (c.device) {
    const maker = c.device.manufacturer;
    out.model = (maker && !c.device.model.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${c.device.model}` : c.device.model).slice(0, 120);
    if (c.device.os) out.osVersion = c.device.os;
  }
  if (c.display) out.resolution = `${c.display.width}x${c.display.height}`;
  return out;
}
