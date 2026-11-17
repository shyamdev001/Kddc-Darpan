// Live updates: a TV coming online or going away reaches open dashboards at once, without a reload.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_NAMESPACE, DASHBOARD_SOCKET_PATH, DEVICE_NAMESPACE, DEVICE_REMOVED_EVENT, filesProblem, SCREENS_CHANGED_EVENT, type ScreensChangedPayload } from '@darpan/shared';
import { io, type Socket } from 'socket.io-client';
import { call, createPlaces, createUser, login, pairedTv, resetDb, startApp, type TestApp } from './helpers';

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

function tvSocket(token: string): Socket {
  const s = io(origin + DEVICE_NAMESPACE, { auth: { token }, transports: ['websocket'], reconnection: false });
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

  it('tells the dashboard at once when a TV connects and when it goes away, and online follows', async () => {
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

    // Let the batch with the connect go out first, so the next update can only be the disconnect.
    await new Promise((r) => setTimeout(r, 800));
    const wentAway = updateFor(dash, tv.deviceId);
    device.disconnect();
    await wentAway;
    // A switched-off TV shows offline right away, not after the 3-minute window.
    assert.equal(await onlineInList(tv.deviceId), false);
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
