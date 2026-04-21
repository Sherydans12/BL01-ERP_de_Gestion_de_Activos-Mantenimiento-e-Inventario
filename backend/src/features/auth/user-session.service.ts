import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const TOUCH_THROTTLE_MS = 60_000;
const lastTouch = new Map<string, number>();

@Injectable()
export class UserSessionService {
  constructor(private readonly prisma: PrismaService) {}

  private touchKey(userId: string, jti: string): string {
    return `${userId}:${jti}`;
  }

  async create(params: {
    userId: string;
    jti: string;
    deviceLabel: string;
    ipAddress: string;
  }) {
    return this.prisma.userSession.create({
      data: {
        userId: params.userId,
        jti: params.jti.slice(0, 64),
        deviceLabel: params.deviceLabel.slice(0, 200),
        ipAddress: params.ipAddress.slice(0, 64),
        isValid: true,
      },
    });
  }

  /** Valida que exista sesión activa para el jti. */
  async assertSessionValid(userId: string, jti: string | undefined): Promise<void> {
    if (!jti) return;
    const row = await this.prisma.userSession.findFirst({
      where: { userId, jti, isValid: true },
    });
    if (!row) {
      throw new UnauthorizedException('Sesión revocada o inválida.');
    }
  }

  async touchLastActive(userId: string, jti: string | undefined): Promise<void> {
    if (!jti) return;
    const key = this.touchKey(userId, jti);
    const now = Date.now();
    const prev = lastTouch.get(key) ?? 0;
    if (now - prev < TOUCH_THROTTLE_MS) return;
    lastTouch.set(key, now);
    await this.prisma.userSession.updateMany({
      where: { userId, jti, isValid: true },
      data: { lastActiveAt: new Date() },
    });
  }

  async listActiveSessions(userId: string, currentJti?: string) {
    const rows = await this.prisma.userSession.findMany({
      where: { userId, isValid: true },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        jti: true,
        deviceLabel: true,
        ipAddress: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      isCurrent: !!currentJti && r.jti === currentJti,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const row = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!row) throw new NotFoundException('Sesión no encontrada');
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { isValid: false },
    });
  }

  async revokeOthers(userId: string, keepJti: string | undefined): Promise<{ revoked: number }> {
    if (!keepJti) {
      const r = await this.prisma.userSession.updateMany({
        where: { userId, isValid: true },
        data: { isValid: false },
      });
      return { revoked: r.count };
    }
    const r = await this.prisma.userSession.updateMany({
      where: { userId, isValid: true, jti: { not: keepJti } },
      data: { isValid: false },
    });
    return { revoked: r.count };
  }

  async revokeByJti(userId: string, jti: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, jti, isValid: true },
      data: { isValid: false },
    });
  }

  async invalidateAllForUser(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, isValid: true },
      data: { isValid: false },
    });
  }
}
