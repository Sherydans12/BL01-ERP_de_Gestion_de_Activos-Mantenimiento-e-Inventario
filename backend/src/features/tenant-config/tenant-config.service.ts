import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';

@Injectable()
export class TenantConfigService {
  constructor(private prisma: PrismaService) {}

  async getTenantConfig(tenantId: string) {
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
        backgroundPreference: true,
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
        backgroundPreference: true,
      },
    });

    return tenant;
  }
}
