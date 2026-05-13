import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InventorySuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.inventorySupplier.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  async create(tenantId: string, name: string) {
    const trimmed = name.trim().slice(0, 150);
    return this.prisma.inventorySupplier.upsert({
      where: { tenantId_name: { tenantId, name: trimmed } },
      update: {},
      create: { tenantId, name: trimmed },
      select: { id: true, name: true },
    });
  }

  async remove(id: string, tenantId: string) {
    const existing = await this.prisma.inventorySupplier.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Proveedor no encontrado.');
    await this.prisma.inventorySupplier.delete({ where: { id } });
  }
}
