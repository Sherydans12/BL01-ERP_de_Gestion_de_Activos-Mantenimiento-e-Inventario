import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateWarehouseDto {
  code: string;
  name: string;
  location?: string;
  contractId: string;
  subcontractId?: string;
  isActive?: boolean;
}

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: any, activeContract?: string) {
    const tenantId = user.tenantId;
    const where: any = { tenantId };

    // Lógica de seguridad por Contrato
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        where.contractId = activeContract;
      }
    } else {
      where.contractId = { in: user.allowedContracts || [] };
    }

    return this.prisma.warehouse.findMany({
      where,
      include: {
        contract: { select: { name: true, code: true } },
        subcontract: { select: { name: true, code: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: any) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        contract: true,
        subcontract: true,
      },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');
    return warehouse;
  }

  async create(dto: CreateWarehouseDto, user: any) {
    const existing = await this.prisma.warehouse.findUnique({
      where: {
        tenantId_code: {
          tenantId: user.tenantId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Ya existe una bodega con este código en la empresa.',
      );
    }

    return this.prisma.warehouse.create({
      data: {
        tenantId: user.tenantId,
        code: dto.code,
        name: dto.name,
        location: dto.location,
        contractId: dto.contractId,
        subcontractId: dto.subcontractId || null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: CreateWarehouseDto, user: any) {
    await this.findOne(id, user); // Valida que exista y tenga acceso

    const existingCode = await this.prisma.warehouse.findFirst({
      where: {
        tenantId: user.tenantId,
        code: dto.code,
        id: { not: id },
      },
    });

    if (existingCode) {
      throw new BadRequestException(
        'El código ya está siendo usado por otra bodega.',
      );
    }

    return this.prisma.warehouse.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        location: dto.location,
        contractId: dto.contractId,
        subcontractId: dto.subcontractId || null,
        isActive: dto.isActive,
      },
    });
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);

    try {
      return await this.prisma.warehouse.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(
        'No se puede eliminar la bodega porque ya contiene stock o transacciones registradas.',
      );
    }
  }
}
