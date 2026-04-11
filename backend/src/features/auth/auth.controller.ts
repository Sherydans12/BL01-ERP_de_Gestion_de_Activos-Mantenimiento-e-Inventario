import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';

@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  /** CAPTCHA ligero (suma) generado en servidor; sin proveedores externos. */
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Get('captcha')
  captcha() {
    return this.captchaService.create();
  }

  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('login')
  login(@Body() body: Record<string, unknown>) {
    return this.authService.login({
      tenantCode: body.tenantCode as string | undefined,
      email: body.email as string | undefined,
      password: body.password as string | undefined,
      challengeId: body.challengeId as string | undefined,
      challengeAnswer: body.challengeAnswer as string | number | undefined,
      honeypot: body.honeypot as string | undefined,
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('activate')
  activate(@Body() body: any) {
    return this.authService.activateAccount(body.token, body.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() body: Record<string, unknown>) {
    return this.authService.forgotPassword({
      email: body.email as string | undefined,
      challengeId: body.challengeId as string | undefined,
      challengeAnswer: body.challengeAnswer as string | number | undefined,
      honeypot: body.honeypot as string | undefined,
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() body: any) {
    return this.authService.resetPassword(body.token, body.password);
  }
}
