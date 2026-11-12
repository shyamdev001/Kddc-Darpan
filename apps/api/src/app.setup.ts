import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Everything the running API needs besides its modules. Shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');

  // The dashboard proxies /api/* through Next.js (and Caddy in production),
  // so trust the loopback proxy to report the real client IP.
  app.set('trust proxy', 'loopback');
  app.use(cookieParser());
  // Room for a bulk branch import (up to 1000 rows); the default is 100 kB.
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
}
