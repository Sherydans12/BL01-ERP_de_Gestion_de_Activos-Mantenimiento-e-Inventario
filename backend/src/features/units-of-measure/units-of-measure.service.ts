import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateUnitOfMeasureDto {
  name: string;
  abbreviation: string;
}

@Injectable()
export class UnitsOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: { tenantId: string }) {
    return this.prisma.unitOfMeasure.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ name: 'asc' }],
    });
  }

  async create(dto: CreateUnitOfMeasureDto, user: { tenantId: string }) {
    const name = dto.name.trim();
    const abbreviation = dto.abbreviation.trim().toUpperCase();
    if (!name || !abbreviation) {
      throw new BadRequestException('Nombre y abreviatura son obligatorios.');
    }
    if (abbreviation.length > 20) {
      throw new BadRequestException(
        'La abreviatura no puede superar 20 caracteres.',
      );
    }

    const dup = await this.prisma.unitOfMeasure.findFirst({
      where: {
        tenantId: user.tenantId,
        abbreviation,
      },
    });
    if (dup) {
      throw new BadRequestException(
        'Ya existe una unidad con esta abreviatura en su empresa.',
      );
    }

    return this.prisma.unitOfMeasure.create({
      data: {
        tenantId: user.tenantId,
        name,
        abbreviation,
      },
    });
  }

  async update(
    id: string,
    dto: CreateUnitOfMeasureDto,
    user: { tenantId: string },
  ) {
    await this.findOne(id, user);
    const name = dto.name.trim();
    const abbreviation = dto.abbreviation.trim().toUpperCase();
    if (!name || !abbreviation) {
      throw new BadRequestException('Nombre y abreviatura son obligatorios.');
    }

    const dup = await this.prisma.unitOfMeasure.findFirst({
      where: {
        tenantId: user.tenantId,
        abbreviation,
        id: { not: id },
      },
    });
    if (dup) {
      throw new BadRequestException(
        'Ya existe otra unidad con esta abreviatura.',
      );
    }

    return this.prisma.unitOfMeasure.update({
      where: { id },
      data: { name, abbreviation },
    });
  }

  async remove(id: string, user: { tenantId: string }) {
    await this.findOne(id, user);
    const n = await this.prisma.inventoryItem.count({
      where: { unitOfMeasureId: id, tenantId: user.tenantId },
    });
    if (n > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${n} artículo(s) usan esta unidad.`,
      );
    }
    return this.prisma.unitOfMeasure.delete({ where: { id } });
  }

  private async findOne(id: string, user: { tenantId: string }) {
    const row = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!row) throw new NotFoundException('Unidad no encontrada');
    return row;
  }
}
