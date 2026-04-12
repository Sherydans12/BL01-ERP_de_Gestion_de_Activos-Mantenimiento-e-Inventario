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
      throw new ConflictException(`Ya existe un rol con el nombre "${dto.name}".`);
    }

    return this.prisma.tenantRole.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        baseRole: dto.baseRole,
        routes: dto.routes,
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
    if (mirrorNames.has(role.name) && dto.name !== undefined && dto.name !== role.name) {
      throw new BadRequestException(
        'No se puede renombrar un rol base del sistema (Sistema · …).',
      );
    }

    if (dto.name && dto.name !== role.name) {
      const dup = await this.prisma.tenantRole.findFirst({
        where: { tenantId, name: dto.name, id: { not: id } },
      });
      if (dup) {
        throw new ConflictException(`Ya existe un rol con el nombre "${dto.name}".`);
      }
    }

    return this.prisma.tenantRole.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        baseRole: dto.baseRole,
        routes: dto.routes,
      },
      select: ROLE_SELECT,
    });
  }

  async remove(tenantId: string, id: string) {
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

    // Desasignar usuarios que tenían este rol custom antes de eliminarlo.
    await this.prisma.user.updateMany({
      where: { customRoleId: id },
      data: { customRoleId: null },
    });

    await this.prisma.tenantRole.delete({ where: { id } });
    return { message: 'Rol eliminado correctamente.' };
  }
}
