import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { trustProxySetting } from './throttle';

/** Everything the running API needs besides its modules. Shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');

  // The dashboard proxies /api/* through Next.js (and Caddy in production): trust those proxies,
  // and only those, to report the real client address. See trustProxySetting.
  app.set('trust proxy', trustProxySetting());
  app.use(cookieParser());
  // Room for a bulk branch import (up to 1000 rows); the default is 100 kB.
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
}
