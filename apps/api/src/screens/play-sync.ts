import type { PlaySyncReport } from '@darpan/shared';

const ms = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? Math.round(v) : null;

/** Keeps only the known fields of a TV's sync report, each checked. null when it is not one. */
export function cleanPlaySync(v: unknown): PlaySyncReport | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if (s.mode !== 'synced' && s.mode !== 'free') return null;
  return {
    mode: s.mode,
    offsetErrorMs: ms(s.offsetErrorMs, 60_000),
    driftMs: s.mode === 'synced' ? ms(s.driftMs, 3_600_000) : null,
    clockCertain: s.clockCertain !== false,
  };
}
