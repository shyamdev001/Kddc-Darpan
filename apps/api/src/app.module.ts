import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/content-events';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { PlacesModule } from './places/places.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { PrismaModule } from './prisma/prisma.module';
import { SchedulesModule } from './schedules/schedules.module';
import { ScreensModule } from './screens/screens.module';
import { StatsController } from './stats/stats.controller';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    // Generous global limit; sensitive routes (login) set a tighter @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    EventsModule,
    AuditModule,
    AuthModule,
    StorageModule,
    MediaModule,
    PlaylistsModule,
    ScreensModule,
    PlacesModule,
    SchedulesModule,
  ],
  controllers: [HealthController, StatsController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
