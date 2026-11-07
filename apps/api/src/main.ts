import './load-env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
  app.enableShutdownHooks();

  // Bind to 0.0.0.0 so the TV on the LAN / hotspot can reach this laptop.
  const host = process.env.API_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, host);
  Logger.log(`KDCC Darpan API listening on http://${host}:${port}/api`, 'Bootstrap');
}

bootstrap();
