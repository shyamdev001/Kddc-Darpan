import type { CrashReportPayload } from '@darpan/shared';

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100_000 ? v : undefined);
const shortText = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);

/** Only the expected fields, each short: the TV's crash report is shown on the dashboard as text. */
export function crashReport(v: unknown): CrashReportPayload | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  const type = shortText(c.type, 200);
  if (!type || typeof c.at !== 'number' || !Number.isFinite(c.at)) return null;
  const frames = Array.isArray(c.frames) ? c.frames.slice(0, 8).filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 200)) : [];
  return {
    at: c.at,
    type,
    message: typeof c.message === 'string' ? c.message.slice(0, 300) : null,
    frames,
    total: count(c.total) ?? 1,
    recent: count(c.recent) ?? 0,
  };
}
