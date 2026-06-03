import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { buildMailSuperAdminStepUp } from '../../common/email/transactional-mail.builder';

const STEP_UP_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class LoginStepUpService {
  private readonly log = new Logger(LoginStepUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async createChallengeAndSendEmail(params: {
    userId: string;
    userEmail: string;
    name: string;
    clientIp: string;
    userAgent: string;
  }): Promise<{ stepUpToken: string }> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken, 'utf8')
      .digest('hex');
    const code = String(crypto.randomInt(100_000, 1_000_000));
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS);

    await this.prisma.loginStepUpChallenge.deleteMany({
      where: {
        userId: params.userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    await this.prisma.loginStepUpChallenge.create({
      data: {
        userId: params.userId,
        tokenHash,
        codeHash,
        expiresAt,
        clientIp: params.clientIp.slice(0, 64),
        userAgent: params.userAgent.slice(0, 512),
      },
    });

    try {
      await this.emailService.sendMail({
        to: params.userEmail,
        subject: 'Código de verificación — inicio de sesión TPM (Super Admin)',
        html: buildMailSuperAdminStepUp({
          name: params.name,
          code,
          validMinutes: Math.floor(STEP_UP_TTL_MS / 60_000),
        }),
      });
    } catch (e) {
      this.log.error(`Super Admin step-up email send failed: ${e}`);
      await this.prisma.loginStepUpChallenge.deleteMany({
        where: { userId: params.userId, tokenHash },
      });
      throw e;
    }

    return { stepUpToken: rawToken };
  }

  async verifyAndConsumeToken(
    rawToken: string,
    codeRaw: string,
  ): Promise<{ userId: string }> {
    if (!rawToken || !codeRaw) {
      throw new UnauthorizedException(
        'Código o sesión de verificación inválida.',
      );
    }
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken.trim(), 'utf8')
      .digest('hex');
    const code = String(codeRaw).replace(/\D/g, '').slice(0, 8);
    if (code.length !== 6) {
      throw new UnauthorizedException('Código incorrecto.');
    }

    const row = await this.prisma.loginStepUpChallenge.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      throw new UnauthorizedException(
        'Código o sesión de verificación inválida o expirada.',
      );
    }
    const ok = await bcrypt.compare(code, row.codeHash);
    if (!ok) {
      throw new UnauthorizedException('Código incorrecto.');
    }
    await this.prisma.loginStepUpChallenge.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    return { userId: row.userId };
  }
}
