import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { ensureDefaultTenantRolesForTenant } from '../tenant-roles/tenant-role-defaults';
import { ensureDefaultUnitsOfMeasureForTenant } from '../inventory-items/unit-of-measure-defaults';

@Injectable()
export class TenantConfigService {
  constructor(private prisma: PrismaService) {}

  async getTenantConfig(tenantId: string) {
    await ensureDefaultTenantRolesForTenant(this.prisma, tenantId);
    await ensureDefaultUnitsOfMeasureForTenant(this.prisma, tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        logoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
        tenantRoles: {
          select: {
            id: true,
            name: true,
            description: true,
            baseRole: true,
            routes: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(
        'Tenant no encontrado al consultar configuración',
      );
    }

    return {
      ...tenant,
      rut: tenant.rut || '',
      address: tenant.address || '',
      phone: tenant.phone || '',
      logoUrl: tenant.logoUrl || '',
      laborRatePerHour: tenant.laborRatePerHour
        ? Number(tenant.laborRatePerHour.toString())
        : 0,
    };
  }

  async updateTenantConfig(tenantId: string, dto: UpdateTenantConfigDto) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        logoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
      },
    });

    return tenant;
  }
}
