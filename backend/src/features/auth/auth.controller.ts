import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { extractLoginMeta } from './auth-request.util';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserSessionService } from './user-session.service';

@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
    private readonly userSessions: UserSessionService,
  ) {}

  /** CAPTCHA ligero (suma) generado en servidor; sin proveedores externos. */
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Get('captcha')
  captcha() {
    return this.captchaService.create();
  }

  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('login')
  login(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.authService.login(
      {
        tenantCode: body.tenantCode as string | undefined,
        email: body.email as string | undefined,
        password: body.password as string | undefined,
        challengeId: body.challengeId as string | undefined,
        challengeAnswer: body.challengeAnswer as string | number | undefined,
        honeypot: body.honeypot as string | undefined,
      },
      extractLoginMeta(req),
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('activate')
  activate(@Body() body: any, @Req() req: Request) {
    return this.authService.activateAccount(
      body.token,
      body.password,
      extractLoginMeta(req),
    );
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
  resetPassword(@Body() body: any, @Req() req: Request) {
    return this.authService.resetPassword(
      body.token,
      body.password,
      extractLoginMeta(req),
    );
  }

  /** Auditoría de cierre de sesión (llamar con JWT antes de limpiar el cliente). */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('audit/logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logoutAudit(@Req() req: any) {
    return this.authService.recordLogoutAudit(
      { id: req.user.id, email: req.user.email, jti: req.user.jti },
      extractLoginMeta(req),
    );
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  listSessions(@Req() req: any) {
    return this.userSessions.listActiveSessions(req.user.id, req.user.jti);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async revokeSession(@Param('id') id: string, @Req() req: any) {
    await this.userSessions.revokeSession(req.user.id, id);
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('sessions/revoke-others')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  revokeOtherSessions(@Req() req: any) {
    return this.userSessions.revokeOthers(req.user.id, req.user.jti);
  }
}
