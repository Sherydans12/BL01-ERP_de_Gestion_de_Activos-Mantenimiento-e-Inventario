import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
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
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { contractAccess: true }, // Extraemos los accesos del usuario
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

    // Retornamos el usuario inyectando el array plano de allowedContracts
    return {
      ...user,
      allowedContracts: user.contractAccess.map((access) => access.contractId),
      jti,
    };
  }
}
