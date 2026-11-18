// The fleet summary counts what the TVs reported and never guesses (docs/AUDIT.md, DC6).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentTvOff, tvOffRecord } from '../src/screens/capabilities';
import { fleetSummary, sdkOf, type FleetRow } from '../src/screens/fleet';

const caps = (extra: Record<string, unknown> = {}) => ({
  sdk: 34,
  webView: { package: 'com.google.android.webview', version: '110.0.1', major: 110 },
  h264_1080p: true,
  hevc: true,
  deviceOwner: true,
  brightness: null,
  network: { type: 'ethernet', wifiDbm: null },
  screenOff: true,
  videoInScreenshot: null,
  device: { brand: 'Xiaomi', manufacturer: 'Xiaomi', model: 'MiTV-MZTU0', chipset: null, os: 'Android 14 (API 34)' },
  video: { avc: { profile: 'High', level: '5.1', ours: true, portrait: true }, hevc: null, decoders: [] },
  platform: 'googletv',
  ...extra,
});

const row = (id: string, extra: Partial<FleetRow> = {}): FleetRow => ({
  id,
  name: `TV ${id}`,
  online: true,
  model: 'Xiaomi MiTV-MZTU0',
  osVersion: 'Android 14 (API 34)',
  appVersion: '0.9.0',
  capabilities: caps(),
  unplayable: null,
  branch: 'Matar',
  ...extra,
});

describe('fleet summary (DC6)', () => {
  it('counts models, Android versions and what the TVs can do', () => {
    const f = fleetSummary([
      row('a'),
      row('b', { online: false }),
      row('c', {
        model: 'TCL 43P',
        osVersion: 'Android 9 (API 28)',
        appVersion: '0.8.0',
        capabilities: caps({
          sdk: 28,
          h264_1080p: false,
          deviceOwner: false,
          webView: { package: 'com.android.webview', version: '66.0', major: 66 },
          device: { brand: 'TCL', manufacturer: 'TCL', model: '43P', chipset: null, os: 'Android 9 (API 28)' },
          video: { avc: { profile: 'Main', level: '4.1', ours: false, portrait: false }, hevc: null, decoders: [] },
          platform: 'aosp',
        }),
      }),
      // An old app: registered, but never sent capabilities.
      row('d', { model: null, osVersion: 'Android 7.1 (API 25)', appVersion: null, capabilities: null, unplayable: [{ mediaId: 'x', reason: 'r' }] }),
    ]);
    assert.equal(f.screens, 4);
    assert.equal(f.reported, 3);
    assert.deepEqual(f.models[0], { label: 'Xiaomi MiTV-MZTU0', screens: 2, online: 1 });
    assert.ok(f.models.some((g) => g.label === 'Not known' && g.screens === 1));
    assert.equal(f.lowestSdk, 25, 'the registration text counts when the app is too old to report');
    assert.equal(f.androidUnknown, 0);
    assert.deepEqual(
      f.android.map((g) => [g.label, g.screens]),
      [['Android 14 (API 34)', 2], ['Android 7.1 (API 25)', 1], ['Android 9 (API 28)', 1]],
    );
    assert.deepEqual(f.videos, { yes: 2, no: 1, unknown: 1 });
    assert.deepEqual(f.youtube, { yes: 2, no: 1, unknown: 1 });
    assert.deepEqual(f.kiosk, { yes: 2, no: 1, unknown: 1 });
    assert.deepEqual(f.brightness, { yes: 0, no: 0, unknown: 4 });
    assert.ok(f.platforms.some((g) => g.label === 'Google TV' && g.screens === 2));
    assert.deepEqual(
      f.attention.map((a) => [a.id, a.note]),
      [['c', 'cannot play our videos: posters only'], ['d', 'skips 1 video it cannot play']],
    );
  });

  it('an empty area is all zeros, not an error', () => {
    const f = fleetSummary([]);
    assert.equal(f.screens, 0);
    assert.equal(f.lowestSdk, null);
    assert.deepEqual(f.videos, { yes: 0, no: 0, unknown: 0 });
  });

  it('a screen the TV itself turned off in the last day needs a look (DC9)', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const f = fleetSummary(
      [
        row('e', { tvOff: { kind: 'screen', at: '2026-11-18T10:00:00.000Z', backAt: null, count: 2 } }),
        row('f', { tvOff: { kind: 'input', at: '2026-11-16T10:00:00.000Z', backAt: null, count: 1 } }),
      ],
      now,
    );
    assert.deepEqual(f.attention.map((a) => [a.id, a.note]), [['e', 'the TV turned its screen off during display hours']]);
  });

  it('reads the API level out of the Android text', () => {
    assert.equal(sdkOf('Android 14 (API 34)'), 34);
    assert.equal(sdkOf('Android 9'), null);
    assert.equal(sdkOf(null), null);
  });
});

describe('"turned off by the TV" reports (DC9)', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');

  it('seconds ago by the TV become a time by the server', () => {
    assert.deepEqual(tvOffRecord({ kind: 'screen', agoSec: 600, backAgoSec: 60, count: 3 }, now), {
      kind: 'screen',
      at: '2026-11-18T11:50:00.000Z',
      backAt: '2026-11-18T11:59:00.000Z',
      count: 3,
    });
    assert.equal(tvOffRecord({ kind: 'input', agoSec: 5, backAgoSec: null, count: 1 }, now)?.backAt, null);
  });

  it('anything malformed is dropped', () => {
    assert.equal(tvOffRecord(null, now), null);
    assert.equal(tvOffRecord({ kind: 'hdmi', agoSec: 5, backAgoSec: null, count: 1 }, now), null);
    assert.equal(tvOffRecord({ kind: 'screen', agoSec: -1, backAgoSec: null, count: 1 }, now), null);
    assert.equal(tvOffRecord({ kind: 'screen', agoSec: 5, backAgoSec: 10, count: 1 }, now), null, 'back before it went');
    assert.equal(tvOffRecord({ kind: 'screen', agoSec: 5, backAgoSec: null, count: 0 }, now), null);
  });

  it('a stored report shows for a week', () => {
    const r = { kind: 'screen', at: '2026-11-12T12:00:00.000Z', backAt: null, count: 1 };
    assert.deepEqual(recentTvOff(r, now), r);
    assert.equal(recentTvOff({ ...r, at: '2026-11-11T11:00:00.000Z' }, now), null);
    assert.equal(recentTvOff('x', now), null);
  });
});
