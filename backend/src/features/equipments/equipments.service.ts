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
  async create(user: any, data: any, activeContract?: string) {
    const tenantId = user.tenantId;

    // Si viene el activeContract del Header (ej. porque el selector está en "Caserones")
    // y el frontend no mandó un contractId explícito, lo forzamos.
    if (!data.contractId && activeContract && activeContract !== 'ALL') {
      if (
        user.role === 'ADMIN' ||
        user.role === 'SUPER_ADMIN' ||
        user.allowedContracts?.includes(activeContract)
      ) {
        data.contractId = activeContract;
      }
    }

    if (!data.contractId) {
      throw new BadRequestException('Debe indicar el contrato principal.');
    }

    // Aseguramos que si no hay subcontrato, pase null (no un string vacío)
    if (!data.subcontractId) {
      data.subcontractId = null;
    }

    const subsCount = await this.prisma.subcontract.count({
      where: { contractId: data.contractId },
    });
    if (subsCount > 0 && !data.subcontractId) {
      throw new BadRequestException(
        'Este contrato tiene subcontratos: debe asignar el equipo a un subcontrato.',
      );
    }

    if (data.subcontractId) {
      const sub = await this.prisma.subcontract.findFirst({
        where: { id: data.subcontractId, contractId: data.contractId },
      });
      if (!sub) {
        throw new BadRequestException(
          'El subcontrato no pertenece al contrato seleccionado.',
        );
      }
    }

    if (!data.soapExp) {
      throw new BadRequestException(
        'La fecha de vencimiento del seguro obligatorio es obligatoria.',
      );
    }

    try {
      return await this.prisma.equipment.create({
        data: {
          ...data,
          tenantId,
        },
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
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    // Lógica de Seguridad y Filtro por Contrato/Subcontrato
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (siteHeader && siteHeader !== 'ALL') {
        andConditions.push({
          OR: [
            { contractId: siteHeader },
            { subcontract: { contractId: siteHeader } },
          ],
        });
      }
    } else {
      andConditions.push({
        OR: [
          { contractId: { in: user.allowedContracts || [] } },
          { subcontract: { contractId: { in: user.allowedContracts || [] } } },
        ],
      });
    }

    if (query?.type) andConditions.push({ type: query.type });
    if (query?.brand) andConditions.push({ brand: query.brand });

    // Lógica de Búsqueda
    if (query?.search) {
      andConditions.push({
        OR: [
          { internalId: { contains: query.search, mode: 'insensitive' } },
          { plate: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    // Inyectar conditions al where si existen
    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { internalId: 'asc' },
        include: {
          contract: {
            select: {
              name: true,
              code: true,
            },
          },
          subcontract: {
            select: {
              name: true,
              code: true,
              contract: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.equipment.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getAnalytics(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;

    const where: Prisma.EquipmentWhereInput = { id, tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      andConditions.push({
        OR: [
          { contractId: { in: user.allowedContracts || [] } },
          { subcontract: { contractId: { in: user.allowedContracts || [] } } },
        ],
      });
    } else if (siteHeader && siteHeader !== 'ALL') {
      andConditions.push({
        OR: [
          { contractId: siteHeader },
          { subcontract: { contractId: siteHeader } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [equipment, workOrders, meterAdjustments] =
      await this.prisma.$transaction([
        this.prisma.equipment.findFirst({
          where,
          include: {
            contract: true,
            subcontract: true,
          },
        }),
        this.prisma.workOrder.findMany({
          where: { equipmentId: id, tenantId, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
          take: 50,
        }),
        this.prisma.meterAdjustment.findMany({
          where: { equipmentId: id },
          orderBy: { date: 'desc' },
          include: {
            user: { select: { name: true, email: true } },
          },
        }),
      ]);

    if (!equipment) {
      throw new BadRequestException('Equipo no encontrado o sin permisos');
    }

    return { equipment, workOrders, meterAdjustments };
  }

  async findOne(user: any, id: string, siteHeader?: string) {
    const where: Prisma.EquipmentWhereInput = { id, tenantId: user.tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      andConditions.push({
        OR: [
          { contractId: { in: user.allowedContracts || [] } },
          { subcontract: { contractId: { in: user.allowedContracts || [] } } },
        ],
      });
    } else if (siteHeader && siteHeader !== 'ALL') {
      andConditions.push({
        OR: [
          { contractId: siteHeader },
          { subcontract: { contractId: siteHeader } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return this.prisma.equipment.findFirst({
      where,
      include: {
        contract: true,
        subcontract: true,
      },
    });
  }

  // PUT: Actualizar un equipo existente
  async update(user: any, id: string, data: any, siteHeader?: string) {
    const tenantId = user.tenantId;
    try {
      const where: Prisma.EquipmentWhereInput = { id, tenantId };
      const andConditions: Prisma.EquipmentWhereInput[] = [];

      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        andConditions.push({
          OR: [
            { contractId: { in: user.allowedContracts || [] } },
            {
              subcontract: { contractId: { in: user.allowedContracts || [] } },
            },
          ],
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      // Verificamos propiedad del tenant y seguridad
      const existing = await this.prisma.equipment.findFirst({
        where,
      });
      if (!existing)
        throw new BadRequestException('Equipo no encontrado o sin permisos');

      // Limpiamos subcontractId si el frontend manda un string vacío
      if (data.subcontractId === '') {
        data.subcontractId = null;
      }

      const nextContractId =
        data.contractId !== undefined ? data.contractId : existing.contractId;
      let nextSubId =
        data.subcontractId !== undefined
          ? data.subcontractId
          : existing.subcontractId;
      if (nextSubId === '') nextSubId = null;

      if (nextContractId) {
        const subsCount = await this.prisma.subcontract.count({
          where: { contractId: nextContractId },
        });
        if (subsCount > 0 && !nextSubId) {
          throw new BadRequestException(
            'Este contrato tiene subcontratos: debe asignar el equipo a un subcontrato.',
          );
        }
        if (nextSubId) {
          const sub = await this.prisma.subcontract.findFirst({
            where: { id: nextSubId, contractId: nextContractId },
          });
          if (!sub) {
            throw new BadRequestException(
              'El subcontrato no pertenece al contrato seleccionado.',
            );
          }
        }
      }

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
      const andConditions: Prisma.EquipmentWhereInput[] = [];

      if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
        andConditions.push({
          OR: [
            { contractId: { in: user.allowedContracts || [] } },
            {
              subcontract: { contractId: { in: user.allowedContracts || [] } },
            },
          ],
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      const existing = await this.prisma.equipment.findFirst({
        where,
      });
      if (!existing)
        throw new BadRequestException('Equipo no encontrado o sin permisos');

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
