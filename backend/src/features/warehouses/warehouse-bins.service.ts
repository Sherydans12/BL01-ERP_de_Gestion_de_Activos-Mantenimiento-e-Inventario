import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateWarehouseBinDto {
  code: string;
  label?: string;
}

@Injectable()
export class WarehouseBinsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(warehouseId: string, user: any) {
    await this.assertWarehouseAccess(warehouseId, user);

    return this.prisma.warehouseBin.findMany({
      where: { warehouseId },
      orderBy: { code: 'asc' },
      include: { _count: { select: { stocks: true } } },
    });
  }

  async findOne(warehouseId: string, binId: string, user: any) {
    await this.assertWarehouseAccess(warehouseId, user);

    const bin = await this.prisma.warehouseBin.findFirst({
      where: { id: binId, warehouseId },
    });
    if (!bin) throw new NotFoundException('Ubicación no encontrada');
    return bin;
  }

  async create(warehouseId: string, dto: CreateWarehouseBinDto, user: any) {
    await this.assertWarehouseAccess(warehouseId, user);

    const existing = await this.prisma.warehouseBin.findUnique({
      where: {
        warehouseId_code: { warehouseId, code: dto.code.trim() },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Ya existe una ubicación con este código en la bodega.',
      );
    }

    return this.prisma.warehouseBin.create({
      data: {
        warehouseId,
        code: dto.code.trim(),
        label: dto.label?.trim() || null,
      },
    });
  }

  async update(
    warehouseId: string,
    binId: string,
    dto: CreateWarehouseBinDto,
    user: any,
  ) {
    await this.findOne(warehouseId, binId, user);

    const duplicate = await this.prisma.warehouseBin.findFirst({
      where: {
        warehouseId,
        code: dto.code.trim(),
        id: { not: binId },
      },
    });

    if (duplicate) {
      throw new BadRequestException(
        'El código ya está siendo usado por otra ubicación.',
      );
    }

    return this.prisma.warehouseBin.update({
      where: { id: binId },
      data: {
        code: dto.code.trim(),
        label: dto.label?.trim() || null,
      },
    });
  }

  async remove(warehouseId: string, binId: string, user: any) {
    await this.findOne(warehouseId, binId, user);

    const stockCount = await this.prisma.itemStock.count({
      where: { binId },
    });

    if (stockCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la ubicación tiene ${stockCount} registro(s) de stock asignado(s).`,
      );
    }

    return this.prisma.warehouseBin.delete({ where: { id: binId } });
  }

  private async assertWarehouseAccess(warehouseId: string, user: any) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: user.tenantId },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');
    return warehouse;
  }
}
