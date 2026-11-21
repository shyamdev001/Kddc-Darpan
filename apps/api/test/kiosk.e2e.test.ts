// Kiosk escape hatches (docs/AUDIT.md K1, K3, K7): the local unlock PIN, taking a TV out of kiosk
// mode from head office, unlocks at the TV in the activity log, and no release to all while a test
// TV crash-loops on that version.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_NAMESPACE } from '@darpan/shared';
import { io, type Socket } from 'socket.io-client';
import { codeAt, currentStep, encryptSecret, newSecret } from '../src/auth/totp';
import { hashKioskPin } from '../src/screens/kiosk.service';
import { call, createPlaces, createUser, login, pairedTv, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
let origin: string;
let admin: string; // HO_ADMIN
let superCookie: string;
let superId: string;
let secret: string;
let places: Awaited<ReturnType<typeof createPlaces>>;
const open: Socket[] = [];

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  places = await createPlaces(t.prisma);
  admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
  const su = await createUser(t.prisma, 'SUPER_ADMIN');
  superCookie = await login(t.base, su);
  superId = su.id;
  // Two-step sign-in turned on after this session started, as if set up on the account page.
  secret = newSecret();
  await t.prisma.user.update({ where: { id: su.id }, data: { totpEnabled: true, totpSecret: encryptSecret(secret) } });
  origin = t.base.replace(/\/api$/, '');
});
after(async () => {
  for (const s of open) s.disconnect();
  await t.close();
});

/** A code from the app that has not been used yet (each 30-second code works once). */
async function freshCode(): Promise<string> {
  await t.prisma.user.update({ where: { id: superId }, data: { totpLastStep: null } });
  return codeAt(secret, currentStep());
}
const wrongCode = () => String((Number(codeAt(secret, currentStep())) + 500_000) % 1_000_000).padStart(6, '0');

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

describe('kiosk PIN hash', () => {
  it('matches the TV app (same vector as KioskPinTest.kt)', () => {
    const h = hashKioskPin('482916', Buffer.from('00112233445566778899aabbccddeeff', 'hex'), 1000);
    assert.equal(h.hash, '91cc3f382c2660c4e46cd8f9bc453033a547a39a7953df61554f91d06afd49a7');
    assert.equal(h.salt, '00112233445566778899aabbccddeeff');
  });
});

describe('kiosk unlock PIN', () => {
  it('only a super admin with a fresh code sets it; TVs get the salted hash, never the PIN', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'PIN TV');
    const manifest = async () => (await call(t.base, 'GET', '/devices/manifest', { token: tv.deviceToken })).body;
    assert.equal((await manifest()).settings.kioskPin, null);
    assert.equal((await call(t.base, 'GET', '/kiosk/pin', { cookie: admin })).body.set, false);

    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: admin, body: { pin: '482916', code: '123456' } })).status, 403, 'head office admin');
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '48291', code: await freshCode() } })).status, 400, 'too short');
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '777777', code: await freshCode() } })).status, 400, 'one digit repeated');
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '482916', code: wrongCode() } })).status, 400, 'wrong code');
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '482916' } })).status, 400, 'no code');

    const set = await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '482916', code: await freshCode() } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.set, true);
    assert.ok(set.body.updatedBy);

    const pin = (await manifest()).settings.kioskPin;
    assert.equal(pin.iterations, 20_000);
    assert.match(pin.salt, /^[0-9a-f]{32}$/);
    assert.equal(pin.hash, hashKioskPin('482916', Buffer.from(pin.salt, 'hex'), pin.iterations).hash);
    assert.ok(!JSON.stringify(await manifest()).includes('482916'));
    assert.ok(!JSON.stringify(await t.prisma.kioskSettings.findUnique({ where: { id: 1 } })).includes('482916'));
    assert.ok(await t.prisma.auditLog.findFirst({ where: { action: 'kiosk.pin.set', userId: superId } }));

    // The same code a second time is refused (it could have been seen over a shoulder).
    const code = await freshCode();
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: null, code } })).status, 200);
    assert.equal((await call(t.base, 'PUT', '/kiosk/pin', { cookie: superCookie, body: { pin: '482916', code } })).status, 400);
    assert.equal((await manifest()).settings.kioskPin, null);
    assert.ok(await t.prisma.auditLog.findFirst({ where: { action: 'kiosk.pin.remove' } }));
  });
});

describe('unlocks at the TV', () => {
  it('rescue mode and PIN state are kept; each kiosk event is logged once', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Unlock TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    const detail = async () => (await call(t.base, 'GET', `/screens/${tv.deviceId}`, { cookie: admin })).body;
    assert.equal((await detail()).rescueMode, false);
    assert.equal((await detail()).kioskPinSet, null);

    const events = [
      { id: '5f1c2a9e-0000-4000-8000-000000000001', kind: 'pinFailed', agoSec: 120 },
      { id: '5f1c2a9e-0000-4000-8000-000000000002', kind: 'pinUnlock', agoSec: 60 },
      { id: 'not an id!', kind: 'pinUnlock', agoSec: 1 },
      { id: '5f1c2a9e-0000-4000-8000-000000000003', kind: 'rootShell', agoSec: 1 },
    ];
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, rescueMode: true, kioskPinSet: true, kioskEvents: events });
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, rescueMode: true, kioskPinSet: true, kioskEvents: events }); // repeated
    const d = await detail();
    assert.equal(d.rescueMode, true);
    assert.equal(d.kioskPinSet, true);

    const rows = await t.prisma.auditLog.findMany({ where: { entityId: tv.deviceId, action: { startsWith: 'screen.kiosk.' } }, orderBy: { action: 'asc' } });
    assert.deepEqual(rows.map((r) => r.action), ['screen.kiosk.pinFailed', 'screen.kiosk.pinUnlock']);
    const at = Date.parse((rows[1].details as { at: string }).at);
    assert.ok(Math.abs(Date.now() - 60_000 - at) < 15_000, 'time from seconds ago');

    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, rescueMode: false });
    assert.equal((await detail()).rescueMode, false);
    assert.equal((await detail()).kioskPinSet, true, 'an older app leaves it as it was');
  });
});

describe('taking a TV out of kiosk mode (K7)', () => {
  it('super admin only, the right name, a reason and a fresh code; the reason is in the activity log', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Old Lobby TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, kiosk: 'locked' });
    const release = (cookie: string, body: object) => call(t.base, 'POST', `/screens/${tv.deviceId}/kiosk-release`, { cookie, body });
    const good = { action: 'exit', confirmName: 'old lobby tv', reason: 'Handed back to the vendor' };

    assert.equal((await release(admin, { ...good, code: '123456' })).status, 403);
    assert.equal((await release(superCookie, { ...good, confirmName: 'Lobby TV', code: await freshCode() })).status, 400, 'wrong name');
    assert.equal((await release(superCookie, { ...good, reason: 'eh', code: await freshCode() })).status, 400, 'no real reason');
    assert.equal((await release(superCookie, { ...good, action: 'wipe', code: await freshCode() })).status, 400, 'unknown action');
    assert.equal((await release(superCookie, { ...good, code: wrongCode() })).status, 400, 'wrong code');
    assert.equal(await t.prisma.deviceCommand.count({ where: { screenId: tv.deviceId } }), 0, 'nothing was sent');

    const got = new Promise<{ commandId: string; type: string }>((resolve) => device.once('command', resolve));
    const res = await release(superCookie, { ...good, code: await freshCode() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await got).type, 'kioskExit');
    const audit = await t.prisma.auditLog.findFirst({ where: { action: 'screen.command.kioskExit', entityId: tv.deviceId } });
    assert.equal(audit?.userId, superId);
    assert.equal((audit?.details as { reason: string }).reason, 'Handed back to the vendor');

    // Removing device owner goes the same way.
    const got2 = new Promise<{ commandId: string; type: string }>((resolve) => device.once('command', resolve));
    assert.equal((await release(superCookie, { ...good, action: 'removeOwner', code: await freshCode() })).status, 201);
    assert.equal((await got2).type, 'kioskRemoveOwner');

    // The dashboard's command list cannot send them.
    assert.equal((await call(t.base, 'POST', `/screens/${tv.deviceId}/commands`, { cookie: superCookie, body: { type: 'kioskExit' } })).status, 400);
  });

  it('is refused for a TV that is not in kiosk mode', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Plain TV');
    const device = tvSocket(tv.deviceToken);
    await connected(device);
    await device.timeout(3_000).emitWithAck('heartbeat', { ...base, kiosk: 'off' });
    const res = await call(t.base, 'POST', `/screens/${tv.deviceId}/kiosk-release`, {
      cookie: superCookie,
      body: { action: 'exit', confirmName: 'Plain TV', reason: 'Testing it here', code: await freshCode() },
    });
    assert.equal(res.status, 409);
  });
});

describe('no release to all while a test TV crash-loops on it (K3)', () => {
  it('names the screen, and allows it once the TV is well', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Test group TV');
    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { testUpdates: true, appVersionCode: 42, rescueMode: true } });
    const r = await t.prisma.appRelease.create({ data: { versionCode: 42, versionName: '0.42', storageKey: 'releases/42.apk', sha256: 'a'.repeat(64), sizeBytes: 1000n } });

    const blocked = await call(t.base, 'PATCH', `/releases/${r.id}`, { cookie: admin, body: { stage: 'ALL' } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /Test group TV/);
    assert.equal((await t.prisma.appRelease.findUnique({ where: { id: r.id } }))?.stage, 'TEST');

    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { rescueMode: false, safeMode: true } });
    assert.equal((await call(t.base, 'PATCH', `/releases/${r.id}`, { cookie: admin, body: { stage: 'ALL' } })).status, 409, 'safe mode too');

    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { safeMode: false } });
    const ok = await call(t.base, 'PATCH', `/releases/${r.id}`, { cookie: admin, body: { stage: 'ALL' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});
