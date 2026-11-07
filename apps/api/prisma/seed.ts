// Seeds the first SUPER_ADMIN and a head-office branch for testing.
// Run with: npm run db:seed   (reads SEED_ADMIN_* from the root .env)
import { config } from 'dotenv';
import { resolve } from 'path';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? 'Head Office Admin';

  if (!email || !password || password === 'change-me-strong-password' || password.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and a real SEED_ADMIN_PASSWORD (12+ chars) in .env first.');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const admin = await prisma.user.upsert({
    where: { email },
    update: {}, // never overwrite an existing admin's password on re-seed
    create: { email, name, passwordHash, role: 'SUPER_ADMIN' },
  });
  console.log(`SUPER_ADMIN ready: ${admin.email}`);

  // Minimal hierarchy so the first TV can be paired to head office.
  const region = await prisma.region.upsert({
    where: { name: 'Head Office' },
    update: {},
    create: { name: 'Head Office' },
  });
  const taluka = await prisma.taluka.upsert({
    where: { regionId_name: { regionId: region.id, name: 'Nadiad' } },
    update: {},
    create: { name: 'Nadiad', regionId: region.id },
  });
  const branch = await prisma.branch.upsert({
    where: { code: 'HO' },
    update: {},
    create: { code: 'HO', name: 'Head Office', talukaId: taluka.id },
  });
  console.log(`Branch ready: ${branch.name} (${branch.code})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
