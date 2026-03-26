import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateInventoryItemDto {
  partNumber: string;
  name: string;
  description?: string;
  category: string;
  unitOfMeasure: string;
  brand?: string;
  isSerialized: boolean;
}

@Injectable()
export class InventoryItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: any) {
    return this.prisma.inventoryItem.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: any) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');
    return item;
  }

  async create(dto: CreateInventoryItemDto, user: any) {
    const existing = await this.prisma.inventoryItem.findUnique({
      where: {
        tenantId_partNumber: {
          tenantId: user.tenantId,
          partNumber: dto.partNumber,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Ya existe un artículo con este Número de Parte.',
      );
    }

    return this.prisma.inventoryItem.create({
      data: {
        tenantId: user.tenantId,
        ...dto,
      },
    });
  }

  async update(id: string, dto: CreateInventoryItemDto, user: any) {
    await this.findOne(id, user); // Validar que existe y pertenece al tenant

    // Validar si el nuevo partNumber ya está en uso por otro ID
    const existing = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId: user.tenantId,
        partNumber: dto.partNumber,
        id: { not: id },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'El Número de Parte ya está siendo usado por otro artículo.',
      );
    }

    return this.prisma.inventoryItem.update({
      where: { id },
      data: dto,
    });
  }

  async search(user: any, q: string) {
    if (!q || q.trim().length < 2) return [];

    return this.prisma.inventoryItem.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [
          { partNumber: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        partNumber: true,
        name: true,
        unitOfMeasure: true,
        category: true,
        brand: true,
      },
      orderBy: { partNumber: 'asc' },
      take: 15,
    });
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user); // Validar

    try {
      return await this.prisma.inventoryItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(
        'No se puede eliminar el artículo porque ya tiene historial de stock o transacciones en bodegas.',
      );
    }
  }
}
