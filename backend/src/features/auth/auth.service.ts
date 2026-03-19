import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(tenantCode: string, email: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 1. Validación de Tenant (Aislamiento)
    if (
      user.role !== ('SUPER_ADMIN' as any) &&
      tenantCode &&
      user.tenant?.code !== tenantCode.toUpperCase()
    ) {
      throw new UnauthorizedException(
        'La empresa especificada no coincide con su usuario.',
      );
    }

    // 2. Validación de Estado (Diferenciando flujo de invitación vs suspensión)
    if (!user.isActive) {
      // Si tiene token de activación, es que nunca ha entrado
      if (user.activationToken) {
        throw new UnauthorizedException(
          'Cuenta pendiente de activación. Revisa tu correo de invitación.',
        );
      }
      // Si no tiene token pero está inactivo, es una suspensión manual (vacaciones/bloqueo)
      throw new UnauthorizedException(
        'Tu cuenta ha sido desactivada temporalmente. Contacta a tu administrador.',
      );
    }

    // 3. Validación de Password
    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 4. Generación de Payload y Token
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              logoUrl: user.tenant.logoUrl,
            }
          : null,
      },
    };
  }

  async activateAccount(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { activationToken: token },
      include: { tenant: true },
    });

    if (!user) {
      throw new NotFoundException('Token inválido o expirado.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isActive: true,
        activationToken: null,
      },
    });

    const payload = {
      email: updatedUser.email,
      sub: updatedUser.id,
      role: updatedUser.role,
      tenantId: updatedUser.tenantId,
    };
    return {
      message: 'Cuenta activada exitosamente',
      access_token: this.jwtService.sign(payload),
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              logoUrl: user.tenant.logoUrl,
            }
          : null,
      },
    };
  }
}
