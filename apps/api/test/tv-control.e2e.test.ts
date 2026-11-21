// TV control (docs/DEVICE_COMPATIBILITY.md): reboot, volume and mute reach only TVs that reported
// they can do them; the TV's own status (screen on/off, boot time, network, thermal, night mode)
// is cleaned and shown on the screen page.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_NAMESPACE, commandReplySec, commandUnsupported, type TvCapabilities } from '@darpan/shared';
import { io, type Socket } from 'socket.io-client';
import { cleanTvStatus } from '../src/screens/capabilities';
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
const base = { currentMediaId: null, storageFreeBytes: 1, ramFreeBytes: 1, appVersion: '0.1.0' };
const caps = (over: Partial<TvCapabilities> = {}): TvCapabilities => ({
  sdk: 28,
  webView: null,
  h264_1080p: true,
  hevc: null,
  deviceOwner: true,
  brightness: null,
  network: { type: 'ethernet', wifiDbm: null },
  screenOff: null,
  videoInScreenshot: null,
  device: null,
  display: null,
  video: null,
  platform: null,
  reboot: true,
  volume: null,
  ...over,
});

describe('which commands a TV can take', () => {
  it('follows what the TV reported', () => {
    assert.equal(commandUnsupported('reboot', caps()), null);
    assert.match(commandUnsupported('reboot', caps({ deviceOwner: false, reboot: false }))!, /Kiosk mode is not set up/);
    assert.match(commandUnsupported('reboot', caps({ sdk: 23, reboot: false }))!, /Android 7/);
    assert.match(commandUnsupported('reboot', caps({ reboot: false }))!, /refused/);
    assert.match(commandUnsupported('reboot', caps({ reboot: null }))!, /Update the TV app/, 'app too old to report it');
    assert.match(commandUnsupported('volume', null)!, /Update the TV app/);
    assert.equal(commandUnsupported('volume', caps({ volume: null })), null, 'never tried: let the TV try');
    assert.match(commandUnsupported('mute', caps({ volume: false }))!, /TV remote/);
    assert.match(commandUnsupported('screenOffTest', caps({ deviceOwner: false }))!, /Kiosk mode/);
    assert.equal(commandUnsupported('screenOffTest', null), null, 'an old app answers for itself');
    assert.equal(commandUnsupported('reload', caps({ deviceOwner: false })), null);
  });

  it('the screen-off test may take minutes to answer', () => {
    assert.ok(commandReplySec('screenOffTest') >= 7 * 60);
    assert.equal(commandReplySec('reboot'), 90);
  });
});

describe('TV status', () => {
  it('keeps known fields only and turns uptime into a boot time', () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const s = cleanTvStatus(
      {
        screenOn: true,
        uptimeSec: 3600,
        ip: '10.1.2.3',
        networkType: 'wifi',
        thermal: 'moderate',
        bootReason: 'cold_boot,powerkey',
        lastExit: { reason: 'lowMemory', agoSec: 60 },
        volume: 40,
        muted: false,
        nightMode: null,
        extra: 'dropped',
      },
      now,
    )!;
    assert.equal(s.bootedAt, '2026-11-21T09:00:00.000Z');
    assert.equal(s.ip, '10.1.2.3');
    assert.equal(s.thermal, 'moderate');
    assert.deepEqual(s.lastExit, { reason: 'lowMemory', at: '2026-11-21T09:59:00.000Z' });
    assert.equal(s.volume, 40);
    assert.equal('extra' in s, false);

    const bad = cleanTvStatus({ ip: '999.1.1.1', networkType: 'pigeon', thermal: 'hot', bootReason: '<script>', volume: 140, nightMode: 'off', uptimeSec: -5 }, now)!;
    assert.equal(bad.ip, null);
    assert.equal(bad.networkType, null);
    assert.equal(bad.thermal, null);
    assert.equal(bad.bootReason, null);
    assert.equal(bad.volume, null);
    assert.equal(bad.nightMode, null);
    assert.equal(bad.bootedAt, null);
    assert.equal(cleanTvStatus('nope', now), null);
  });

  it('a heartbeat stores it and the screen page shows it; an older app leaves it alone', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Status TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, status: { screenOn: true, uptimeSec: 120, nightMode: 'black', networkType: 'ethernet' } });
    let detail = (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;
    assert.equal(detail.tvStatus.nightMode, 'black');
    assert.equal(detail.tvStatus.networkType, 'ethernet');
    assert.ok(detail.tvStatus.bootedAt);

    await device.timeout(3_000).emitWithAck('heartbeat', base); // no status field
    detail = (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;
    assert.equal(detail.tvStatus.nightMode, 'black', 'kept');
  });
});

describe('reboot, volume and mute', () => {
  it('are refused for a TV that reported it cannot, and reach one that can, with the level', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Control TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const send = (body: object) => call(t.base, 'POST', `/screens/${tv.deviceId}/commands`, { cookie: admin, body });

    // Nothing reported yet: an app too old to know these.
    let r = await send({ type: 'reboot' });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Update the TV app/);

    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, capabilities: caps({ deviceOwner: false, reboot: false, volume: false }) });
    r = await send({ type: 'reboot' });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Kiosk mode is not set up/);
    r = await send({ type: 'mute' });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /TV remote/);

    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, capabilities: caps() });
    assert.equal((await send({ type: 'volume' })).status, 400, 'no level');
    assert.equal((await send({ type: 'volume', level: 101 })).status, 400);
    assert.equal((await send({ type: 'volume', level: 2.5 })).status, 400);

    const got = new Promise<{ commandId: string; type: string; params?: { level: number } }>((resolve) => device.once('command', resolve));
    r = await send({ type: 'volume', level: 35 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const cmd = await got;
    assert.equal(cmd.type, 'volume');
    assert.deepEqual(cmd.params, { level: 35 });
    await device.timeout(3_000).emitWithAck('command:ack', { commandId: cmd.commandId, ok: true });
    const list = (await call(t.base, 'GET', `/screens/${tv.deviceId}/commands`, { cookie: admin })).body as { type: string; status: string }[];
    assert.equal(list.find((c) => c.type === 'volume')?.status, 'ACKED');

    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'screen.command.volume', entityId: tv.deviceId } });
    assert.equal((audit?.details as { level?: number } | null)?.level, 35, 'the level is in the activity log');

    const reboot = new Promise<{ type: string }>((resolve) => device.once('command', resolve));
    assert.equal((await send({ type: 'reboot' })).status, 201);
    assert.equal((await reboot).type, 'reboot');
  });
});
