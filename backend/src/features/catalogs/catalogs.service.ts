import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CatalogsService {
  private readonly logger = new Logger(CatalogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // POST: Crear un nuevo ítem de catálogo (Ej: Sistema Motor)
  async create(data: Prisma.CatalogItemCreateInput) {
    try {
      return await this.prisma.catalogItem.create({ data });
    } catch (error) {
      this.logger.error(
        'Error creating catalog item',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException('Error al crear ítem de catálogo');
    }
  }

  // GET: Traer todos los catálogos
  async findAll(activeOnly?: boolean) {
    const where = activeOnly ? { isActive: true } : {};
    return this.prisma.catalogItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  // PATCH: Actualizar un ítem de catálogo (Ej: Desactivar o corregir nombre)
  async update(id: string, data: Prisma.CatalogItemUpdateInput) {
    try {
      return await this.prisma.catalogItem.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.logger.error(
        `Error updating catalog item ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Error al actualizar ítem de catálogo',
      );
    }
  }

  // DELETE: Eliminar un ítem de catálogo
  async remove(id: string) {
    try {
      return await this.prisma.catalogItem.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(
        `Error deleting catalog item ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Error al eliminar ítem de catálogo',
      );
    }
  }
}
