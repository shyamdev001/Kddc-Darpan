// Uploading posters through the real API: Gujarati names, duplicates, wrong file types, processing.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
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
