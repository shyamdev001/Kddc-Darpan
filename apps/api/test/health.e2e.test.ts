// /api/health is what Uptime Kuma watches: it must say when the disk is filling or processing is stuck.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { healthWarnings, STUCK_QUEUE_MIN } from '../src/health.controller';
import { resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
});
after(() => t.close());

describe('health check', () => {
  it('reports the database, free disk and the processing queue, without signing in', async () => {
    const res = await fetch(`${t.base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'ok');
    assert.ok(body.disk.freeMb > 0 && body.disk.totalMb >= body.disk.freeMb, JSON.stringify(body.disk));
    assert.deepEqual(body.queue, { waiting: 0, oldestWaitingMin: null });
    assert.deepEqual(body.warnings, []);
  });

  it('warns when an upload has waited too long for processing', async () => {
    const long = new Date(Date.now() - (STUCK_QUEUE_MIN + 5) * 60_000);
    await t.prisma.$executeRaw`
      INSERT INTO "Media" (id, "originalName", "displayName", type, status, "originalKey", "originalSha256", "originalSizeBytes", "originalMimeType", tags, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'stuck.mp4', 'Stuck', 'VIDEO', 'UPLOADED', 'originals/stuck.mp4', 'sha-stuck', 1, 'video/mp4', '{}', ${long}, ${long})`;
    const body = await (await fetch(`${t.base}/health`)).json();
    assert.equal(body.status, 'warn');
    assert.equal(body.queue.waiting, 1);
    assert.ok(body.queue.oldestWaitingMin >= STUCK_QUEUE_MIN);
    assert.match(body.warnings[0], /processing is stuck/);
    await t.prisma.media.deleteMany();
  });

  it('warns below the free-space floor', () => {
    assert.deepEqual(healthWarnings({ freeMb: 5000, totalMb: 80000 }, { waiting: 0, oldestWaitingMin: null }, 2048), []);
    const w = healthWarnings({ freeMb: 1024, totalMb: 80000 }, { waiting: 2, oldestWaitingMin: 3 }, 2048);
    assert.deepEqual(w, ['Low disk space: 1.0 GB free']);
  });
});
