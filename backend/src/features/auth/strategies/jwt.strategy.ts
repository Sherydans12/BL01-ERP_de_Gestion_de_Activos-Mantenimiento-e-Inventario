import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserSessionService } from '../user-session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private readonly userSessions: UserSessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'default_secret',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: Record<string, unknown>) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub as string },
      include: { contractAccess: true, tenant: true },
    });

    if (!user || (!user.isActive && payload.context !== 'activation')) {
      throw new UnauthorizedException('Usuario no válido o inactivo.');
    }

    const jti =
      typeof payload.jti === 'string' && payload.jti.length > 0
        ? payload.jti
        : undefined;
    await this.userSessions.assertSessionValid(user.id, jti);
    void this.userSessions.touchLastActive(user.id, jti);

    const rawHeader = req.headers['x-tenant-id'];
    const headerStr = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const headerTenantId =
      typeof headerStr === 'string' ? headerStr.trim() : '';

    let effectiveTenantId = user.tenantId;

    if (user.role === 'SUPER_ADMIN') {
      if (headerTenantId) {
        const exists = await this.prisma.tenant.findUnique({
          where: { id: headerTenantId },
          select: { id: true },
        });
        effectiveTenantId = exists?.id ?? null;
      } else {
        effectiveTenantId = user.tenantId;
      }
    } else {
      effectiveTenantId = user.tenantId;
    }

    let tenant = user.tenant;
    if (
      effectiveTenantId &&
      (effectiveTenantId !== user.tenantId || !tenant)
    ) {
      tenant = await this.prisma.tenant.findUnique({
        where: { id: effectiveTenantId },
      });
    }

    return {
      ...user,
      tenantId: effectiveTenantId,
      tenant,
      allowedContracts: user.contractAccess.map((access) => access.contractId),
      jti,
    };
  }
}
