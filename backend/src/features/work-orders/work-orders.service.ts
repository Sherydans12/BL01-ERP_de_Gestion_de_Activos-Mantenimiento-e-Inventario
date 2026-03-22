import {
  InternalServerErrorException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface CreateWorkOrderDto {
  equipmentId: string;
  type: 'NUEVA' | 'CONTINUIDAD';
  category: 'PROGRAMADA' | 'NO_PROGRAMADA' | 'ACCIDENTE';
  maintenanceType: 'PREVENTIVO' | 'CORRECTIVO';
  initialHorometer: number;
  finalHorometer: number;
  description: string;
  systems: string[]; // UUIDs de CatalogItem (category=SYSTEM)
  fluids: { fluidId: string; liters: number; action: 'RELLENO' | 'CAMBIO' }[];
}

@Injectable()
export class WorkOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: any, dto: CreateWorkOrderDto, siteHeader?: string) {
    const tenantId = user.tenantId;
    let siteId = (dto as any).siteId;

    if (!siteId && siteHeader && siteHeader !== 'ALL') {
      if (user.role === 'ADMIN' || user.allowedSites?.includes(siteHeader)) {
        siteId = siteHeader;
      }
    }
    try {
      // 1. Generar correlativo: OT-{AÑO}-{NNN}
      const year = new Date().getFullYear();
      const count = await this.prisma.workOrder.count({ where: { tenantId } });
      const correlative = `OT-${year}-${String(count + 1).padStart(3, '0')}`;

      // 2. Transacción atómica
      return await this.prisma.$transaction(async (tx: any) => {
        // 2a. Crear la OT principal
        const workOrder = await tx.workOrder.create({
          data: {
            tenantId,
            ...(siteId && { siteId }),
            correlative,
            equipmentId: dto.equipmentId,
            type: dto.type,
            category: dto.category,
            maintenanceType: dto.maintenanceType,
            status: 'OPEN',
            initialHorometer: dto.initialHorometer,
            finalHorometer: dto.finalHorometer,
            description: dto.description,
          },
        });

        // 2b. Crear registros M:N de sistemas intervenidos
        if (dto.systems.length > 0) {
          await tx.workOrderSystem.createMany({
            data: dto.systems.map((systemId) => ({
              workOrderId: workOrder.id,
              catalogItemId: systemId,
            })),
          });
        }

        // 2c. Crear registros de consumo de fluidos
        if (dto.fluids.length > 0) {
          await tx.workOrderFluid.createMany({
            data: dto.fluids.map((f) => ({
              workOrderId: workOrder.id,
              catalogItemId: f.fluidId,
              liters: f.liters,
              action: f.action,
            })),
          });
        }

        // 3. Retornar la OT completa con relaciones
        return tx.workOrder.findUnique({
          where: { id: workOrder.id },
          include: {
            equipment: true,
            systems: { include: { catalogItem: true } },
            fluids: { include: { catalogItem: true } },
          },
        });
      });
    } catch (error) {
      console.error('Error at WorkOrdersService.create:', error);
      throw new InternalServerErrorException(
        'Error al crear la Orden de Trabajo',
      );
    }
  }

  async findAll(
    user: any,
    siteHeader: string | undefined,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      equipmentId?: string;
      status?: string;
    },
  ) {
    const tenantId = user.tenantId;
    const where: any = { tenantId };

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

    if (query?.equipmentId) {
      where.equipmentId = query.equipmentId;
    }

    if (query?.status) {
      where.status = query.status;
    }

    if (query?.search) {
      where.OR = [
        { correlative: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        {
          equipment: {
            internalId: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    if (query?.dateFrom || query?.dateTo) {
      where.createdAt = {};
      if (query?.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query?.dateTo)
        where.createdAt.lte = new Date(query.dateTo + 'T23:59:59');
    }

    const page = query?.page || 1;
    const limit = query?.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          equipment: { select: { internalId: true, type: true } },
          systems: { include: { catalogItem: { select: { name: true } } } },
          fluids: { include: { catalogItem: { select: { name: true } } } },
          site: { select: { name: true, code: true } },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { data, total };
  }

  async getStats(user: any, siteHeader?: string) {
    const now = new Date();
    const tenantId = user.tenantId;

    const siteWhere: any = {};
    if (user.role === 'ADMIN') {
      if (
        siteHeader &&
        siteHeader !== 'ALL' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          siteHeader,
        )
      ) {
        siteWhere.siteId = siteHeader;
      }
    } else {
      siteWhere.siteId = { in: user.allowedSites || [] };
    }

    const whereBaseWO = { tenantId, ...siteWhere };
    const whereBaseEq = { tenantId, ...siteWhere };

    // Conteo por estado
    const [open, inProgress, onHold, closed] = await Promise.all([
      this.prisma.workOrder.count({
        where: { ...whereBaseWO, status: 'OPEN' },
      }),
      this.prisma.workOrder.count({
        where: { ...whereBaseWO, status: 'IN_PROGRESS' },
      }),
      this.prisma.workOrder.count({
        where: { ...whereBaseWO, status: 'ON_HOLD' },
      }),
      this.prisma.workOrder.count({
        where: { ...whereBaseWO, status: 'CLOSED' },
      }),
    ]);

    // 2. Equipos con documentación vencida (Conteo)
    const expiredDocs = await this.prisma.equipment.count({
      where: {
        ...whereBaseEq,
        OR: [{ techReviewExp: { lt: now } }, { circPermitExp: { lt: now } }],
      },
    });

    // 3. Total de equipos
    const totalEquipments = await this.prisma.equipment.count({
      where: whereBaseEq,
    });

    // 4. Equipos en mantenimiento (Conteo de IDs únicos con OTs activas)
    const activeOts = await this.prisma.workOrder.groupBy({
      by: ['equipmentId'],
      where: {
        ...whereBaseWO,
        status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
      },
    });
    const equiposEnMantenimientoCount = activeOts.length;

    // 5. Últimas 5 OTs cerradas
    const lastClosed = await this.prisma.workOrder.findMany({
      where: { ...whereBaseWO, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: 5,
      include: {
        equipment: { select: { internalId: true } },
      },
    });

    // 6. Alertas Documentales (Top 5 próximos a vencer o vencidos recientes)
    const topAlertsData = await this.prisma.equipment.findMany({
      where: {
        ...whereBaseEq,
        OR: [
          { techReviewExp: { not: null } },
          { circPermitExp: { not: null } },
        ],
      },
      orderBy: [{ techReviewExp: 'asc' }],
      take: 10,
    });

    const alerts = topAlertsData
      .map((e: any) => {
        const trDays = e.techReviewExp
          ? Math.ceil(
              (new Date(e.techReviewExp).getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 9999;
        const cpDays = e.circPermitExp
          ? Math.ceil(
              (new Date(e.circPermitExp).getTime() - now.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 9999;
        const minDays = Math.min(trDays, cpDays);
        return {
          id: e.id,
          internalId: e.internalId,
          plate: e.plate,
          daysRemaining: minDays,
          type: trDays < cpDays ? 'Rev. Técnica' : 'Perm. Circulación',
        };
      })
      .sort((a: any, b: any) => a.daysRemaining - b.daysRemaining)
      .slice(0, 5);

    return {
      otsByStatus: {
        OPEN: open,
        IN_PROGRESS: inProgress,
        ON_HOLD: onHold,
        CLOSED: closed,
      },
      expiredDocs,
      totalEquipments,
      equiposEnMantenimiento: equiposEnMantenimientoCount,
      disponibilidad:
        totalEquipments > 0
          ? Math.round(
              ((totalEquipments - equiposEnMantenimientoCount) /
                totalEquipments) *
                100,
            )
          : 100,
      lastClosed,
      topAlerts: alerts,
    };
  }

  async findOne(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;
    const where: any = { id, tenantId };

    if (user.role !== 'ADMIN') {
      where.siteId = { in: user.allowedSites || [] };
    } else if (siteHeader && siteHeader !== 'ALL') {
      where.siteId = siteHeader;
    }

    return this.prisma.workOrder.findFirst({
      where,
      include: {
        equipment: true,
        systems: { include: { catalogItem: true } },
        fluids: { include: { catalogItem: true } },
      },
    });
  }

  async updateStatus(
    user: any,
    id: string,
    status: string,
    siteHeader?: string,
  ) {
    const tenantId = user.tenantId;
    const where: any = { id, tenantId };

    if (user.role !== 'ADMIN') {
      where.siteId = { in: user.allowedSites || [] };
    }

    try {
      if (status === 'CLOSED') {
        return await this.prisma.$transaction(async (tx: any) => {
          // 1. Obtener la OT actual
          const workOrder = await tx.workOrder.findFirst({
            where,
            include: { equipment: true },
          });

          if (!workOrder) {
            throw new BadRequestException('Orden de Trabajo no encontrada');
          }

          if (workOrder.status === 'CLOSED') {
            throw new BadRequestException(
              'La Orden de Trabajo ya se encuentra CERRADA',
            );
          }

          // 2. Validar horómetro
          if (workOrder.finalHorometer < workOrder.equipment.currentHorometer) {
            throw new BadRequestException(
              `El horómetro final de la OT (${workOrder.finalHorometer}) no puede ser menor al horómetro actual del equipo (${workOrder.equipment.currentHorometer})`,
            );
          }

          // 3. Actualizar la OT
          const updatedOt = await tx.workOrder.update({
            where: { id },
            data: {
              status: 'CLOSED',
              closedAt: new Date(),
            },
          });

          // 4. Actualizar el Equipo
          await tx.equipment.update({
            where: { id: workOrder.equipmentId },
            data: {
              currentHorometer: workOrder.finalHorometer,
            },
          });

          return updatedOt;
        });
      } else {
        const existing = await this.prisma.workOrder.findFirst({
          where,
        });
        if (!existing) throw new BadRequestException('Orden no encontrada');

        return await this.prisma.workOrder.update({
          where: { id },
          data: { status: status as any },
        });
      }
    } catch (error) {
      console.error('Error at WorkOrdersService.updateStatus:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al actualizar estado de la OT',
      );
    }
  }
}
