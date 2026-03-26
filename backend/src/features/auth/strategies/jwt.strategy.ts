import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
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

    // Retornamos el usuario inyectando el array plano de allowedContracts
    return {
      ...user,
      allowedContracts: user.contractAccess.map((access) => access.contractId),
    };
  }
}
