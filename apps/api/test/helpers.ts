// Boots the real API on a random port against the test database, plus small builders for test data.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { UserRole } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  base: string;
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, prisma: app.get(PrismaService), base: `http://127.0.0.1:${port}/api`, close: () => app.close() };
}

/** Empties every table (not the migration history). Each test file starts from nothing. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!rows.length) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"public"."${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

// ---- HTTP ----

export interface Res<T = any> {
  status: number;
  body: T;
  cookies: Record<string, string>;
}

export async function call<T = any>(
  base: string,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; token?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  const cookies: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { status: res.status, body: body as T, cookies };
}

// ---- People ----

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createUser(
  prisma: PrismaService,
  role: UserRole,
  scope: { regionId?: string; branchId?: string; isActive?: boolean } = {},
): Promise<TestUser> {
  const password = randomBytes(12).toString('base64url');
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`;
  const u = await prisma.user.create({
    data: {
      email,
      name: `Test ${role}`,
      role,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      regionId: scope.regionId ?? null,
      branchId: scope.branchId ?? null,
      isActive: scope.isActive ?? true,
    },
  });
  return { id: u.id, email, password };
}

/** Signs in and returns the Cookie header value to send with later requests. */
export async function login(base: string, user: TestUser): Promise<string> {
  const res = await call(base, 'POST', '/auth/login', { body: { email: user.email, password: user.password } });
  if (res.status !== 200 || !res.cookies.darpan_session) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return `darpan_session=${res.cookies.darpan_session}`;
}

// ---- Places ----

/**
 * Two regions:  North → Nadiad taluka → Nadiad Main, Nadiad Station
 *               South → Matar taluka  → Matar
 */
export async function createPlaces(prisma: PrismaService) {
  const north = await prisma.region.create({ data: { name: 'North' } });
  const south = await prisma.region.create({ data: { name: 'South' } });
  const nadiad = await prisma.taluka.create({ data: { name: 'Nadiad', regionId: north.id } });
  const matar = await prisma.taluka.create({ data: { name: 'Matar', regionId: south.id } });
  const nadiadMain = await prisma.branch.create({ data: { name: 'Nadiad Main', talukaId: nadiad.id } });
  const nadiadStation = await prisma.branch.create({ data: { name: 'Nadiad Station', talukaId: nadiad.id } });
  const matarBranch = await prisma.branch.create({ data: { name: 'Matar', talukaId: matar.id } });
  return { north, south, nadiad, matar, nadiadMain, nadiadStation, matarBranch };
}

// ---- Content ----

export async function createMedia(
  prisma: PrismaService,
  name: string,
  opts: { status?: 'READY' | 'PROCESSING'; startDate?: Date; endDate?: Date; type?: 'IMAGE' | 'VIDEO'; durationSec?: number } = {},
) {
  const key = randomUUID();
  const ready = (opts.status ?? 'READY') === 'READY';
  return prisma.media.create({
    data: {
      originalName: `${name}.jpg`,
      displayName: name,
      type: opts.type ?? 'IMAGE',
      status: opts.status ?? 'READY',
      originalKey: `originals/${key}`,
      originalSha256: randomBytes(32).toString('hex'),
      originalSizeBytes: 1000n,
      originalMimeType: 'image/jpeg',
      storageKey: ready ? `media/${key}.jpg` : null,
      mimeType: ready ? 'image/jpeg' : null,
      sizeBytes: ready ? 900n : null,
      sha256: ready ? randomBytes(32).toString('hex') : null,
      durationSec: opts.durationSec ?? null,
      startDate: opts.startDate ?? null,
      endDate: opts.endDate ?? null,
    },
  });
}

export async function createPlaylist(prisma: PrismaService, name: string, mediaIds: string[], defaultImageSec = 10) {
  return prisma.playlist.create({
    data: { name, defaultImageSec, items: { create: mediaIds.map((mediaId, position) => ({ mediaId, position })) } },
  });
}

type Level = 'SCREEN' | 'BRANCH' | 'TALUKA' | 'REGION' | 'ALL';
const COLUMN: Record<Exclude<Level, 'ALL'>, 'screenId' | 'branchId' | 'talukaId' | 'regionId'> = {
  SCREEN: 'screenId',
  BRANCH: 'branchId',
  TALUKA: 'talukaId',
  REGION: 'regionId',
};

/** Playlist on a level, optionally only in some time slots. */
export async function assign(
  prisma: PrismaService,
  playlistId: string,
  level: Level,
  targetId?: string,
  slots: { days?: number[]; start?: string; end?: string; from?: string; to?: string }[] = [],
) {
  return prisma.assignment.create({
    data: {
      playlistId,
      targetType: level,
      ...(level === 'ALL' ? {} : { [COLUMN[level]]: targetId }),
      schedules: {
        create: slots.map((s) => ({
          daysOfWeek: s.days ?? [],
          startTime: s.start ?? null,
          endTime: s.end ?? null,
          startDate: s.from ? new Date(`${s.from}T00:00:00Z`) : null,
          endDate: s.to ? new Date(`${s.to}T00:00:00Z`) : null,
        })),
      },
    },
  });
}

// ---- TVs ----

export interface TestTv {
  deviceId: string;
  deviceToken: string;
  pairingCode: string;
}

export async function registerTv(base: string): Promise<TestTv> {
  const res = await call<TestTv>(base, 'POST', '/devices/register', {
    body: { hardwareId: `hw-${randomUUID()}`, model: 'Test TV', osVersion: '11', resolution: '1920x1080', appVersion: '0.1.0' },
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Registers a TV and pairs it to a branch, the way the dashboard does. */
export async function pairedTv(base: string, adminCookie: string, branchId: string, name = 'Test screen'): Promise<TestTv> {
  const tv = await registerTv(base);
  const res = await call(base, 'POST', '/screens/claim', { cookie: adminCookie, body: { pairingCode: tv.pairingCode, name, branchId } });
  if (res.status !== 201) throw new Error(`claim failed: ${res.status} ${JSON.stringify(res.body)}`);
  return tv;
}
