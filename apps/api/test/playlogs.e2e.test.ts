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

  it('refuses the TV’s own bookkeeping fields, so the TV must send clean entries', async () => {
    const res = await upload([{ mediaId, startedAt: new Date().toISOString(), durationMs: 5_000, elapsedAt: 1, boot: 'boot-1' }]);
    assert.equal(res.status, 400);
  });
});
