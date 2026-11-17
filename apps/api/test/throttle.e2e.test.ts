// Rate limits behind the production proxy: each person and each TV gets its own allowance.
import './env';
process.env.THROTTLE_IN_TESTS = '1'; // the limits are switched off in every other test file
process.env.TRUST_PROXY = 'loopback'; // the test client plays the proxy, as Caddy does in production
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newDeviceToken } from '../src/screens/device-auth';
import { trustProxySetting } from '../src/throttle';
import { createPlaces, createUser, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
});
after(() => t.close());

const from = (ip: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string>), 'x-forwarded-for': ip } });

async function badLogin(ip: string, email: string) {
  const res = await fetch(`${t.base}/auth/login`, from(ip, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrong-password-123' }),
  }));
  return res.status;
}

describe('trusted proxy setting', () => {
  it('reads hop counts and address ranges, and refuses "trust everyone"', () => {
    assert.equal(trustProxySetting(undefined), 'loopback');
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting(' loopback , 172.16.0.0/12 '), 'loopback,172.16.0.0/12');
    assert.throws(() => trustProxySetting('true'));
  });
});

describe('rate limits behind the proxy', () => {
  it('counts each person separately: one person guessing passwords does not lock out others', async () => {
    const user = await createUser(t.prisma, 'HO_ADMIN');
    for (let i = 0; i < 5; i++) assert.equal(await badLogin('203.0.113.10', user.email), 401);
    assert.equal(await badLogin('203.0.113.10', user.email), 429, 'the guesser is slowed down');
    assert.equal(await badLogin('203.0.113.20', user.email), 401, 'someone else can still try to sign in');
  });

  it('counts each TV separately: 101 TVs behind one branch address all get their manifest', async () => {
    const places = await createPlaces(t.prisma);
    const tokens: string[] = [];
    for (let i = 0; i < 101; i++) {
      const { token, hash } = newDeviceToken();
      await t.prisma.screen.create({
        data: { hardwareId: `hw-${i}-${hash.slice(0, 8)}`, deviceTokenHash: hash, status: 'ONLINE', name: `TV ${i}`, branchId: places.matarBranch.id, pairedAt: new Date() },
      });
      tokens.push(token);
    }
    // Four fetches each (a playlist change plus retries) = 404 requests from one address in seconds.
    const statuses: number[] = [];
    for (let round = 0; round < 4; round++) {
      const batch = await Promise.all(
        tokens.map((tok) => fetch(`${t.base}/devices/manifest`, from('198.51.100.7', { headers: { authorization: `Bearer ${tok}` } })).then((r) => r.status)),
      );
      statuses.push(...batch);
    }
    assert.equal(statuses.filter((s) => s === 429).length, 0, 'no TV is refused');
    assert.ok(statuses.every((s) => s === 200));
  });
});
