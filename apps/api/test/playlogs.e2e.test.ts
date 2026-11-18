// Proof of play from the TVs: plays recorded while a TV's clock was not set are kept, flagged and counted.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMedia, createPlaces, createUser, login, pairedTv, resetDb, startApp, type TestApp, type TestTv } from './helpers';

let t: TestApp;
let admin: string;
let tv: TestTv;
let mediaId: string;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  const places = await createPlaces(t.prisma);
  admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
  tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Clock test');
  mediaId = (await createMedia(t.prisma, 'Poster')).id;
});
after(() => t.close());

const day = new Date().toISOString().slice(0, 10);
const upload = (entries: object[]) => call(t.base, 'POST', '/devices/playlogs', { token: tv.deviceToken, body: { entries } });

describe('plays recorded while the TV clock was not set', () => {
  it('are stored with a flag and counted in the report and the export', async () => {
    const now = Date.now();
    const res = await upload([
      { mediaId, startedAt: new Date(now - 60_000).toISOString(), durationMs: 10_000 },
      { mediaId, startedAt: new Date(now - 30_000).toISOString(), durationMs: 10_000, clockUncertain: true },
    ]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.accepted, 2);
    assert.equal(await t.prisma.playLog.count({ where: { screenId: tv.deviceId, clockUncertain: true } }), 1);

    const report = await call(t.base, 'GET', `/reports/plays?from=${day}&to=${day}`, { cookie: admin });
    assert.equal(report.status, 200);
    assert.equal(report.body.totals.plays, 2);
    assert.equal(report.body.totals.uncertainPlays, 1);

    const csv = await call(t.base, 'GET', `/reports/plays/export?from=${day}&to=${day}`, { cookie: admin });
    const text = String(csv.body);
    assert.match(text, /Plays with TV clock not set/);
    assert.match(text, /,2,[\d.]+,1\r?\n?$/m);
  });

  it('a batch sent twice (the reply was lost) counts once (OF11)', async () => {
    const startedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    const batch = [{ mediaId, startedAt, durationMs: 8_000 }];
    assert.equal((await upload(batch)).body.accepted, 1);
    const again = await upload(batch);
    assert.equal(again.status, 200);
    assert.equal(again.body.accepted, 0);
    assert.equal(await t.prisma.playLog.count({ where: { screenId: tv.deviceId, startedAt: new Date(startedAt) } }), 1);
  });

  it('a play re-sent with its time corrected once the clock was set still counts once, by its play id (OF11)', async () => {
    const before = (await call(t.base, 'GET', `/reports/plays?from=${day}&to=${day}`, { cookie: admin })).body.totals.plays as number;
    const playId = '6f1c2a40-8d3b-4c55-9a7e-2b0d9e1f4a11';
    const guessed = new Date(Date.now() - 3 * 60_000).toISOString();
    const real = new Date(Date.now() - 2 * 60_000).toISOString();
    assert.equal((await upload([{ mediaId, startedAt: guessed, durationMs: 9_000, clockUncertain: true, playId }])).body.accepted, 1);
    // The reply was lost; meanwhile the clock was set, so the same play goes again with its real time.
    assert.equal((await upload([{ mediaId, startedAt: real, durationMs: 9_000, playId }])).body.accepted, 0);
    assert.equal(await t.prisma.playLog.count({ where: { screenId: tv.deviceId, playId } }), 1);
    const after = (await call(t.base, 'GET', `/reports/plays?from=${day}&to=${day}`, { cookie: admin })).body.totals.plays as number;
    assert.equal(after, before + 1);
    // Older apps send no play id: still fine.
    assert.equal((await upload([{ mediaId, startedAt: new Date(Date.now() - 90_000).toISOString(), durationMs: 5_000 }])).body.accepted, 1);
    assert.equal((await upload([{ mediaId, startedAt: real, durationMs: 9_000, playId: 'not-a-uuid' }])).status, 400);
  });

  it('refuses the TV’s own bookkeeping fields, so the TV must send clean entries', async () => {
    const res = await upload([{ mediaId, startedAt: new Date().toISOString(), durationMs: 5_000, elapsedAt: 1, boot: 'boot-1' }]);
    assert.equal(res.status, 400);
  });
});
