// The TV side: registering, pairing, what the manifest tells each TV to play, and broadcasts.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PlaylistResolver, screenPlaceSelect } from '../src/screens/playlist-resolver.service';
import { assign, call, createMedia, createPlaces, createPlaylist, createUser, login, pairedTv, registerTv, resetDb, startApp, type TestApp, type TestTv } from './helpers';

let t: TestApp;
let admin: string;
let places: Awaited<ReturnType<typeof createPlaces>>;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  places = await createPlaces(t.prisma);
  admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
});
after(() => t.close());

const manifest = (tv: TestTv) => call(t.base, 'GET', '/devices/manifest', { token: tv.deviceToken });
const playlistNames = async (tv: TestTv) => {
  const res = await manifest(tv);
  assert.equal(res.status, 200);
  return (res.body.playlists as { name: string }[]).map((p) => p.name);
};

describe('registering and pairing a TV', () => {
  it('gives a new TV a token and a 6-digit pairing code', async () => {
    const tv = await registerTv(t.base);
    assert.match(tv.pairingCode, /^\d{6}$/);
    const row = await t.prisma.screen.findUniqueOrThrow({ where: { id: tv.deviceId } });
    assert.equal(row.status, 'PENDING');
    assert.notEqual(row.deviceTokenHash, tv.deviceToken); // only the hash is stored
  });

  it('refuses TV requests without a valid token', async () => {
    assert.equal((await call(t.base, 'GET', '/devices/manifest')).status, 401);
    assert.equal((await call(t.base, 'GET', '/devices/manifest', { token: 'made-up' })).status, 401);
  });

  it('gives no manifest until the TV is paired', async () => {
    const tv = await registerTv(t.base);
    assert.equal((await manifest(tv)).status, 403);
  });

  it('refuses a wrong pairing code and logs the attempt', async () => {
    const before = await t.prisma.auditLog.count({ where: { action: 'screen.claim_failed' } });
    const res = await call(t.base, 'POST', '/screens/claim', { cookie: admin, body: { pairingCode: '000000', name: 'X', branchId: places.matarBranch.id } });
    assert.equal(res.status, 400);
    assert.equal(await t.prisma.auditLog.count({ where: { action: 'screen.claim_failed' } }), before + 1);
  });

  it('refuses an expired pairing code', async () => {
    const tv = await registerTv(t.base);
    await t.prisma.screen.update({ where: { id: tv.deviceId }, data: { pairingExpires: new Date(Date.now() - 1000) } });
    const res = await call(t.base, 'POST', '/screens/claim', { cookie: admin, body: { pairingCode: tv.pairingCode, name: 'X', branchId: places.matarBranch.id } });
    assert.equal(res.status, 400);
  });

  it('pairs with the right code, and the TV can then fetch its manifest', async () => {
    const tv = await pairedTv(t.base, admin, places.matarBranch.id, 'Paired TV');
    const row = await t.prisma.screen.findUniqueOrThrow({ where: { id: tv.deviceId } });
    assert.equal(row.name, 'Paired TV');
    assert.equal(row.pairingCode, null);
    assert.equal((await manifest(tv)).status, 200);
    assert.equal(await t.prisma.auditLog.count({ where: { action: 'screen.claim', entityId: tv.deviceId } }), 1);
  });

  it('cancels the old token when a reset TV registers again', async () => {
    const hardwareId = `hw-${randomUUID()}`;
    const body = { hardwareId, model: 'Test TV', osVersion: '11', resolution: '1920x1080' };
    const first = await call(t.base, 'POST', '/devices/register', { body });
    const second = await call(t.base, 'POST', '/devices/register', { body });
    assert.equal(first.body.deviceId, second.body.deviceId);
    assert.equal((await call(t.base, 'GET', '/devices/status', { token: first.body.deviceToken })).status, 401);
    assert.equal((await call(t.base, 'GET', '/devices/status', { token: second.body.deviceToken })).status, 200);
  });
});

describe('what a TV plays', () => {
  let mainTv: TestTv;
  let stationTv: TestTv;
  let matarTv: TestTv;

  before(async () => {
    await t.prisma.assignment.deleteMany();
    mainTv = await pairedTv(t.base, admin, places.nadiadMain.id, 'Main');
    stationTv = await pairedTv(t.base, admin, places.nadiadStation.id, 'Station');
    matarTv = await pairedTv(t.base, admin, places.matarBranch.id, 'Matar');
    const poster = await createMedia(t.prisma, 'Poster');
    await assign(t.prisma, (await createPlaylist(t.prisma, 'Everyone', [poster.id])).id, 'ALL');
    await assign(t.prisma, (await createPlaylist(t.prisma, 'North region', [poster.id])).id, 'REGION', places.north.id);
    await assign(t.prisma, (await createPlaylist(t.prisma, 'Nadiad Main branch', [poster.id])).id, 'BRANCH', places.nadiadMain.id);
  });

  it('uses the closest level: branch over region over everyone', async () => {
    assert.deepEqual(await playlistNames(mainTv), ['Nadiad Main branch']);
    assert.deepEqual(await playlistNames(stationTv), ['North region']);
    assert.deepEqual(await playlistNames(matarTv), ['Everyone']);
  });

  it('lets a playlist set on the screen itself win', async () => {
    const own = await createPlaylist(t.prisma, 'Station own', [(await createMedia(t.prisma, 'Own')).id]);
    const res = await call(t.base, 'PUT', `/screens/${stationTv.deviceId}/playlist`, { cookie: admin, body: { playlistId: own.id } });
    assert.equal(res.status, 200);
    assert.deepEqual(await playlistNames(stationTv), ['Station own']);
    assert.equal(await t.prisma.auditLog.count({ where: { action: 'screen.assign_playlist', entityId: stationTv.deviceId } }), 1);
  });

  it('sends a timed playlist ahead of the always-on one, so the TV can switch by itself', async () => {
    const offer = await createPlaylist(t.prisma, 'Morning offer', [(await createMedia(t.prisma, 'Offer')).id]);
    const a = await assign(t.prisma, offer.id, 'BRANCH', places.matarBranch.id, [{ start: '09:00', end: '11:00' }]);
    try {
      assert.deepEqual(await playlistNames(matarTv), ['Morning offer', 'Everyone']);
    } finally {
      await t.prisma.assignment.delete({ where: { id: a.id } });
    }
  });

  it('plays the timed playlist only inside its time (IST)', async () => {
    const offer = await createPlaylist(t.prisma, 'Evening offer', [(await createMedia(t.prisma, 'Evening')).id]);
    const a = await assign(t.prisma, offer.id, 'BRANCH', places.matarBranch.id, [{ days: [4], start: '17:00', end: '20:00' }]);
    try {
      const resolver = t.app.get(PlaylistResolver);
      const place = await t.prisma.screen.findUniqueOrThrow({ where: { id: matarTv.deviceId }, select: screenPlaceSelect });
      const at = (local: string) => new Date(`${local}:00+05:30`);
      assert.equal((await resolver.resolve(place, false, at('2026-11-12T18:00')))?.name, 'Evening offer'); // Thursday
      assert.equal((await resolver.resolve(place, false, at('2026-11-12T16:59')))?.name, 'Everyone');
      assert.equal((await resolver.resolve(place, false, at('2026-11-13T18:00')))?.name, 'Everyone'); // Friday
    } finally {
      await t.prisma.assignment.delete({ where: { id: a.id } });
    }
  });

  it('drops a schedule whose last day has passed', async () => {
    const old = await createPlaylist(t.prisma, 'Old campaign', [(await createMedia(t.prisma, 'Old')).id]);
    const a = await assign(t.prisma, old.id, 'BRANCH', places.matarBranch.id, [{ from: '2020-01-01', to: '2020-01-31' }]);
    try {
      assert.deepEqual(await playlistNames(matarTv), ['Everyone']);
    } finally {
      await t.prisma.assignment.delete({ where: { id: a.id } });
    }
  });
});

describe('the files in a manifest', () => {
  let tv: TestTv;
  let ready: Awaited<ReturnType<typeof createMedia>>;
  let playlistId: string;

  before(async () => {
    const branch = await t.prisma.branch.create({ data: { name: `Files ${randomUUID().slice(0, 6)}`, talukaId: places.matar.id } });
    tv = await pairedTv(t.base, admin, branch.id, 'Files TV');
    ready = await createMedia(t.prisma, 'Ready');
    const processing = await createMedia(t.prisma, 'Processing', { status: 'PROCESSING' });
    const expired = await createMedia(t.prisma, 'Expired', { endDate: new Date(Date.now() - 86_400_000) });
    const video = await createMedia(t.prisma, 'Video', { type: 'VIDEO', durationSec: 42 });
    const p = await createPlaylist(t.prisma, 'Mixed', [ready.id, processing.id, expired.id, video.id], 8);
    playlistId = p.id;
    await assign(t.prisma, p.id, 'BRANCH', branch.id);
  });

  it('lists only ready, unexpired files, with their checksum and download address', async () => {
    const m = (await manifest(tv)).body;
    assert.deepEqual(
      m.items.map((i: { mediaId: string }) => i.mediaId).sort(),
      [ready.id, m.items.find((i: { type: string }) => i.type === 'VIDEO').mediaId].sort(),
    );
    const item = m.items.find((i: { mediaId: string }) => i.mediaId === ready.id);
    assert.equal(item.sha256, ready.sha256);
    assert.equal(item.url, `http://tv.test/api/devices/media/${ready.id}`);
  });

  it('times images by the playlist default and videos by their length', async () => {
    const m = (await manifest(tv)).body;
    const byType = Object.fromEntries(m.items.map((i: { type: string; durationSec: number }) => [i.type, i.durationSec]));
    assert.equal(byType.IMAGE, 8);
    assert.equal(byType.VIDEO, 42);
  });

  it('keeps the same version until something changes', async () => {
    const v1 = (await manifest(tv)).body.version;
    assert.equal((await manifest(tv)).body.version, v1);
    await t.prisma.playlist.update({ where: { id: playlistId }, data: { defaultImageSec: 12 } });
    assert.notEqual((await manifest(tv)).body.version, v1);
  });
});

describe('broadcasts', () => {
  let mainTv: TestTv;
  let matarTv: TestTv;

  before(async () => {
    mainTv = await pairedTv(t.base, admin, places.nadiadMain.id, 'Cast main');
    matarTv = await pairedTv(t.base, admin, places.matarBranch.id, 'Cast matar');
  });

  const start = (body: Record<string, unknown>) => call(t.base, 'POST', '/broadcasts', { cookie: admin, body });
  const active = async () => (await call(t.base, 'GET', '/broadcasts', { cookie: admin })).body.active as { id: string }[];
  const stopAll = async () => {
    for (const b of await active()) await call(t.base, 'POST', `/broadcasts/${b.id}/stop`, { cookie: admin });
  };

  it('reaches only the screens it was sent to, and goes away when stopped', async () => {
    const res = await start({ kind: 'MESSAGE', level: 'REGION', targetId: places.north.id, title: 'Notice', message: 'Branch closes at 2 pm today' });
    assert.equal(res.status, 201);
    const cast = (await manifest(mainTv)).body.broadcast;
    assert.equal(cast.message, 'Branch closes at 2 pm today');
    assert.equal(cast.muted, false);
    assert.equal((await manifest(matarTv)).body.broadcast, null);

    const id = (await active())[0].id;
    assert.equal((await call(t.base, 'POST', `/broadcasts/${id}/stop`, { cookie: admin })).status, 200);
    assert.equal((await manifest(mainTv)).body.broadcast, null);
    assert.equal(await t.prisma.auditLog.count({ where: { action: { in: ['broadcast.start', 'broadcast.stop'] }, entityId: id } }), 2);
  });

  it('shows the newest broadcast when two reach the same screen', async () => {
    await start({ kind: 'MESSAGE', level: 'ALL', message: 'First' });
    await new Promise((r) => setTimeout(r, 20));
    await start({ kind: 'MESSAGE', level: 'BRANCH', targetId: places.matarBranch.id, message: 'Second' });
    try {
      assert.equal((await manifest(matarTv)).body.broadcast.message, 'Second');
      assert.equal((await manifest(mainTv)).body.broadcast.message, 'First');
    } finally {
      await stopAll();
    }
  });

  it('ends by itself at its end time', async () => {
    await start({ kind: 'MESSAGE', level: 'ALL', message: 'Short', durationMin: 5 });
    try {
      assert.ok((await manifest(mainTv)).body.broadcast.endsAt);
      await t.prisma.broadcast.updateMany({ data: { endsAt: new Date(Date.now() - 1000) } });
      assert.equal((await manifest(mainTv)).body.broadcast, null);
      assert.equal((await active()).length, 0);
    } finally {
      await stopAll();
    }
  });

  it('plays a YouTube video link in YouTube’s player', async () => {
    const res = await start({ kind: 'LINK', level: 'ALL', url: 'https://youtu.be/dQw4w9WgXcQ?si=x', muted: true });
    assert.equal(res.status, 201);
    try {
      const cast = (await manifest(mainTv)).body.broadcast;
      assert.deepEqual(cast.link, { type: 'youtube', youtubeId: 'dQw4w9WgXcQ' });
      assert.equal(cast.muted, true);
    } finally {
      await stopAll();
    }
  });

  it('refuses links and files that cannot play', async () => {
    const channel = await start({ kind: 'LINK', level: 'ALL', url: 'https://www.youtube.com/@SomeChannel/live' });
    assert.equal(channel.status, 400);
    assert.match(channel.body.message, /Share/);
    assert.equal((await start({ kind: 'LINK', level: 'ALL', url: 'ftp://example.com/x' })).status, 400);
    assert.equal((await start({ kind: 'MESSAGE', level: 'ALL', message: '   ' })).status, 400);
    const processing = await createMedia(t.prisma, 'Not yet', { status: 'PROCESSING' });
    assert.equal((await start({ kind: 'MEDIA', level: 'ALL', mediaId: processing.id })).status, 400);
    assert.equal((await active()).length, 0);
  });
});
