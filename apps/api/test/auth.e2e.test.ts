// Sign-in, sessions, roles and what each person may see, through the real HTTP API.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { codeAt, currentStep, encryptSecret, newSecret } from '../src/auth/totp';
import { call, createPlaces, createUser, login, pairedTv, resetDb, startApp, type TestApp } from './helpers';

let t: TestApp;
let places: Awaited<ReturnType<typeof createPlaces>>;

before(async () => {
  t = await startApp();
  await resetDb(t.prisma);
  places = await createPlaces(t.prisma);
});
after(async () => {
  process.env.REQUIRE_2FA = 'off';
  await t.close();
});

describe('signing in', () => {
  it('refuses a wrong password and an unknown email the same way', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const wrong = await call(t.base, 'POST', '/auth/login', { body: { email: u.email, password: 'not-the-password' } });
    const unknown = await call(t.base, 'POST', '/auth/login', { body: { email: 'nobody@test.local', password: 'whatever' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
    assert.equal(wrong.cookies.darpan_session, undefined);
  });

  it('signs in with the right password and remembers who you are', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const cookie = await login(t.base, u);
    const me = await call(t.base, 'GET', '/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, u.email);
    assert.equal(me.body.user.passwordHash, undefined);
  });

  it('sends the session in an httpOnly cookie', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const res = await fetch(t.base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: u.password }),
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('darpan_session='));
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax|SameSite=Strict/i);
  });

  it('refuses pages without a session or with a made-up one', async () => {
    assert.equal((await call(t.base, 'GET', '/screens')).status, 401);
    const forged = 'darpan_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bm90LXNpZ25lZA';
    assert.equal((await call(t.base, 'GET', '/screens', { cookie: forged })).status, 401);
  });

  it('refuses a disabled account, even with a session from before', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const cookie = await login(t.base, u);
    await t.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie })).status, 401);
    assert.equal((await call(t.base, 'POST', '/auth/login', { body: { email: u.email, password: u.password } })).status, 401);
  });

  it('signs out older sessions when the password changes', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const cookie = await login(t.base, u);
    await t.prisma.user.update({ where: { id: u.id }, data: { passwordChangedAt: new Date(Date.now() + 1000) } });
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie })).status, 401);
  });

  it('a session copied before "Sign out" stops working after it', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const cookie = await login(t.base, u);
    const copied = cookie; // e.g. taken from a shared head-office PC
    assert.equal((await call(t.base, 'POST', '/auth/logout', { cookie })).status, 200);
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: copied })).status, 401);
    // Signing in again gives a new, working session.
    const fresh = await login(t.base, u);
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: fresh })).status, 200);
  });

  it('"Sign out" ends only that session; "Sign out everywhere" ends all of them', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const pcA = await login(t.base, u);
    const pcB = await login(t.base, u);
    const pcC = await login(t.base, u);
    await call(t.base, 'POST', '/auth/logout', { cookie: pcA });
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: pcB })).status, 200, 'other computers stay signed in');
    const all = await call(t.base, 'POST', '/auth/logout-everywhere', { cookie: pcB });
    assert.equal(all.status, 200);
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: pcB })).status, 401);
    assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: pcC })).status, 401);
    assert.equal(await t.prisma.auditLog.count({ where: { userId: u.id, action: 'auth.logout_everywhere' } }), 1);
  });

  it('writes sign-ins to the activity log', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    await login(t.base, u);
    const rows = await t.prisma.auditLog.count({ where: { userId: u.id } });
    assert.ok(rows >= 1);
  });
});

describe('roles', () => {
  it('lets only the super admin manage users', async () => {
    const sa = await login(t.base, await createUser(t.prisma, 'SUPER_ADMIN'));
    const ho = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
    assert.equal((await call(t.base, 'GET', '/users', { cookie: sa })).status, 200);
    assert.equal((await call(t.base, 'GET', '/users', { cookie: ho })).status, 403);
  });

  it('keeps branch viewers and region managers from changing screens or broadcasting', async () => {
    for (const role of ['BRANCH_VIEWER', 'REGION_MANAGER'] as const) {
      const cookie = await login(t.base, await createUser(t.prisma, role, { branchId: places.matarBranch.id, regionId: places.south.id }));
      const claim = await call(t.base, 'POST', '/screens/claim', { cookie, body: { pairingCode: '123456', name: 'X', branchId: places.matarBranch.id } });
      assert.equal(claim.status, 403, `${role} claim`);
      const cast = await call(t.base, 'POST', '/broadcasts', { cookie, body: { kind: 'MESSAGE', level: 'ALL', message: 'hi' } });
      assert.equal(cast.status, 403, `${role} broadcast`);
    }
  });
});

describe('what each person sees', () => {
  let names: (cookie: string) => Promise<string[]>;

  before(async () => {
    const admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
    await pairedTv(t.base, admin, places.nadiadMain.id, 'Nadiad Main TV');
    await pairedTv(t.base, admin, places.nadiadStation.id, 'Nadiad Station TV');
    await pairedTv(t.base, admin, places.matarBranch.id, 'Matar TV');
    names = async (cookie) => {
      const res = await call(t.base, 'GET', '/screens', { cookie });
      assert.equal(res.status, 200);
      return (res.body.items as { name: string }[]).map((s) => s.name).sort();
    };
  });

  it('shows head office every screen', async () => {
    const cookie = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
    assert.deepEqual(await names(cookie), ['Matar TV', 'Nadiad Main TV', 'Nadiad Station TV']);
  });

  it('shows a region manager only their region', async () => {
    const cookie = await login(t.base, await createUser(t.prisma, 'REGION_MANAGER', { regionId: places.north.id }));
    assert.deepEqual(await names(cookie), ['Nadiad Main TV', 'Nadiad Station TV']);
  });

  it('shows a branch viewer only their branch', async () => {
    const cookie = await login(t.base, await createUser(t.prisma, 'BRANCH_VIEWER', { branchId: places.matarBranch.id }));
    assert.deepEqual(await names(cookie), ['Matar TV']);
  });

  it('shows nothing to a manager with no region set (never everything)', async () => {
    const cookie = await login(t.base, await createUser(t.prisma, 'REGION_MANAGER'));
    assert.deepEqual(await names(cookie), []);
  });
});

describe('per-account sign-in limit', () => {
  const tryPassword = (email: string, password: string) => call(t.base, 'POST', '/auth/login', { body: { email, password } });

  it('after 5 wrong passwords (from any address) the account pauses, even for the right password', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    for (let i = 0; i < 5; i++) assert.equal((await tryPassword(u.email, `wrong-${i}`)).status, 401);
    const sixth = await tryPassword(u.email, 'wrong-6');
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.code, 'ACCOUNT_LOCKED');
    assert.match(sixth.body.message, /try again in 15 minutes/i);
    const right = await tryPassword(u.email, u.password);
    assert.equal(right.status, 429, 'the right password does not get through while paused');
    assert.equal(right.cookies.darpan_session, undefined);
    assert.equal(await t.prisma.auditLog.count({ where: { userId: u.id, action: 'auth.locked' } }), 1);

    // The pause ends by itself.
    await t.prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await tryPassword(u.email, u.password)).status, 200);
  });

  it('a successful sign-in resets the count, so occasional typos never pause anyone', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) assert.equal((await tryPassword(u.email, 'typo')).status, 401);
      assert.equal((await tryPassword(u.email, u.password)).status, 200);
    }
  });

  it('an administrator resetting the password lifts the pause', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const admin = await login(t.base, await createUser(t.prisma, 'SUPER_ADMIN'));
    for (let i = 0; i < 5; i++) await tryPassword(u.email, 'wrong');
    assert.equal((await tryPassword(u.email, u.password)).status, 429);
    const newPassword = 'a-brand-new-password-42';
    const reset = await call(t.base, 'PUT', `/users/${u.id}/password`, { cookie: admin, body: { password: newPassword } });
    assert.ok(reset.status === 200 || reset.status === 201, JSON.stringify(reset.body));
    assert.equal((await tryPassword(u.email, newPassword)).status, 200);
  });

  it('5 wrong 2FA codes end the sign-in and pause the account; the password does not buy more guesses', async () => {
    const u = await createUser(t.prisma, 'HO_ADMIN');
    const secret = newSecret();
    await t.prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true, totpSecret: encryptSecret(secret) } });
    const challenge = async () => {
      const res = await tryPassword(u.email, u.password);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.needsCode, true);
      return `darpan_2fa=${res.cookies.darpan_2fa}`;
    };
    const wrongCode = String((Number(codeAt(secret, currentStep())) + 500_000) % 1_000_000).padStart(6, '0');
    const guess = (cookie: string, code: string) => call(t.base, 'POST', '/auth/login/code', { cookie, body: { code } });

    // 3 wrong codes, then the password again for a fresh challenge, then 2 more: that is 5.
    let c = await challenge();
    for (let i = 0; i < 3; i++) assert.equal((await guess(c, wrongCode)).status, 401);
    c = await challenge();
    assert.equal((await guess(c, wrongCode)).status, 401);
    const fifth = await guess(c, wrongCode);
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.code, 'ACCOUNT_LOCKED');
    // The challenge is void now, even with the right code.
    const right = await guess(c, codeAt(secret, currentStep()));
    assert.equal(right.status, 429);
    assert.equal(right.cookies.darpan_session, undefined);
    assert.equal((await tryPassword(u.email, u.password)).status, 429);
  });
});

describe('required two-step sign-in', () => {
  it('stops admins without it at the door but lets them set it up', async () => {
    const admin = await login(t.base, await createUser(t.prisma, 'HO_ADMIN'));
    const viewer = await login(t.base, await createUser(t.prisma, 'BRANCH_VIEWER', { branchId: places.matarBranch.id }));
    process.env.REQUIRE_2FA = 'admins';
    try {
      const blocked = await call(t.base, 'GET', '/screens', { cookie: admin });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, '2FA_REQUIRED');
      assert.equal((await call(t.base, 'GET', '/auth/me', { cookie: admin })).status, 200);
      assert.equal((await call(t.base, 'POST', '/auth/2fa/setup', { cookie: admin })).status, 200);
      assert.equal((await call(t.base, 'GET', '/screens', { cookie: viewer })).status, 200);
    } finally {
      process.env.REQUIRE_2FA = 'off';
    }
  });
});
