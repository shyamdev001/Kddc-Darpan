// Uploading posters through the real API: Gujarati names, duplicates, wrong file types, processing.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { MediaService, ORIGINAL_KEEP_DAYS } from '../src/media/media.service';
import { STORAGE, type StorageDriver } from '../src/storage/storage.types';
import { createUser, login, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
let admin: string;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
});
after(() => t.close());

async function upload(name: string, data: Buffer, type: string, cookie = admin) {
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(data)], { type }), name);
  const res = await fetch(`${t.base}/media`, { method: 'POST', headers: { cookie }, body: form });
  return { status: res.status, body: (await res.json()) as any };
}

const poster = (color: string) =>
  sharp({ create: { width: 2400, height: 1350, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();

describe('uploading media', () => {
  it('accepts a poster, keeps its Gujarati name and makes it ready for the TVs', async () => {
    const name = 'દિવાળી ઓફર.jpg';
    const res = await upload(name, await poster('#e0a526'), 'image/jpeg');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.created.length, 1);
    const id = res.body.created[0].id as string;

    const row = await t.prisma.media.findUniqueOrThrow({ where: { id } });
    assert.equal(row.originalName, name);
    assert.ok(!row.originalKey.includes('દ'), 'stored file key must be plain ASCII');

    // Processing runs in the background queue: shrink to 1920x1080 at most, checksum for the TVs.
    let ready = row;
    for (let i = 0; i < 60 && ready.status !== 'READY' && ready.status !== 'FAILED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      ready = await t.prisma.media.findUniqueOrThrow({ where: { id } });
    }
    assert.equal(String(ready.status), 'READY', ready.errorMessage ?? 'still processing after 30 s');
    assert.match(ready.sha256 ?? '', /^[0-9a-f]{64}$/);
    assert.ok((ready.width ?? 0) <= 1920 && (ready.height ?? 0) <= 1080, `${ready.width}x${ready.height}`);
  });

  it('spots the same file uploaded twice', async () => {
    const data = await poster('#141936');
    assert.equal((await upload('first.jpg', data, 'image/jpeg')).body.created.length, 1);
    const again = await upload('again.jpg', data, 'image/jpeg');
    assert.equal(again.status, 201);
    assert.equal(again.body.created.length, 0);
    assert.equal(again.body.duplicates.length, 1);
  });

  it('refuses files that are not pictures or videos, with a reason', async () => {
    const res = await upload('notes.txt', Buffer.from('hello'), 'text/plain');
    assert.equal(res.status, 201);
    assert.equal(res.body.created.length, 0);
    assert.equal(res.body.rejected.length, 1);
    assert.ok(res.body.rejected[0].reason);
  });

  it('refuses uploads from people who may not change content', async () => {
    const viewer = await login(t.base, await createUser(t.prisma, 'BRANCH_VIEWER'));
    assert.equal((await upload('x.jpg', await poster('#ffffff'), 'image/jpeg', viewer)).status, 403);
  });
});

describe('media list paging', () => {
  it('520 items come back in pages, all of them, none twice, newest first', async () => {
    await t.prisma.media.deleteMany();
    // Many share one upload time (a bulk upload), so the order must not rely on the time alone.
    const sameTime = new Date('2026-11-01T10:00:00.000Z');
    await t.prisma.media.createMany({
      data: Array.from({ length: 520 }, (_, i) => ({
        originalName: `poster-${i}.jpg`,
        displayName: `Poster ${i}`,
        type: 'IMAGE' as const,
        status: 'READY' as const,
        originalKey: `originals/paging-${i}.jpg`,
        originalSha256: `sha-paging-${i}`,
        originalSizeBytes: 1000n,
        originalMimeType: 'image/jpeg',
        createdAt: i < 300 ? sameTime : new Date(sameTime.getTime() + i * 1000),
      })),
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `?limit=200&cursor=${cursor}` : '?limit=200';
      const res = await fetch(`${t.base}/media${qs}`, { headers: { cookie: admin } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: { id: string; createdAt: string }[]; counts: { all: number }; nextCursor: string | null };
      assert.equal(body.counts.all, pages === 0 ? 520 : 521, 'the count is of the whole library');
      seen.push(...body.items.map((m) => m.id));
      // Something added mid-way must not shift the pages.
      if (pages === 0) {
        await t.prisma.media.create({
          data: { originalName: 'new.jpg', displayName: 'New', type: 'IMAGE', status: 'READY', originalKey: 'originals/paging-new.jpg', originalSha256: 'sha-paging-new', originalSizeBytes: 1n, originalMimeType: 'image/jpeg' },
        });
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    assert.equal(pages, 3);
    assert.equal(seen.length, 520);
    assert.equal(new Set(seen).size, 520, 'no item twice');

    const first = await fetch(`${t.base}/media`, { headers: { cookie: admin } }).then((r) => r.json() as Promise<{ items: { displayName: string }[] }>);
    assert.equal(first.items.length, 200, 'default page size');
    assert.equal(first.items[0].displayName, 'New', 'newest first');

    const bad = await fetch(`${t.base}/media?cursor=not-a-cursor`, { headers: { cookie: admin } });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${t.base}/media?limit=501`, { headers: { cookie: admin } })).status, 400);
    await t.prisma.media.deleteMany();
  });
});

describe('keeping originals', () => {
  it('a month after processing worked the original is deleted; the TVs\' file stays and duplicates are still spotted', async () => {
    const data = await poster('#3a7d44');
    const res = await upload('retention.jpg', data, 'image/jpeg');
    const id = res.body.created[0].id as string;
    let row = await t.prisma.media.findUniqueOrThrow({ where: { id } });
    for (let i = 0; i < 60 && row.status !== 'READY' && row.status !== 'FAILED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await t.prisma.media.findUniqueOrThrow({ where: { id } });
    }
    assert.equal(String(row.status), 'READY');
    const storage = t.app.get<StorageDriver>(STORAGE);
    const original = storage.localPath(row.originalKey)!;
    const processed = storage.localPath(row.storageKey!)!;
    assert.ok(existsSync(original) && existsSync(processed));

    const svc = t.app.get(MediaService);
    assert.equal(await svc.pruneOriginals(), 0, 'not yet: only a month after');
    // A failed upload keeps its original whatever its age: a retry needs it.
    const failed = await t.prisma.media.create({
      data: { originalName: 'bad.mp4', displayName: 'Bad', type: 'VIDEO', status: 'FAILED', originalKey: 'originals/failed-keep.mp4', originalSha256: 'sha-failed-keep', originalSizeBytes: 1n, originalMimeType: 'video/mp4', createdAt: new Date(Date.now() - 90 * 86_400_000) },
    });

    const later = new Date(Date.now() + (ORIGINAL_KEEP_DAYS + 1) * 86_400_000);
    assert.equal(await svc.pruneOriginals(later), 1);
    assert.ok(!existsSync(original), 'original deleted');
    assert.ok(existsSync(processed), 'the file the TVs download stays');
    assert.ok((await t.prisma.media.findUniqueOrThrow({ where: { id } })).originalDeletedAt);
    assert.equal((await t.prisma.media.findUniqueOrThrow({ where: { id: failed.id } })).originalDeletedAt, null);
    assert.equal(await svc.pruneOriginals(later), 0, 'done once');

    const again = await upload('retention-again.jpg', data, 'image/jpeg');
    assert.equal(again.body.duplicates.length, 1, 'the checksum still spots a re-upload');
  });
});
