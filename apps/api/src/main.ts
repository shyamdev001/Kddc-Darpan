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
  try {
    await app.listen(port, host);
  } catch (err) {
    // Another program on this port means the dashboard silently talks to *that* program:
    // every page and upload fails with "not found". Say so plainly.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      Logger.error(
        `Port ${port} is already used by another program, so the KDCC Darpan API cannot start. ` +
          `Close that program (or give it another port) and start the API again. The TVs expect port ${port}.`,
        undefined,
        'Bootstrap',
      );
      process.exit(1);
    }
    throw err;
  }
  Logger.log(`KDCC Darpan API listening on http://${host}:${port}/api`, 'Bootstrap');
}

bootstrap();
