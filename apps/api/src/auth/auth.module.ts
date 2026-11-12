import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { jwtSecret, sessionTtlHours } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: { expiresIn: `${sessionTtlHours()}h`, issuer: 'kdcc-darpan' },
        verifyOptions: { issuer: 'kdcc-darpan' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TwoFactorService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TwoFactorService],
})
export class AuthModule {}
