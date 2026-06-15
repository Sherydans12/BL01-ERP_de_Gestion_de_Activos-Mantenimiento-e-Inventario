import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantRoleDto } from './dto/create-tenant-role.dto';
import { UpdateTenantRoleDto } from './dto/update-tenant-role.dto';
import {
  ensureDefaultTenantRolesForTenant,
  SYSTEM_MIRROR_ROLE_NAME,
} from './tenant-role-defaults';

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  baseRole: true,
  routes: true,
  permissions: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true } },
} as const;

@Injectable()
export class TenantRolesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    await ensureDefaultTenantRolesForTenant(this.prisma, tenantId);
    return this.prisma.tenantRole.findMany({
      where: { tenantId },
      select: ROLE_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Idempotente: asegura roles espejo y devuelve el listado (útil para botón en UI). */
  async ensureDefaultsAndList(tenantId: string) {
    return this.findAll(tenantId);
  }

  async create(tenantId: string, dto: CreateTenantRoleDto) {
    const existing = await this.prisma.tenantRole.findFirst({
      where: { tenantId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un rol con el nombre "${dto.name}".`,
      );
    }

    return this.prisma.tenantRole.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        baseRole: dto.baseRole,
        routes: dto.routes,
        permissions: dto.permissions ?? [],
      },
      select: ROLE_SELECT,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTenantRoleDto) {
    const role = await this.prisma.tenantRole.findFirst({
      where: { id, tenantId },
    });
    if (!role) throw new NotFoundException('Rol no encontrado.');

    const mirrorNames = new Set(Object.values(SYSTEM_MIRROR_ROLE_NAME));
    if (
      mirrorNames.has(role.name) &&
      dto.name !== undefined &&
      dto.name !== role.name
    ) {
      throw new BadRequestException(
        'No se puede renombrar un rol base del sistema (Sistema · …).',
      );
    }

    if (dto.name && dto.name !== role.name) {
      const dup = await this.prisma.tenantRole.findFirst({
        where: { tenantId, name: dto.name, id: { not: id } },
      });
      if (dup) {
        throw new ConflictException(
          `Ya existe un rol con el nombre "${dto.name}".`,
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.baseRole !== undefined) data.baseRole = dto.baseRole;
    if (dto.routes !== undefined) data.routes = dto.routes;
    if (dto.permissions !== undefined) data.permissions = dto.permissions;

    return this.prisma.tenantRole.update({
      where: { id },
      data,
      select: ROLE_SELECT,
    });
  }

  async remove(
    tenantId: string,
    id: string,
    replacementRoleId?: string,
  ) {
    const role = await this.prisma.tenantRole.findFirst({
      where: { id, tenantId },
    });
    if (!role) throw new NotFoundException('Rol no encontrado.');

    const mirrorNames = new Set(Object.values(SYSTEM_MIRROR_ROLE_NAME));
    if (mirrorNames.has(role.name)) {
      throw new BadRequestException(
        'No se puede eliminar un rol base del sistema (Sistema · …).',
      );
    }

    const assignedUsersCount = await this.prisma.user.count({
      where: { tenantId, customRoleId: id },
    });

    let reassignmentRoleId: string | undefined;
    if (assignedUsersCount > 0) {
      if (!replacementRoleId) {
        throw new BadRequestException(
          `El rol tiene ${assignedUsersCount} usuario(s) asignado(s). Debe reasignarlos a otro rol del mismo nivel antes de eliminarlo.`,
        );
      }

      const replacement = await this.prisma.tenantRole.findFirst({
        where: { id: replacementRoleId, tenantId },
      });
      if (!replacement) {
        throw new NotFoundException(
          'El rol de reemplazo no existe o no pertenece al tenant.',
        );
      }
      if (replacement.id === role.id) {
        throw new BadRequestException(
          'Debe seleccionar un rol de reemplazo distinto al que desea eliminar.',
        );
      }
      if (replacement.baseRole !== role.baseRole) {
        throw new BadRequestException(
          'El rol de reemplazo debe tener el mismo rol base para preservar el nivel de acceso de los usuarios.',
        );
      }

      reassignmentRoleId = replacement.id;
    }

    await this.prisma.$transaction(async (tx) => {
      if (assignedUsersCount > 0 && reassignmentRoleId) {
        await tx.user.updateMany({
          where: { tenantId, customRoleId: id },
          data: { customRoleId: reassignmentRoleId },
        });
      }

      await tx.tenantRole.delete({ where: { id } });
    });

    if (assignedUsersCount > 0) {
      return {
        message: `Rol eliminado correctamente. ${assignedUsersCount} usuario(s) fueron reasignados al nuevo rol.`,
      };
    }

    return { message: 'Rol eliminado correctamente.' };
  }
}
