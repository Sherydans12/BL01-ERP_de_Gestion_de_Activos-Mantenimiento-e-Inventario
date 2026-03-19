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
  async create(tenantId: string, data: any) {
    try {
      return await this.prisma.equipment.create({
        data: { ...data, tenantId },
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
    tenantId: string,
    query?: {
      page?: number;
      limit?: number;
      type?: string;
      brand?: string;
      search?: string;
    },
  ) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.EquipmentWhereInput = { tenantId };

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
      }),
      this.prisma.equipment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // GET: Traer un solo equipo por su UUID
  async findOne(tenantId: string, id: string) {
    return this.prisma.equipment.findFirst({
      where: { id, tenantId },
    });
  }

  // PUT: Actualizar un equipo existente
  async update(tenantId: string, id: string, data: any) {
    try {
      // Verificamos propiedad del tenant
      const existing = await this.prisma.equipment.findFirst({
        where: { id, tenantId },
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
  async remove(tenantId: string, id: string) {
    try {
      const existing = await this.prisma.equipment.findFirst({
        where: { id, tenantId },
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
