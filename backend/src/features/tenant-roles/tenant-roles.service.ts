import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantRoleDto } from './dto/create-tenant-role.dto';
import { UpdateTenantRoleDto } from './dto/update-tenant-role.dto';

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
    return this.prisma.tenantRole.findMany({
      where: { tenantId },
      select: ROLE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
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

    // Desasignar usuarios que tenían este rol custom antes de eliminarlo.
    await this.prisma.user.updateMany({
      where: { customRoleId: id },
      data: { customRoleId: null },
    });

    await this.prisma.tenantRole.delete({ where: { id } });
    return { message: 'Rol eliminado correctamente.' };
  }
}
