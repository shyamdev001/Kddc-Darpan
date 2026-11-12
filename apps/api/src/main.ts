import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  // Bind to 0.0.0.0 so the TV on the LAN / hotspot can reach this laptop.
  const host = process.env.API_HOST ?? '0.0.0.0';
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, host);
  Logger.log(`KDCC Darpan API listening on http://${host}:${port}/api`, 'Bootstrap');
}

bootstrap();
