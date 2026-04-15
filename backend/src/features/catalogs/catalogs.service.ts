import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CatalogsService {
  private readonly logger = new Logger(CatalogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireTenantId(tenantId: string | undefined): string {
    if (!tenantId?.trim()) {
      throw new BadRequestException(
        'Se requiere empresa (tenant) para operar catálogos.',
      );
    }
    return tenantId;
  }

  // POST: Crear un nuevo ítem de catálogo (Ej: Sistema Motor)
  async create(
    tenantId: string | undefined,
    data: Prisma.CatalogItemCreateInput,
  ) {
    const tid = this.requireTenantId(tenantId);
    try {
      return await this.prisma.catalogItem.create({
        data: {
          code: data.code,
          name: data.name,
          category: data.category,
          isActive: data.isActive ?? true,
          tenant: { connect: { id: tid } },
        },
      });
    } catch (error) {
      this.logger.error(
        'Error creating catalog item',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException('Error al crear ítem de catálogo');
    }
  }

  // GET: Traer todos los catálogos del tenant
  async findAll(tenantId: string | undefined, activeOnly?: boolean) {
    const tid = this.requireTenantId(tenantId);
    const where: Prisma.CatalogItemWhereInput = {
      tenantId: tid,
      ...(activeOnly ? { isActive: true } : {}),
    };
    return this.prisma.catalogItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  // GET: Traer todos los contratos (Reemplaza Sites)
  async findAllContracts(tenantId: string) {
    return this.prisma.contract.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // PATCH: Actualizar un ítem de catálogo (Ej: Desactivar o corregir nombre)
  async update(
    tenantId: string | undefined,
    id: string,
    data: Prisma.CatalogItemUpdateInput,
  ) {
    const tid = this.requireTenantId(tenantId);
    const existing = await this.prisma.catalogItem.findFirst({
      where: { id, tenantId: tid },
    });
    if (!existing) {
      throw new NotFoundException('Ítem de catálogo no encontrado');
    }
    const { tenant: _t, tenantId: _tid, ...rest } = data as Record<
      string,
      unknown
    >;
    try {
      return await this.prisma.catalogItem.update({
        where: { id },
        data: rest as Prisma.CatalogItemUpdateInput,
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
  async remove(tenantId: string | undefined, id: string) {
    const tid = this.requireTenantId(tenantId);
    const existing = await this.prisma.catalogItem.findFirst({
      where: { id, tenantId: tid },
    });
    if (!existing) {
      throw new NotFoundException('Ítem de catálogo no encontrado');
    }
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
