// Live updates: a TV coming online or going away reaches open dashboards at once, without a reload.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_NAMESPACE, DASHBOARD_SOCKET_PATH, DEVICE_NAMESPACE, DEVICE_REMOVED_EVENT, filesProblem, ONLINE_WINDOW_MS, SCREENS_CHANGED_EVENT, type ScreensChangedPayload } from '@darpan/shared';
import { io, type Socket } from 'socket.io-client';
import { DevicesGateway } from '../src/screens/devices.gateway';
import { call, createMedia, createPlaces, createUser, login, pairedTv, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
let origin: string;
let admin: string;
let places: Awaited<ReturnType<typeof createPlaces>>;
const open: Socket[] = [];

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  places = await createPlaces(t.prisma);
  admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
  origin = t.base.replace(/\/api$/, '');
});
after(async () => {
  for (const s of open) s.disconnect();
  await t.close();
});

function dashboard(cookie?: string): Socket {
  const s = io(origin + DASHBOARD_NAMESPACE, {
    path: DASHBOARD_SOCKET_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
  });
  open.push(s);
  return s;
}

function tvSocket(token: string, transports: string[] = ['websocket']): Socket {
  const s = io(origin + DEVICE_NAMESPACE, { auth: { token }, transports, reconnection: false });
  open.push(s);
  return s;
}

const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (e) => reject(e));
  });

/** Resolves with the first update that names this screen. */
const updateFor = (s: Socket, screenId: string, timeoutMs = 5_000) =>
  new Promise<ScreensChangedPayload>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no live update')), timeoutMs);
    const on = (p: ScreensChangedPayload) => {
      if (!p.screenIds.includes(screenId)) return;
      clearTimeout(timer);
      s.off(SCREENS_CHANGED_EVENT, on);
      resolve(p);
    };
    s.on(SCREENS_CHANGED_EVENT, on);
  });

const onlineInList = async (screenId: string) => {
  const res = await call(t.base, 'GET', '/screens', { cookie: admin });
  return (res.body.items as { id: string; online: boolean }[]).find((s) => s.id === screenId)?.online;
};

describe('live dashboard updates', () => {
  it('refuses a dashboard connection without a session', async () => {
    await assert.rejects(connected(dashboard()), /unauthorized/);
    await assert.rejects(connected(dashboard('darpan_session=made-up')), /unauthorized/);
  });

  it('tells the dashboard when a TV connects, and when it has missed 3 heartbeats; a short drop does not flip it', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Live update TV');
    // Paired but never connected: as if the server had restarted since.
    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { status: 'OFFLINE' } });
    assert.equal(await onlineInList(tv.deviceId), false);

    const dash = dashboard(admin);
    await connected(dash);

    const cameOnline = updateFor(dash, tv.deviceId);
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    await cameOnline;
    assert.equal(await onlineInList(tv.deviceId), true);

    // A dropped connection alone does not flip it: a WiFi blip reconnects within seconds (OF12).
    device.disconnect();
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await onlineInList(tv.deviceId), true);

    // 3 heartbeats missed: offline, and open dashboards are told.
    await new Promise((r) => setTimeout(r, 1_500)); // the connect's update has gone out
    const wentAway = updateFor(dash, tv.deviceId);
    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { lastSeenAt: new Date(Date.now() - ONLINE_WINDOW_MS - 1_000) } });
    assert.ok((await t.app.get(DevicesGateway).sweepStale()).includes(tv.deviceId));
    await wentAway;
    assert.equal(await onlineInList(tv.deviceId), false);

    // Back: online at once.
    const back = updateFor(dash, tv.deviceId);
    await connected(tvSocket(tv.deviceToken));
    await back;
    assert.equal(await onlineInList(tv.deviceId), true);
    assert.ok(!(await t.app.get(DevicesGateway).sweepStale()).includes(tv.deviceId), 'a screen heard from just now stays online');
  });

  it('works through a proxy that blocks WebSockets: the TV falls back to long-polling (OF6)', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Proxy TV');
    const device = tvSocket(tv.deviceToken, ['polling']);
    await connected(device);
    const reply = await device.timeout(5_000).emitWithAck('heartbeat', { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0', adbEnabled: true });
    assert.deepEqual(reply, { ok: true });
    assert.equal(await onlineInList(tv.deviceId), true);
    assert.equal((await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.adbEnabled, true);
  });

  it('tells a TV the exact server time, so broadcasts stay in step across screens', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Clock TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const before = Date.now();
    const reply = (await device.timeout(3_000).emitWithAck('time', {})) as { now: number };
    assert.ok(reply.now >= before && reply.now <= Date.now(), 'server time is current');
  });

  it('passes on what a TV reports playing (heartbeat)', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Heartbeat TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const dash = dashboard(admin);
    await connected(dash);

    const update = updateFor(dash, tv.deviceId);
    device.emit('heartbeat', { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' });
    await update;
  });
});

describe('a TV removed by head office', () => {
  it('is told it was removed, so it stops and shows a new code (a refused key alone does not stop it)', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Removed TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const removed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no removed event')), 5_000);
      device.once(DEVICE_REMOVED_EVENT, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const gone = new Promise<void>((resolve) => device.once('disconnect', () => resolve()));
    const res = await call(t.base, 'DELETE', `/screens/${tv.deviceId}`, { cookie: admin });
    assert.equal(res.status, 204);
    await removed;
    await gone;
  });
});

describe('Android debugging (adb) warning', () => {
  it('shows on the screen page when the TV reports adb on, and clears when it is off', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'ADB TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const adb = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.adbEnabled;

    assert.equal(await adb(), null, 'unknown until the TV says');
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, adbEnabled: true });
    assert.equal(await adb(), true);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, adbEnabled: false });
    assert.equal(await adb(), false);
    await device.timeout(3_000).emitWithAck('heartbeat', base); // an older app: keeps the last answer
    assert.equal(await adb(), false);
  });
});

describe('a TV that was away catches up at once (OF9)', () => {
  const nextUpdate = (s: Socket, timeoutMs: number) =>
    new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      s.once('manifest:updated', (p: { version: string }) => {
        clearTimeout(timer);
        resolve(p.version);
      });
    });

  it('is told about a change made while it was disconnected on its first heartbeat, and only then', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Away TV');
    // Content pushes go out in 2 s batches: let the one from pairing pass first.
    await new Promise((r) => setTimeout(r, 2_500));
    const manifest = await call(t.base, 'GET', '/devices/manifest', { token: tv.deviceToken });
    const current = manifest.body.version as string;
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };

    // Up to date: nothing is sent.
    const fresh = tvSocket(tv.deviceToken);
    await connected(fresh);
    const quiet = nextUpdate(fresh, 1_000);
    await fresh.timeout(3_000).emitWithAck('heartbeat', { ...base, manifestVersion: current });
    assert.equal(await quiet, null);
    fresh.disconnect();

    // Reconnects still holding an older version: told the current one on its first heartbeat.
    const back = tvSocket(tv.deviceToken);
    await connected(back);
    const told = nextUpdate(back, 3_000);
    await back.timeout(3_000).emitWithAck('heartbeat', { ...base, manifestVersion: 'old-version' });
    assert.equal(await told, current);

    // Later heartbeats on the same connection never rebuild or resend.
    const again = nextUpdate(back, 1_000);
    await back.timeout(3_000).emitWithAck('heartbeat', { ...base, manifestVersion: 'old-version' });
    assert.equal(await again, null);
  });
});

describe('download problems reach head office', () => {
  it('"3 of 12 files missing: storage full" shows on the screen page and the Live wall', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Full TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.files;
    const tile = async () => ((await call(t.base, 'GET', '/screens/live', { cookie: admin })).body.items as { id: string; files: unknown }[]).find((s) => s.id === tv.deviceId)?.files;

    assert.equal(await detail(), null, 'unknown until the TV says');
    const error = 'storage full: needs 240 MB, 120 MB free';
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, filesReady: 9, filesTotal: 12, downloadError: error });
    assert.deepEqual(await detail(), { ready: 9, total: 12, error });
    assert.deepEqual(await tile(), { ready: 9, total: 12, error });
    assert.equal(filesProblem(await detail()), `3 of 12 files missing: ${error}`);

    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, filesReady: 12, filesTotal: 12, downloadError: null });
    assert.equal(filesProblem(await detail()), null);
    // Nonsense is ignored, the last good report stays.
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, filesReady: 13, filesTotal: 12 });
    assert.deepEqual(await detail(), { ready: 12, total: 12, error: null });
  });
});

describe('videos a TV cannot play reach head office (DC3)', () => {
  it('are listed by ad name with the reason; junk is dropped; an empty list clears it', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Old decoder TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const media = await createMedia(t.prisma, 'Diwali offer video');
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.unplayable;

    assert.deepEqual(await detail(), []);
    await device.timeout(3_000).emitWithAck('heartbeat', {
      ...base,
      unplayable: [
        { mediaId: media.id, reason: 'this TV cannot decode this video format' },
        { mediaId: 'not-an-id', reason: 'x' },
        'junk',
      ],
    });
    assert.deepEqual(await detail(), [{ mediaId: media.id, name: 'Diwali offer video', reason: 'this TV cannot decode this video format' }]);

    // An older app sends no list: what we had stays. A restart that plays it fine sends an empty one.
    await device.timeout(3_000).emitWithAck('heartbeat', base);
    assert.equal((await detail()).length, 1);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, unplayable: [] });
    assert.deepEqual(await detail(), []);
  });
});

describe('crashes reach head office', () => {
  it('the last crash and safe mode show on the screen page; junk is cut down', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Crashy TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;

    assert.equal((await detail()).crash, null);
    assert.equal((await detail()).safeMode, false);
    const at = Date.parse('2026-11-17T08:00:00Z');
    await device.timeout(3_000).emitWithAck('heartbeat', {
      ...base,
      safeMode: true,
      crash: { at, type: 'java.lang.OutOfMemoryError', message: 'Failed to allocate 8294400 bytes', frames: ['Playback.show:120', ...Array(20).fill('x'.repeat(500))], total: 7, recent: 5, extra: 'ignored' },
    });
    const d = await detail();
    assert.equal(d.safeMode, true);
    assert.equal(d.crash.type, 'java.lang.OutOfMemoryError');
    assert.equal(d.crash.at, '2026-11-17T08:00:00.000Z');
    assert.equal(d.crash.total, 7);
    assert.equal(d.crash.recent, 5);
    assert.equal(d.crash.frames.length, 8, 'at most 8 frames');
    assert.ok(d.crash.frames.every((f: string) => f.length <= 200));
    assert.equal(d.crash.extra, undefined);
    const tile = ((await call(t.base, 'GET', '/screens/live', { cookie: admin })).body.items as { id: string; safeMode: boolean }[]).find((s) => s.id === tv.deviceId);
    assert.equal(tile?.safeMode, true);

    // Out of safe mode; an older app that sends no crash field keeps the last report.
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, safeMode: false });
    assert.equal((await detail()).safeMode, false);
    assert.equal((await detail()).crash.type, 'java.lang.OutOfMemoryError');
  });
});

describe('what each TV can do', () => {
  const caps = (major: number | null, extra: Record<string, unknown> = {}) => ({
    sdk: 28,
    webView: major === null ? null : { package: 'com.google.android.webview', version: `${major}.0.4472.114`, major },
    h264_1080p: true,
    hevc: false,
    deviceOwner: true,
    brightness: false,
    network: { type: 'wifi', wifiDbm: -61 },
    screenOff: null,
    videoInScreenshot: null,
    ...extra,
  });

  it('is stored and shown on the screen page; unknown fields are dropped', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Capable TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.capabilities;

    assert.equal(await detail(), null);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, capabilities: caps(91, { secret: 'x', network: { type: 'wifi', wifiDbm: -61, ssid: 'BankWiFi' } }) });
    const c = await detail();
    assert.equal(c.webView.major, 91);
    assert.equal(c.brightness, false);
    assert.deepEqual(c.network, { type: 'wifi', wifiDbm: -61 });
    assert.equal(c.secret, undefined);
    // A heartbeat without capabilities (older app) keeps what we know.
    await device.timeout(3_000).emitWithAck('heartbeat', base);
    assert.equal((await detail()).webView.major, 91);
  });

  it('the fuller report (make, chipset, panel, decoders) is kept, and keeps model and Android current (DC4)', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Reported TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;
    const decoders = Array.from({ length: 50 }, (_, i) => ({ name: `c2.vendor.dec${i}`, type: 'avc', hardware: i % 2 === 0, extra: 1 }));
    await device.timeout(3_000).emitWithAck('heartbeat', {
      ...base,
      capabilities: caps(110, {
        sdk: 34,
        device: { brand: 'Xiaomi', manufacturer: 'Xiaomi', model: 'MiTV-MZTU0', chipset: 'Mediatek MT9638', os: 'Android 14 (API 34)' },
        display: { width: 1920, height: 1080, dpi: 320, panelWidth: 3840, panelHeight: 2160, refreshHz: 60 },
        video: {
          avc: { profile: 'High', level: '5.1', ours: true, portrait: false },
          hevc: { profile: 'Main 10', level: '5.1', ours: 'yes' },
          decoders: [...decoders, { name: '', type: 'avc', hardware: true }],
        },
        platform: 'googletv',
      }),
    });
    const d = await detail();
    assert.equal(d.capabilities.device.chipset, 'Mediatek MT9638');
    assert.equal(d.capabilities.display.panelWidth, 3840);
    assert.deepEqual(d.capabilities.video.avc, { profile: 'High', level: '5.1', ours: true, portrait: false });
    assert.equal(d.capabilities.video.hevc, null, 'a malformed entry is dropped, not guessed');
    assert.equal(d.capabilities.video.decoders.length, 40, 'at most 40 decoders');
    assert.equal(d.capabilities.video.decoders[0].extra, undefined);
    assert.equal(d.capabilities.platform, 'googletv');
    assert.equal(d.model, 'Xiaomi MiTV-MZTU0');
    assert.equal(d.osVersion, 'Android 14 (API 34)');
    assert.equal(d.resolution, '1920x1080');

    // An unknown platform is dropped; an older app (no device facts) leaves the columns alone.
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, capabilities: caps(110, { platform: 'tizen' }) });
    const older = await detail();
    assert.equal(older.capabilities.platform, null);
    assert.equal(older.capabilities.device, null);
    assert.equal(older.model, 'Xiaomi MiTV-MZTU0');
    assert.equal(older.osVersion, 'Android 14 (API 34)');
  });

  it('the broadcast form learns which chosen screens cannot play YouTube, and why', async () => {
    const region = places.south.id;
    const old = await pairedTv(t.base, admin, places.matarBranch.id, 'Old WebView TV');
    const none = await pairedTv(t.base, admin, places.matarBranch.id, 'Silent TV');
    const oldSock = tvSocket(old.deviceToken);
    await connected(oldSock);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    await oldSock.timeout(3_000).emitWithAck('heartbeat', { ...base, capabilities: caps(66) });

    const res = await call(t.base, 'GET', `/broadcasts/reach?level=REGION&targetId=${region}`, { cookie: admin });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const no = res.body.youtubeNo.find((s: { id: string }) => s.id === old.deviceId);
    assert.ok(no, JSON.stringify(res.body));
    assert.match(no.reason, /WebView 66, YouTube needs 80/);
    assert.ok(!res.body.youtubeNo.some((s: { id: string }) => s.id === none.deviceId), 'not reported is "unknown", not "no"');
    assert.ok(res.body.youtubeUnknown >= 1);
    assert.ok(res.body.screens >= 2);
    assert.equal((await call(t.base, 'GET', '/broadcasts/reach?level=REGION', { cookie: admin })).status, 400);
  });
});

describe('the fleet page (DC6)', () => {
  it('counts only the screens in the area the user may see', async () => {
    const tv = await pairedTv(t.base, admin, places.nadiadStation.id, 'Station TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    await device.timeout(3_000).emitWithAck('heartbeat', {
      currentMediaId: null,
      storageFreeBytes: 1,
      ramFreeBytes: 1,
      appVersion: '0.9.0',
      capabilities: {
        sdk: 28, webView: null, h264_1080p: false, hevc: false, deviceOwner: true, brightness: null,
        network: { type: 'ethernet', wifiDbm: null }, screenOff: null, videoInScreenshot: null,
        device: { brand: 'Acme', manufacturer: 'Acme', model: 'Box 1', chipset: null, os: 'Android 9 (API 28)' },
      },
    });

    const viewer = await login(t.base, await createUser(t.prisma, 'BRANCH_VIEWER', { branchId: places.nadiadStation.id }));
    const mine = await call(t.base, 'GET', '/screens/fleet', { cookie: viewer });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.screens, 1);
    assert.equal(mine.body.reported, 1);
    assert.deepEqual(mine.body.models, [{ label: 'Acme Box 1', screens: 1, online: 1 }]);
    assert.equal(mine.body.lowestSdk, 28);
    assert.deepEqual(mine.body.videos, { yes: 0, no: 1, unknown: 0 });
    assert.equal(mine.body.attention[0].name, 'Station TV');
    assert.equal(mine.body.attention[0].branch, 'Nadiad Station');

    const all = (await call(t.base, 'GET', '/screens/fleet', { cookie: admin })).body;
    assert.ok(all.screens > 1, 'head office sees every screen');
    const other = await login(t.base, await createUser(t.prisma, 'BRANCH_VIEWER', { branchId: places.nadiadMain.id }));
    assert.equal((await call(t.base, 'GET', '/screens/fleet', { cookie: other })).body.screens, 0);
    assert.equal((await call(t.base, 'GET', '/screens/fleet')).status, 401);
  });
});

describe('"Test screen off"', () => {
  it('reaches the TV, and its answer (with the reason) shows in the command list and as a capability', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Night TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const got = new Promise<{ commandId: string; type: string }>((resolve) => device.once('command', resolve));
    const sent = await call(t.base, 'POST', `/screens/${tv.deviceId}/commands`, { cookie: admin, body: { type: 'screenOffTest' } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const cmd = await got;
    assert.equal(cmd.type, 'screenOffTest');

    const reason = "This TV ignores the app's screen-off request. Use the TV's own on/off timer.";
    await device.timeout(3_000).emitWithAck('command:ack', { commandId: cmd.commandId, ok: false, error: reason });
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    await device.timeout(3_000).emitWithAck('heartbeat', {
      ...base,
      capabilities: { sdk: 28, webView: null, h264_1080p: true, hevc: null, deviceOwner: true, brightness: null, network: { type: 'ethernet', wifiDbm: null }, screenOff: false, videoInScreenshot: null },
    });

    const list = (await call(t.base, 'GET', `/screens/${tv.deviceId}/commands`, { cookie: admin })).body as { type: string; status: string; error: string }[];
    const entry = list.find((c) => c.type === 'screenOffTest');
    assert.equal(entry?.status, 'FAILED');
    assert.equal(entry?.error, reason);
    assert.equal((await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body.capabilities.screenOff, false);
  });
});

describe('keeping screens in step', () => {
  it('a branch setting turns it on for its TVs; each TV reports how close it is', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Synced TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
    const sync = async () => (await call(t.base, 'GET', '/devices/manifest', { token: tv.deviceToken })).body.settings.sync;
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;

    assert.equal(await sync(), false, 'off until head office turns it on');
    assert.equal((await detail()).syncPlayback, false);
    const res = await call(t.base, 'PATCH', `/branches/${places.matarBranch.id}`, { cookie: admin, body: { syncPlayback: true } });
    assert.equal(res.status, 200);
    assert.equal(await sync(), true);
    assert.equal((await detail()).syncPlayback, true);
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'branch.update', entityId: places.matarBranch.id }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual((audit?.details as { after: { syncPlayback: boolean } }).after.syncPlayback, true);

    assert.equal((await detail()).playSync, null, 'unknown until the TV says');
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, sync: { mode: 'synced', offsetErrorMs: 12, driftMs: -35, clockCertain: true, extra: 1 } });
    assert.deepEqual((await detail()).playSync, { mode: 'synced', offsetErrorMs: 12, driftMs: -35, clockCertain: true });
    // Nonsense is ignored, the last good report stays.
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, sync: { mode: 'sideways' } });
    assert.equal((await detail()).playSync.driftMs, -35);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, sync: { mode: 'free', offsetErrorMs: null, driftMs: 99, clockCertain: false } });
    assert.deepEqual((await detail()).playSync, { mode: 'free', offsetErrorMs: null, driftMs: null, clockCertain: false });

    await call(t.base, 'PATCH', `/branches/${places.matarBranch.id}`, { cookie: admin, body: { syncPlayback: false } });
    assert.equal(await sync(), false);
  });
});
