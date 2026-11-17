// A content change reaches every connected TV quickly, and the manifest built for the push is the
// one the TV then fetches (built once, not twice).
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_NAMESPACE } from '@darpan/shared';
import { io, type Socket } from 'socket.io-client';
import { ContentEvents } from '../src/events/content-events';
import { newDeviceToken } from '../src/screens/device-auth';
import { ManifestService } from '../src/screens/manifest.service';
import { call, createPlaces, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
const sockets: Socket[] = [];
const tvs: { id: string; token: string }[] = [];
let builds = 0;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  const places = await createPlaces(t.prisma);
  for (let i = 0; i < 101; i++) {
    const { token, hash } = newDeviceToken();
    const s = await t.prisma.screen.create({
      data: { hardwareId: `hw-push-${i}-${hash.slice(0, 6)}`, deviceTokenHash: hash, status: 'OFFLINE', name: `Branch TV ${i}`, branchId: places.matarBranch.id, pairedAt: new Date() },
    });
    tvs.push({ id: s.id, token });
  }
  // Count real manifest builds.
  const svc = t.app.get(ManifestService) as unknown as { buildFresh: (id: string) => Promise<unknown> };
  const real = svc.buildFresh.bind(svc);
  svc.buildFresh = (id: string) => {
    builds++;
    return real(id);
  };
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await t.close();
});

describe('pushing a change to 101 TVs', () => {
  it('every TV hears about it within 5 s of the 2 s batching, and its fetch reuses the pushed manifest', async () => {
    const origin = t.base.replace(/\/api$/, '');
    await Promise.all(
      tvs.map(
        (tv) =>
          new Promise<void>((resolve, reject) => {
            const s = io(origin + DEVICE_NAMESPACE, { auth: { token: tv.token }, transports: ['websocket'], reconnection: false });
            sockets.push(s);
            s.once('connect', () => resolve());
            s.once('connect_error', reject);
          }),
      ),
    );

    const versions = new Map<string, string>();
    const heard = Promise.all(
      sockets.map(
        (s, i) =>
          new Promise<void>((resolve) =>
            s.once('manifest:updated', (p: { version: string }) => {
              versions.set(tvs[i].id, p.version);
              resolve();
            }),
          ),
      ),
    );
    builds = 0;
    const started = Date.now();
    t.app.get(ContentEvents).contentChanged();
    await heard;
    const took = Date.now() - started;
    assert.ok(took < 2_000 + 5_000, `all 101 TVs told within ${took} ms`);
    assert.equal(builds, 101, 'one build per TV for the push');

    // Every TV now fetches: served from what was just built.
    for (const tv of tvs) {
      const res = await call(t.base, 'GET', '/devices/manifest', { token: tv.token });
      assert.equal(res.status, 200);
      assert.equal(res.body.version, versions.get(tv.id));
    }
    assert.equal(builds, 101, 'no second build for the fetches');
  });

  it('a change forgets the kept manifest at once, so a TV never fetches an outdated one', async () => {
    const tv = tvs[0];
    await call(t.base, 'GET', '/devices/manifest', { token: tv.token });
    const before = builds;
    await call(t.base, 'GET', '/devices/manifest', { token: tv.token });
    assert.equal(builds, before, 'kept');
    t.app.get(ContentEvents).screensChanged(tv.id);
    await call(t.base, 'GET', '/devices/manifest', { token: tv.token });
    assert.equal(builds, before + 1, 'built again after the change');
  });

  it('a kept manifest expires after 30 s even without a change', async () => {
    const svc = t.app.get(ManifestService);
    const tv = tvs[1];
    await svc.forDevice(tv.id);
    const before = builds;
    await svc.forDevice(tv.id, Date.now() + 29_000);
    assert.equal(builds, before);
    await svc.forDevice(tv.id, Date.now() + 31_000);
    assert.equal(builds, before + 1);
  });
});
