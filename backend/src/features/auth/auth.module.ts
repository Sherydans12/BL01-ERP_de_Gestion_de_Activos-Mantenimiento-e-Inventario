import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../../prisma/prisma.module';
import { CaptchaService } from './captcha.service';
import { AuthAuditModule } from './auth-audit.module';
import { UserSessionModule } from './user-session.module';
import { LoginStepUpService } from './login-step-up.service';
import { StepUpPolicyService } from './step-up-policy.service';
import { TotpService } from './totp.service';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [
    PrismaModule,
    AuthAuditModule,
    UserSessionModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    CaptchaService,
    LoginStepUpService,
    StepUpPolicyService,
    TotpService,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    AuthAuditModule,
    StepUpPolicyService,
    TotpService,
    PermissionsGuard,
  ],
})
export class AuthModule {}
