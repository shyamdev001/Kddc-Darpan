// Sign-in, sessions, roles and what each person may see, through the real HTTP API.
import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
