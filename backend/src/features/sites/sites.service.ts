import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, data: { name: string; code: string }) {
    try {
      return await this.prisma.site.create({
        data: {
          ...data,
          tenantId,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al crear la faena');
    }
  }

  async findAll(tenantId: string) {
    return this.prisma.site.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: { name: string; code: string; isActive?: boolean },
  ) {
    try {
      const existing = await this.prisma.site.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new BadRequestException('Faena no encontrada');

      return await this.prisma.site.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al actualizar la faena');
    }
  }

  async remove(tenantId: string, id: string) {
    try {
      const existing = await this.prisma.site.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new BadRequestException('Faena no encontrada');

      return await this.prisma.site.delete({
        where: { id },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error al eliminar la faena. Puede que tenga registros asociados.',
      );
    }
  }
}
