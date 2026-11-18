import { youtubeSupport, type FleetGroup, type FleetScreenRef, type FleetSummary, type FleetTally } from '@darpan/shared';
import { cleanCapabilities } from './capabilities';

/** The screen fields the fleet summary reads. */
export interface FleetRow {
  id: string;
  name: string | null;
  online: boolean;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  capabilities: unknown;
  unplayable: unknown;
  branch: string | null;
}

const PLATFORM_LABELS = { googletv: 'Google TV', androidtv: 'Android TV', aosp: 'Android without Google TV services' } as const;

/** "Android 14 (API 34)" → 34; the registration text has the same shape. */
export function sdkOf(text: string | null): number | null {
  const m = text?.match(/\(API (\d{1,3})\)/);
  return m ? Number(m[1]) : null;
}

function tally(values: (boolean | null)[]): FleetTally {
  return {
    yes: values.filter((v) => v === true).length,
    no: values.filter((v) => v === false).length,
    unknown: values.filter((v) => v === null).length,
  };
}

function groups(rows: { label: string; online: boolean }[]): FleetGroup[] {
  const map = new Map<string, FleetGroup>();
  for (const r of rows) {
    const g = map.get(r.label) ?? { label: r.label, screens: 0, online: 0 };
    g.screens += 1;
    if (r.online) g.online += 1;
    map.set(r.label, g);
  }
  return [...map.values()].sort((a, b) => b.screens - a.screens || a.label.localeCompare(b.label));
}

/** Counts, never guesses: a screen that has not said is "not known", not "no". Pure. */
export function fleetSummary(rows: FleetRow[]): FleetSummary {
  const all = rows.map((r) => ({ r, c: cleanCapabilities(r.capabilities) }));
  const sdks = all.map(({ r, c }) => c?.sdk ?? sdkOf(c?.device?.os ?? r.osVersion));
  const known = sdks.filter((s): s is number => s !== null);

  const attention: FleetScreenRef[] = [];
  for (const { r, c } of all) {
    const ref = { id: r.id, name: r.name ?? 'Unnamed screen', branch: r.branch };
    const skipped = Array.isArray(r.unplayable) ? r.unplayable.length : 0;
    if (c?.h264_1080p === false) attention.push({ ...ref, note: 'cannot play our videos: posters only' });
    else if (skipped > 0) attention.push({ ...ref, note: `skips ${skipped} ${skipped === 1 ? 'video' : 'videos'} it cannot play` });
  }

  return {
    screens: rows.length,
    reported: all.filter(({ c }) => c?.device).length,
    android: groups(
      all
        .map(({ r, c }) => ({ label: c?.device?.os ?? r.osVersion ?? '', online: r.online }))
        .filter((x) => x.label),
    ),
    lowestSdk: known.length ? Math.min(...known) : null,
    androidUnknown: sdks.filter((s) => s === null).length,
    models: groups(all.map(({ r }) => ({ label: r.model ?? 'Not known', online: r.online }))),
    platforms: groups(all.map(({ r, c }) => ({ label: c?.platform ? PLATFORM_LABELS[c.platform] : 'Not known', online: r.online }))),
    appVersions: groups(all.map(({ r }) => ({ label: r.appVersion ?? 'Not known', online: r.online }))),
    videos: tally(all.map(({ c }) => c?.h264_1080p ?? null)),
    portraitVideos: tally(all.map(({ c }) => (c?.video?.avc ? c.video.avc.portrait : null))),
    youtube: tally(all.map(({ c }) => youtubeSupport(c).ok)),
    kiosk: tally(all.map(({ c }) => (c ? c.deviceOwner : null))),
    brightness: tally(all.map(({ c }) => c?.brightness ?? null)),
    screenOff: tally(all.map(({ c }) => c?.screenOff ?? null)),
    attention: attention.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
