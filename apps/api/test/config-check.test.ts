// Production settings are checked before the API starts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionConfig, checkProductionConfig } from '../src/config-check';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://darpan:x@db:5432/darpan_prod',
  PUBLIC_BASE_URL: 'https://signage.example.com',
  WEB_ORIGIN: 'https://signage.example.com',
  JWT_SECRET: 'a'.repeat(48),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: '/data/media',
  REQUIRE_2FA: 'admins',
  TRUST_PROXY: '172.28.0.0/16',
  MAIL_DRIVER: 'smtp',
};

describe('production settings check', () => {
  it('passes a complete production set, with no warnings', () => {
    const r = checkProductionConfig(good);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
  });

  for (const [name, value, hint] of [
    ['PUBLIC_BASE_URL', undefined, 'PUBLIC_BASE_URL is not set'],
    ['PUBLIC_BASE_URL', 'http://signage.example.com', 'https://'],
    ['PUBLIC_BASE_URL', 'not a url', 'not a web address'],
    ['WEB_ORIGIN', undefined, 'WEB_ORIGIN is not set'],
    ['JWT_SECRET', 'change-me', 'JWT_SECRET'],
    ['JWT_SECRET', 'short', 'JWT_SECRET'],
    ['TOTP_ENCRYPTION_KEY', undefined, 'TOTP_ENCRYPTION_KEY'],
    ['TOTP_ENCRYPTION_KEY', 'dG9vLXNob3J0', 'TOTP_ENCRYPTION_KEY'],
    ['DATABASE_URL', undefined, 'DATABASE_URL'],
    ['STORAGE_LOCAL_DIR', undefined, 'STORAGE_LOCAL_DIR'],
  ] as const) {
    it(`refuses ${name}=${value ?? '(missing)'}`, () => {
      const env = { ...good, [name]: value };
      const r = checkProductionConfig(env);
      assert.equal(r.problems.length, 1, r.problems.join('; '));
      assert.ok(r.problems[0].includes(hint), r.problems[0]);
      assert.throws(() => assertProductionConfig(env, () => {}), (e: Error) => e.message.includes(hint));
    });
  }

  it('lists every problem at once, so one restart fixes them all', () => {
    const r = checkProductionConfig({ NODE_ENV: 'production' });
    assert.ok(r.problems.length >= 5);
  });

  it('warns about weak but workable choices', () => {
    const r = checkProductionConfig({ ...good, REQUIRE_2FA: 'off', TRUST_PROXY: undefined, MAIL_DRIVER: 'console' });
    assert.deepEqual(r.problems, []);
    assert.equal(r.warnings.length, 3);
  });

  it('logs the settings without any secret', () => {
    const lines: string[] = [];
    assertProductionConfig(good, (l) => lines.push(l));
    const all = lines.join('\n');
    assert.ok(all.includes('https://signage.example.com'));
    assert.ok(!all.includes(good.JWT_SECRET) && !all.includes(good.TOTP_ENCRYPTION_KEY) && !all.includes(good.DATABASE_URL));
  });

  it('does nothing outside production', () => {
    assert.equal(assertProductionConfig({ NODE_ENV: 'development' }), null);
  });
});
