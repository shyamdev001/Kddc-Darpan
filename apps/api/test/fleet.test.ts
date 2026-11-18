// The fleet summary counts what the TVs reported and never guesses (docs/AUDIT.md, DC6).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

  it('reads the API level out of the Android text', () => {
    assert.equal(sdkOf('Android 14 (API 34)'), 34);
    assert.equal(sdkOf('Android 9'), null);
    assert.equal(sdkOf(null), null);
  });
});
