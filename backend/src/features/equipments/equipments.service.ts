import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class EquipmentsService {
  private readonly logger = new Logger(EquipmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // POST: Crear un nuevo equipo
  async create(user: any, data: any, siteHeader?: string) {
    const tenantId = user.tenantId;
    let siteId = data.siteId;

    if (!siteId && siteHeader && siteHeader !== 'ALL') {
      if (user.role === 'ADMIN' || user.allowedSites?.includes(siteHeader)) {
        siteId = siteHeader;
      }
    }

    try {
      return await this.prisma.equipment.create({
        data: { ...data, tenantId, ...(siteId && { siteId }) },
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Ya existe un equipo registrado con ese N° Interno, Patente o VIN',
        );
      }
      this.logger.error(
        'Error creating equipment',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException('Error al crear el equipo en BD');
    }
  }

  // GET: Traer toda la flota (paginada y con filtros)
  async findAll(
    user: any,
    siteHeader: string | undefined,
    query?: {
      page?: number;
      limit?: number;
      type?: string;
      brand?: string;
      search?: string;
    },
  ) {
    const tenantId = user.tenantId;
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.EquipmentWhereInput = { tenantId };

    if (user.role === 'ADMIN') {
      if (
        siteHeader &&
        siteHeader !== 'ALL' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          siteHeader,
        )
      ) {
        where.siteId = siteHeader;
      }
    } else {
      where.siteId = { in: user.allowedSites || [] };
    }

    if (query?.type) where.type = query.type;
    if (query?.brand) where.brand = query.brand;

    if (query?.search) {
      where.OR = [
        { internalId: { contains: query.search, mode: 'insensitive' } },
        { plate: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { internalId: 'asc' },
        include: { site: { select: { name: true, code: true } } },
      }),
      this.prisma.equipment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // GET: Traer un solo equipo por su UUID
  async findOne(user: any, id: string, siteHeader?: string) {
    const where: Prisma.EquipmentWhereInput = { id, tenantId: user.tenantId };

    if (user.role !== 'ADMIN') {
      where.siteId = { in: user.allowedSites || [] };
    } else if (siteHeader && siteHeader !== 'ALL') {
      // Optional: verify it falls under the requested siteHeader for ADMIN
      where.siteId = siteHeader;
    }

    return this.prisma.equipment.findFirst({
      where,
    });
  }

  // PUT: Actualizar un equipo existente
  async update(user: any, id: string, data: any, siteHeader?: string) {
    const tenantId = user.tenantId;
    try {
      const where: Prisma.EquipmentWhereInput = { id, tenantId };
      if (user.role !== 'ADMIN') {
        where.siteId = { in: user.allowedSites || [] };
      }

      // Verificamos propiedad del tenant y sitios
      const existing = await this.prisma.equipment.findFirst({
        where,
      });
      if (!existing) throw new BadRequestException('Equipo no encontrado');

      return await this.prisma.equipment.update({
        where: { id },
        data,
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Ya existe un equipo registrado con ese N° Interno, Patente o VIN',
        );
      }
      this.logger.error(
        `Error updating equipment ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Error al actualizar el equipo en BD',
      );
    }
  }

  // DELETE: Eliminar un equipo
  async remove(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;
    try {
      const where: Prisma.EquipmentWhereInput = { id, tenantId };
      if (user.role !== 'ADMIN') {
        where.siteId = { in: user.allowedSites || [] };
      }

      const existing = await this.prisma.equipment.findFirst({
        where,
      });
      if (!existing) throw new BadRequestException('Equipo no encontrado');

      return await this.prisma.equipment.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(
        `Error deleting equipment ${id}`,
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'Error al eliminar el equipo. Verifique si tiene órdenes de trabajo asociadas.',
      );
    }
  }
}
