// Creates the test database if it is missing and brings it up to the latest migration.
import { testDatabaseUrl } from './env';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';

async function main() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.replace(/^\//, '');
  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) {
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
    console.log(`Created database ${name}`);
  }
  await client.end();

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../..'), // apps/api
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  console.log(`Test database ${name} is ready`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
