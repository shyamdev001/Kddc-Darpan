// Imported first by every test file. Points the API at a separate test database so tests can empty
// tables freely, and fills in throwaway secrets so the tests also run where there is no .env (CI).
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// apps/api/dist-test/test -> repo root
config({ path: resolve(__dirname, '../../../../.env'), quiet: true });

/** TEST_DATABASE_URL, or DATABASE_URL with the database renamed to darpan_test. */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to run the tests.');
  const url = new URL(base);
  if (!explicit) url.pathname = '/darpan_test';
  const name = url.pathname.replace(/^\//, '');
  // The tests delete everything in the tables. Never let them near a real database.
  if (!name.endsWith('_test')) throw new Error(`Refusing to run tests against database "${name}": its name must end in _test.`);
  return url.toString();
}

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://tv.test';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.MAIL_DRIVER = 'console';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = join(tmpdir(), 'darpan-test-media');
process.env.REQUIRE_2FA = 'off';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = randomBytes(48).toString('base64url');
if (!process.env.TOTP_ENCRYPTION_KEY) process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
mkdirSync(process.env.STORAGE_LOCAL_DIR, { recursive: true });
