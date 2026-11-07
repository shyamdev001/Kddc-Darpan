import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { StatsController } from './stats/stats.controller';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    // Generous global limit; sensitive routes (login) set a tighter @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    StorageModule,
    MediaModule,
  ],
  controllers: [HealthController, StatsController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
