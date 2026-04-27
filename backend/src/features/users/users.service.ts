import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import {
  MAX_USER_AVATAR_BYTES,
  USER_AVATAR_MIME_TYPES,
  USER_AVATAR_STORAGE_FOLDER,
} from './user-avatar.constants';
import { AuthAuditService } from '../auth/auth-audit.service';
import type { LoginRequestMeta } from '../auth/auth-request.util';
import { UserSessionService } from '../auth/user-session.service';
import { EmailService } from '../../common/email/email.service';

const meSelect = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  customRoleId: true,
  customRole: { select: { id: true, name: true, baseRole: true } },
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private config: ConfigService,
    private readonly storage: StorageService,
    private readonly authAudit: AuthAuditService,
    private readonly userSessions: UserSessionService,
  ) {}

  private avatarPublicUrlToStorageKey(publicUrl: string | null): string | null {
    if (!publicUrl) return null;
    if (/^https?:\/\//i.test(publicUrl.trim())) return null;
    return this.storage.normalizeStorageKey(publicUrl);
  }

  private buildDisplayName(
    first: string | null | undefined,
    last: string | null | undefined,
    legacyName: string,
  ): string {
    const combined = [first?.trim(), last?.trim()].filter(Boolean).join(' ');
    return combined.trim() || legacyName;
  }

  private assertPasswordPolicy(pw: string) {
    if (pw.length < 8) {
      throw new BadRequestException(
        'La nueva contraseña debe tener al menos 8 caracteres',
      );
    }
    if (!/[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]/.test(pw) || !/[0-9]/.test(pw)) {
      throw new BadRequestException(
        'La nueva contraseña debe incluir al menos una letra y un número',
      );
    }
  }

  private async mapMeRow(u: {
    id: string;
    email: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    avatarUrl: string | null;
    role: string;
    customRoleId: string | null;
    customRole: { id: string; name: string; baseRole: string } | null;
  }) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      avatarUrl: u.avatarUrl
        ? await this.storage.getReadOnlyUrl(u.avatarUrl)
        : null,
      role: u.role,
      customRoleId: u.customRoleId,
      customRoleName: u.customRole?.name ?? null,
    };
  }

  async getMe(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: meSelect,
    });
    if (!u) throw new BadRequestException('Usuario no encontrado');
    return this.mapMeRow(u);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuario no encontrado');

    if (dto.removeAvatar) {
      const key = this.avatarPublicUrlToStorageKey(user.avatarUrl);
      if (key) {
        try {
          await this.storage.deleteFile(key);
        } catch {
          /* archivo ausente o clave inválida */
        }
      }
    }

    const nextPhone =
      dto.phone !== undefined
        ? dto.phone === null || dto.phone === ''
          ? null
          : String(dto.phone).trim()
        : user.phone;

    const data: Prisma.UserUpdateInput = {
      phone: nextPhone,
    };

    if (dto.firstName !== undefined)
      data.firstName = dto.firstName.trim() || null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim() || null;
    if (dto.removeAvatar) data.avatarUrl = null;

    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      data.name = this.buildDisplayName(
        dto.firstName !== undefined
          ? dto.firstName.trim() || null
          : user.firstName,
        dto.lastName !== undefined
          ? dto.lastName.trim() || null
          : user.lastName,
        user.name,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: meSelect,
    });
    return this.mapMeRow(updated);
  }

  async uploadAvatar(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo requerido');
    }
    if (file.buffer.length > MAX_USER_AVATAR_BYTES) {
      throw new BadRequestException('La imagen no puede superar 5 MB');
    }
    if (!USER_AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de archivo no permitido por políticas de seguridad',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuario no encontrado');

    const oldKey = this.avatarPublicUrlToStorageKey(user.avatarUrl);
    if (oldKey) {
      try {
        await this.storage.deleteFile(oldKey);
      } catch {
        /* ignore */
      }
    }

    const meta = await this.storage.uploadWithMeta(
      file,
      USER_AVATAR_STORAGE_FOLDER,
    );
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: meta.storageKey },
      select: meSelect,
    });
    return this.mapMeRow(updated);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    meta?: LoginRequestMeta,
  ) {
    this.assertPasswordPolicy(newPassword);
    const dbUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!dbUser) throw new BadRequestException('Usuario no encontrado');
    const ok = await bcrypt.compare(oldPassword, dbUser.password);
    if (!ok) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
    await this.userSessions.invalidateAllForUser(userId);
    if (meta) {
      const geo = await this.authAudit.lookupGeo(meta.clientIp);
      try {
        await this.authAudit.recordPasswordChange({
          userId: dbUser.id,
          email: dbUser.email,
          ip: (meta.clientIp || '').slice(0, 64),
          userAgent: (meta.userAgent || '').slice(0, 512),
          city: geo.city,
          country: geo.country,
        });
      } catch {
        /* no bloquear cambio de clave */
      }
    }
    return { success: true, message: 'Contraseña actualizada correctamente' };
  }

  getMyLoginActivity(userId: string) {
    return this.authAudit.getRecentLoginSuccesses(userId, 5);
  }

  async create(
    data: {
      email: string;
      name: string;
      role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'MECHANIC';
      /** Si se envía, debe pertenecer al tenant; el rol efectivo sale del TenantRole.baseRole */
      customRoleId?: string | null;
      rut?: string;
      phone?: string;
      birthDate?: string | Date;
      position?: string;
      contractIds?: string[]; // CAMBIO: de siteIds a contractIds
    },
    tenantId?: string,
  ) {
    let effectiveRole = data.role;
    let customRoleId: string | null =
      data.customRoleId === undefined || data.customRoleId === ''
        ? null
        : data.customRoleId;

    if (customRoleId && tenantId) {
      const tr = await this.prisma.tenantRole.findFirst({
        where: { id: customRoleId, tenantId },
      });
      if (!tr) {
        throw new BadRequestException(
          'El rol de organización seleccionado no es válido o no pertenece a su tenant.',
        );
      }
      effectiveRole = tr.baseRole as typeof effectiveRole;
      customRoleId = tr.id;
    }

    if (effectiveRole !== 'SUPER_ADMIN' && !tenantId) {
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

    const rutNorm =
      data.rut != null && String(data.rut).trim() !== ''
        ? String(data.rut).trim()
        : null;
    const phoneNorm =
      data.phone != null && String(data.phone).trim() !== ''
        ? String(data.phone).trim()
        : null;

    try {
      const newUser = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: data.email,
            name: data.name,
            role: effectiveRole as any,
            password: '',
            isActive: false,
            activationToken,
            tenantId: effectiveRole === 'SUPER_ADMIN' ? null : tenantId,
            rut: rutNorm,
            phone: phoneNorm,
            birthDate: data.birthDate ? new Date(data.birthDate) : null,
            position: data.position,
            customRoleId,
          },
        });

        if (
          data.contractIds &&
          data.contractIds.length > 0 &&
          user.role !== 'SUPER_ADMIN' &&
          user.role !== 'ADMIN'
        ) {
          // CAMBIO: corrección de nombres de variables para Contracts
          const contractConnections = data.contractIds.map(
            (contractId: string) => ({
              userId: user.id,
              contractId: contractId,
            }),
          );
          await tx.userContract.createMany({ data: contractConnections });
        }

        return user;
      });

      const frontendUrl =
        this.config.get('FRONTEND_URL') || 'http://localhost:4200';
      const activationLink = `${frontendUrl}/auth/activate?token=${activationToken}`;

      try {
        await this.emailService.sendMail({
          to: data.email,
          subject: 'Invitación a Sistema TPM',
          html: `
          <div style="font-family: sans-serif; color: #333;">
            <h2>Bienvenido al Sistema de Gestión de Activos TPM</h2>
            <p>Hola <strong>${data.name}</strong>,</p>
            <p>Has sido invitado a participar en el sistema con el rol de <strong>${effectiveRole}</strong>.</p>
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
      } catch (mailErr) {
        this.logger.warn(
          `Fallo al enviar invitación a ${data.email}: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`,
        );
        try {
          await this.prisma.user.delete({ where: { id: newUser.id } });
        } catch {
          /* evitar enmascarar el error principal */
        }
        throw new ServiceUnavailableException(
          'No se pudo enviar el correo de invitación. Verifique la configuración de correo del servidor o intente más tarde.',
        );
      }

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
          customRoleId: true,
          customRole: { select: { id: true, name: true, baseRole: true } },
          contractAccess: { select: { contractId: true } },
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

  /** Usuarios activos del tenant con rol base mecánico o supervisor (asignación OT). */
  async findAssignableForOt(tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant no disponible');
    }
    return this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { role: { in: ['MECHANIC', 'SUPERVISOR'] } },
          {
            customRole: {
              baseRole: { in: ['MECHANIC', 'SUPERVISOR'] },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        customRole: {
          select: { id: true, name: true, baseRole: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async update(
    id: string,
    data: any,
    requesterTenantId?: string,
    requesterRole?: string,
    requesterId?: string,
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

    if (
      requesterId &&
      id === requesterId &&
      data.isActive === false
    ) {
      throw new BadRequestException(
        'No puede desactivar su propia cuenta.',
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
            customRoleId:
              data.customRoleId !== undefined ? data.customRoleId : undefined,
          },
        });

        // CAMBIO: Se valida data.contractIds en lugar de data.siteIds
        if (data.contractIds !== undefined) {
          if (data.role === 'ADMIN' || data.role === 'SUPER_ADMIN') {
            await tx.userContract.deleteMany({
              where: { userId: updatedUser.id },
            });
          } else {
            await tx.userContract.deleteMany({
              where: { userId: updatedUser.id },
            });
            if (data.contractIds.length > 0) {
              const contractConnections = data.contractIds.map(
                (contractId: string) => ({
                  userId: updatedUser.id,
                  contractId: contractId,
                }),
              );
              await tx.userContract.createMany({ data: contractConnections });
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
            customRoleId: true,
            customRole: { select: { id: true, name: true, baseRole: true } },
            contractAccess: { select: { contractId: true } },
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

    try {
      await this.emailService.sendMail({
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
    } catch (mailErr) {
      this.logger.warn(
        `Fallo al reenviar invitación a ${user.email}: ${mailErr instanceof Error ? mailErr.message : String(mailErr)}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo enviar el correo de invitación. Verifique la configuración de correo del servidor o intente más tarde.',
      );
    }

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

  /**
   * Reset administrativo de contraseña (sin contraseña actual).
   * No aplica al propio usuario autenticado (usar perfil / change-password).
   */
  async adminSetUserPassword(
    targetUserId: string,
    newPassword: string,
    requesterId: string,
    requesterTenantId: string | undefined,
    requesterRole: string | undefined,
    meta?: LoginRequestMeta,
  ) {
    if (targetUserId === requesterId) {
      throw new BadRequestException(
        'No puede establecer su contraseña desde aquí. Use su perfil o “Cambiar contraseña”.',
      );
    }

    this.assertPasswordPolicy(newPassword);

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) throw new BadRequestException('Usuario no encontrado');

    if (
      requesterRole !== 'SUPER_ADMIN' &&
      target.tenantId !== requesterTenantId
    ) {
      throw new BadRequestException(
        'No tienes permisos para modificar este usuario',
      );
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { password: hashed },
    });
    await this.userSessions.invalidateAllForUser(targetUserId);

    if (meta) {
      const geo = await this.authAudit.lookupGeo(meta.clientIp);
      try {
        await this.authAudit.recordPasswordChange({
          userId: target.id,
          email: target.email,
          ip: (meta.clientIp || '').slice(0, 64),
          userAgent: (meta.userAgent || '').slice(0, 512),
          city: geo.city,
          country: geo.country,
        });
      } catch {
        /* no bloquear */
      }
    }

    return { success: true, message: 'Contraseña actualizada correctamente' };
  }
}
