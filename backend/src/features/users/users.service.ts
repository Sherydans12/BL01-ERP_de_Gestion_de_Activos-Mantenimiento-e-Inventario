import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '@nestjs-modules/mailer';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private mailerService: MailerService,
    private config: ConfigService,
  ) {}

  async create(
    data: {
      email: string;
      name: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'MECHANIC';
      rut?: string;
      phone?: string;
      birthDate?: string | Date;
      position?: string;
      siteIds?: string[];
    },
    tenantId?: string,
  ) {
    if (data.role !== 'SUPER_ADMIN' && !tenantId) {
      throw new BadRequestException(
        'El Tenant ID es obligatorio para este rol.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictException('El correo electrónico ya está registrado.');
    }

    const activationToken = crypto.randomBytes(32).toString('hex');

    try {
      const newUser = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: data.email,
            name: data.name,
            role: data.role as any,
            password: '',
            isActive: false,
            activationToken,
            tenantId: data.role === 'SUPER_ADMIN' ? null : tenantId,
            rut: data.rut,
            phone: data.phone,
            birthDate: data.birthDate ? new Date(data.birthDate) : null,
            position: data.position,
          },
        });

        if (
          data.siteIds &&
          data.siteIds.length > 0 &&
          user.role !== 'SUPER_ADMIN' &&
          user.role !== 'ADMIN'
        ) {
          const siteConnections = data.siteIds.map((siteId: string) => ({
            userId: user.id,
            siteId: siteId,
          }));
          await tx.userSite.createMany({ data: siteConnections });
        }

        return user;
      });

      const frontendUrl =
        this.config.get('FRONTEND_URL') || 'http://localhost:4200';
      const activationLink = `${frontendUrl}/auth/activate?token=${activationToken}`;

      await this.mailerService.sendMail({
        to: data.email,
        subject: 'Invitación a Sistema TPM',
        html: `
          <div style="font-family: sans-serif; color: #333;">
            <h2>Bienvenido al Sistema de Gestión de Activos TPM</h2>
            <p>Hola <strong>${data.name}</strong>,</p>
            <p>Has sido invitado a participar en el sistema con el rol de <strong>${data.role}</strong>.</p>
            <p>Para activar tu cuenta y establecer tu contraseña, haz clic en el siguiente enlace:</p>
            <p style="margin: 30px 0;">
              <a href="${activationLink}" 
                 style="padding: 12px 24px; background-color: #FF3366; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
                Activar Cuenta
              </a>
            </p>
            <p style="font-size: 0.8em; color: #666;">Si el botón no funciona, copia y pega este enlace:<br>${activationLink}</p>
            <br>
            <p>Saludos,<br>Equipo TPM</p>
          </div>
        `,
      });

      return {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        isActive: newUser.isActive,
      };
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async findAll(
    tenantId?: string,
    userRole?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    // Aislamiento Multi-tenant
    if (userRole !== 'SUPER_ADMIN') {
      where.tenantId = tenantId;
    }

    // Ejecutamos conteo y búsqueda en paralelo para optimizar performance
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          tenantId: true,
          rut: true,
          phone: true,
          birthDate: true,
          position: true,
          siteAccess: { select: { siteId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async update(
    id: string,
    data: any,
    requesterTenantId?: string,
    requesterRole?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('Usuario no encontrado');

    if (
      requesterRole !== 'SUPER_ADMIN' &&
      user.tenantId !== requesterTenantId
    ) {
      throw new BadRequestException(
        'No tienes permisos para editar este usuario',
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id },
          data: {
            name: data.name,
            email: data.email,
            role: data.role,
            rut: data.rut,
            phone: data.phone,
            birthDate: data.birthDate ? new Date(data.birthDate) : null,
            position: data.position,
            isActive: data.isActive,
          },
        });

        if (data.siteIds !== undefined) {
          if (data.role === 'ADMIN' || data.role === 'SUPER_ADMIN') {
            await tx.userSite.deleteMany({ where: { userId: updatedUser.id } });
          } else {
            await tx.userSite.deleteMany({ where: { userId: updatedUser.id } });
            if (data.siteIds.length > 0) {
              const siteConnections = data.siteIds.map((siteId: string) => ({
                userId: updatedUser.id,
                siteId: siteId,
              }));
              await tx.userSite.createMany({ data: siteConnections });
            }
          }
        }

        return await tx.user.findUnique({
          where: { id: updatedUser.id },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
            tenantId: true,
            rut: true,
            phone: true,
            birthDate: true,
            position: true,
            siteAccess: { select: { siteId: true } },
          },
        });
      });
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async resendActivation(
    id: string,
    requesterTenantId?: string,
    requesterRole?: string,
  ) {
    // 1. Buscar el usuario
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) throw new BadRequestException('Usuario no encontrado');

    // 2. Seguridad Multi-tenant
    if (
      requesterRole !== 'SUPER_ADMIN' &&
      user.tenantId !== requesterTenantId
    ) {
      throw new BadRequestException('No tienes permisos para esta acción');
    }

    // 3. Validar estado: Si ya está activo, no tiene sentido reenviar
    if (user.isActive) {
      throw new BadRequestException('El usuario ya activó su cuenta');
    }

    // 4. Generar nuevo token y actualizarlo en la DB
    const newToken = crypto.randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id },
      data: { activationToken: newToken },
    });

    // 5. Re-enviar Email (Reutilizando la lógica de create)
    const frontendUrl =
      this.config.get('FRONTEND_URL') || 'http://localhost:4200';
    const activationLink = `${frontendUrl}/auth/activate?token=${newToken}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Reenvío de Invitación - Sistema TPM',
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Invitación al Sistema de Gestión de Activos TPM</h2>
          <p>Hola <strong>${user.name}</strong>,</p>
          <p>Se ha solicitado el reenvío de tu invitación para el rol de <strong>${user.role}</strong>.</p>
          <p>Haz clic abajo para activar tu cuenta:</p>
          <p style="margin: 30px 0;">
            <a href="${activationLink}" 
               style="padding: 12px 24px; background-color: #FF3366; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Activar Cuenta
            </a>
          </p>
          <p style="font-size: 0.8em; color: #666;">Enlace directo: ${activationLink}</p>
        </div>
      `,
    });

    return { success: true, message: 'Invitación reenviada correctamente' };
  }

  // MÉTODO AUXILIAR PARA CAPTURAR ERRORES DE UNICIDAD
  private handlePrismaError(error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        // En tu log el error viene en meta.cause.constraint o meta.target
        const target = JSON.stringify(error.meta) || '';

        if (target.includes('rut')) {
          throw new ConflictException(
            'El RUT ingresado ya está registrado para otro usuario en esta empresa.',
          );
        }
        if (target.includes('email')) {
          throw new ConflictException(
            'El correo electrónico ya está registrado.',
          );
        }
      }
    }
  }

  async remove(id: string, requesterTenantId?: string, requesterRole?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('Usuario no encontrado');

    if (
      requesterRole !== 'SUPER_ADMIN' &&
      user.tenantId !== requesterTenantId
    ) {
      throw new BadRequestException(
        'No tienes permisos para eliminar este usuario',
      );
    }

    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }
}
