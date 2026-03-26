import {
  InternalServerErrorException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface CreateWorkOrderDto {
  equipmentId: string;
  warehouseId?: string;
  type: 'NUEVA' | 'CONTINUIDAD';
  category:
    | 'PROGRAMADA'
    | 'NO_PROGRAMADA_CORRECTIVA'
    | 'NO_PROGRAMADA_REACTIVA';
  maintenanceType: 'PREVENTIVO' | 'CORRECTIVO';
  initialMeter: number;
  finalMeter: number;
  description: string;
  responsible?: string;
  systems: string[];
  fluids: { fluidId: string; liters: number; action: 'RELLENO' | 'CAMBIO' }[];
  tasks?: {
    description: string;
    isCompleted: boolean;
    observation?: string;
    measurement?: number;
  }[];
  parts?: {
    partNumber: string;
    description: string;
    quantity: number;
    inventoryItemId?: string;
  }[];
  fluidSamples?: { systemId: string; bottleCode: string }[];
}

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(user: any, dto: CreateWorkOrderDto, activeContract?: string) {
    const tenantId = user.tenantId;

    try {
      // 0. Validar equipo
      const equipment = await this.prisma.equipment.findFirst({
        where: { id: dto.equipmentId, tenantId },
      });

      if (!equipment) {
        throw new BadRequestException(
          'El equipo especificado no existe o no tienes acceso a él.',
        );
      }

      // 0b. Validar bodega pertenece al contrato del equipo
      if (dto.warehouseId) {
        const equipContractId =
          equipment.contractId ||
          (equipment.subcontractId
            ? (
                await this.prisma.subcontract.findUnique({
                  where: { id: equipment.subcontractId },
                })
              )?.contractId
            : null);

        const warehouse = await this.prisma.warehouse.findFirst({
          where: {
            id: dto.warehouseId,
            tenantId,
            ...(equipContractId ? { contractId: equipContractId } : {}),
          },
        });

        if (!warehouse) {
          throw new BadRequestException(
            'La bodega seleccionada no es válida o no pertenece al contrato del equipo.',
          );
        }
      }

      // 1. Generar correlativo
      const year = new Date().getFullYear();
      const count = await this.prisma.workOrder.count({ where: { tenantId } });
      const correlative = `OT-${year}-${String(count + 1).padStart(3, '0')}`;

      // 2. Transacción atómica
      return await this.prisma.$transaction(async (tx: any) => {
        const workOrder = await tx.workOrder.create({
          data: {
            tenantId,
            subcontractId: equipment.subcontractId,
            warehouseId: dto.warehouseId || null,
            correlative,
            equipmentId: dto.equipmentId,
            type: dto.type,
            category: dto.category,
            maintenanceType: dto.maintenanceType,
            status: 'OPEN',
            initialMeter: dto.initialMeter,
            finalMeter: dto.finalMeter,
            description: dto.description,
            responsible: dto.responsible,
          },
        });

        if (dto.systems && dto.systems.length > 0) {
          await tx.workOrderSystem.createMany({
            data: dto.systems.map((systemId) => ({
              workOrderId: workOrder.id,
              catalogItemId: systemId,
            })),
          });
        }

        if (dto.fluids && dto.fluids.length > 0) {
          await tx.workOrderFluid.createMany({
            data: dto.fluids.map((f) => ({
              workOrderId: workOrder.id,
              catalogItemId: f.fluidId,
              liters: f.liters,
              action: f.action,
            })),
          });
        }

        if (dto.tasks && dto.tasks.length > 0) {
          await tx.workOrderTask.createMany({
            data: dto.tasks.map((t: any) => ({
              workOrderId: workOrder.id,
              description: t.description,
              isCompleted: t.isCompleted,
              observation: t.observation || null,
              measurement: t.measurement ? Number(t.measurement) : null,
            })),
          });
        }

        if (dto.parts && dto.parts.length > 0) {
          const partsData = [];
          const linkedPartsForReservation = [];

          for (const p of dto.parts) {
            let invItemId = p.inventoryItemId;

            // AUTO-ENLACE: Si no trae ID pero sí partNumber, lo buscamos en el catálogo maestro
            if (!invItemId) {
              const catalogItem = await tx.inventoryItem.findFirst({
                where: { tenantId, partNumber: p.partNumber },
              });
              if (catalogItem) invItemId = catalogItem.id;
            }

            partsData.push({
              workOrderId: workOrder.id,
              partNumber: p.partNumber,
              description: p.description,
              quantity: Number(p.quantity),
              inventoryItemId: invItemId || null,
            });

            // Si logramos enlazarlo, lo preparamos para la reserva de stock
            if (invItemId) {
              linkedPartsForReservation.push({
                itemId: invItemId,
                quantity: Number(p.quantity),
              });
            }
          }

          // Guardar las piezas en la OT
          await tx.workOrderPart.createMany({ data: partsData });

          // --- RESERVAS: Crear reservas iniciales si hay bodega ---
          if (dto.warehouseId && linkedPartsForReservation.length > 0) {
            await tx.stockReservation.createMany({
              data: linkedPartsForReservation.map((p) => ({
                workOrderId: workOrder.id,
                itemId: p.itemId,
                warehouseId: dto.warehouseId!,
                quantity: p.quantity,
              })),
            });
          }
        }

        if (dto.fluidSamples && dto.fluidSamples.length > 0) {
          await tx.fluidSample.createMany({
            data: dto.fluidSamples.map((fs: any) => ({
              workOrderId: workOrder.id,
              systemId: fs.systemId,
              bottleCode: fs.bottleCode,
              status: 'SENT_TO_LAB',
            })),
          });
        }

        return tx.workOrder.findUnique({
          where: { id: workOrder.id },
          include: {
            equipment: true,
            warehouse: true,
            systems: { include: { catalogItem: true } },
            fluids: { include: { catalogItem: true } },
            tasks: true,
            parts: { include: { inventoryItem: true } },
            fluidSamples: true,
          },
        });
      });
    } catch (error) {
      this.logger.error('Error at WorkOrdersService.create:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Error al crear la Orden de Trabajo',
      );
    }
  }

  async findAll(
    user: any,
    activeContract: string | undefined,
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
    const where: Prisma.WorkOrderWhereInput = { tenantId };
    const andConditions: Prisma.WorkOrderWhereInput[] = [];

    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        andConditions.push({
          equipment: {
            OR: [
              { contractId: activeContract },
              { subcontract: { contractId: activeContract } },
            ],
          },
        });
      }
    } else {
      andConditions.push({
        equipment: {
          OR: [
            { contractId: { in: user.allowedContracts || [] } },
            {
              subcontract: { contractId: { in: user.allowedContracts || [] } },
            },
          ],
        },
      });
    }

    if (query?.equipmentId)
      andConditions.push({ equipmentId: query.equipmentId });
    if (query?.status) andConditions.push({ status: query.status as any });

    if (query?.search) {
      andConditions.push({
        OR: [
          { correlative: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          {
            equipment: {
              internalId: { contains: query.search, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (query?.dateFrom || query?.dateTo) {
      const dateFilter: any = {};
      if (query?.dateFrom) dateFilter.gte = new Date(query.dateFrom);
      if (query?.dateTo) dateFilter.lte = new Date(query.dateTo + 'T23:59:59');
      andConditions.push({ createdAt: dateFilter });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
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
          equipment: {
            select: {
              internalId: true,
              type: true,
              brand: true,
              model: true,
              contract: { select: { name: true, code: true } },
              subcontract: { select: { name: true, code: true } },
            },
          },
          warehouse: { select: { code: true, name: true } },
          systems: { include: { catalogItem: { select: { name: true } } } },
          fluids: { include: { catalogItem: { select: { name: true } } } },
          subcontract: { select: { name: true, code: true } },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);

    return { data, total };
  }

  async getStats(user: any, activeContract?: string) {
    const now = new Date();
    const tenantId = user.tenantId;

    const filterEqConditions: Prisma.EquipmentWhereInput[] = [];
    const filterWoConditions: Prisma.WorkOrderWhereInput[] = [];

    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        const cFilter = {
          OR: [
            { contractId: activeContract },
            { subcontract: { contractId: activeContract } },
          ],
        };
        filterEqConditions.push(cFilter);
        filterWoConditions.push({ equipment: cFilter });
      }
    } else {
      const authFilter = {
        OR: [
          { contractId: { in: user.allowedContracts || [] } },
          { subcontract: { contractId: { in: user.allowedContracts || [] } } },
        ],
      };
      filterEqConditions.push(authFilter);
      filterWoConditions.push({ equipment: authFilter });
    }

    const whereBaseWO: Prisma.WorkOrderWhereInput = {
      tenantId,
      AND: filterWoConditions,
    };
    const whereBaseEq: Prisma.EquipmentWhereInput = {
      tenantId,
      AND: filterEqConditions,
    };

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

    const expiredDocs = await this.prisma.equipment.count({
      where: {
        ...whereBaseEq,
        OR: [{ techReviewExp: { lt: now } }, { circPermitExp: { lt: now } }],
      },
    });

    const totalEquipments = await this.prisma.equipment.count({
      where: whereBaseEq,
    });

    const activeOts = await this.prisma.workOrder.groupBy({
      by: ['equipmentId'],
      where: {
        ...whereBaseWO,
        status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
      },
    });
    const equiposEnMantenimientoCount = activeOts.length;

    const lastClosed = await this.prisma.workOrder.findMany({
      where: { ...whereBaseWO, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: 5,
      include: {
        equipment: { select: { internalId: true } },
      },
    });

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

  async findOne(user: any, id: string, activeContract?: string) {
    const tenantId = user.tenantId;
    const where: Prisma.WorkOrderWhereInput = { id, tenantId };
    const andConditions: Prisma.WorkOrderWhereInput[] = [];

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      andConditions.push({
        equipment: {
          OR: [
            { contractId: { in: user.allowedContracts || [] } },
            {
              subcontract: { contractId: { in: user.allowedContracts || [] } },
            },
          ],
        },
      });
    } else if (activeContract && activeContract !== 'ALL') {
      andConditions.push({
        equipment: {
          OR: [
            { contractId: activeContract },
            { subcontract: { contractId: activeContract } },
          ],
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return this.prisma.workOrder.findFirst({
      where,
      include: {
        equipment: {
          include: {
            contract: { select: { id: true, name: true, code: true } },
            subcontract: {
              select: {
                id: true,
                name: true,
                code: true,
                contractId: true,
              },
            },
          },
        },
        warehouse: true,
        systems: { include: { catalogItem: true } },
        fluids: { include: { catalogItem: true } },
        tasks: true,
        parts: { include: { inventoryItem: true } },
        fluidSamples: true,
        stockReservations: true,
      },
    });
  }

  async updateStatus(
    user: any,
    id: string,
    body: { status: string; warehouseId?: string },
    activeContract?: string,
  ) {
    const tenantId = user.tenantId;
    const { status, warehouseId } = body;
    const where: Prisma.WorkOrderWhereInput = { id, tenantId };
    const andConditions: Prisma.WorkOrderWhereInput[] = [];

    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      andConditions.push({
        equipment: {
          OR: [
            { contractId: { in: user.allowedContracts || [] } },
            {
              subcontract: { contractId: { in: user.allowedContracts || [] } },
            },
          ],
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const userId = user.id || user.sub;

    try {
      if (status === 'CLOSED') {
        return await this.prisma.$transaction(async (tx: any) => {
          const workOrder = await tx.workOrder.findFirst({
            where,
            include: {
              equipment: true,
              parts: true,
            },
          });

          if (!workOrder)
            throw new BadRequestException('Orden de Trabajo no encontrada');
          if (workOrder.status === 'CLOSED')
            throw new BadRequestException(
              'La Orden de Trabajo ya se encuentra CERRADA',
            );

          // --- VALIDACIÓN DE MEDIDOR CON SOPORTE DE MeterAdjustment ---
          if (workOrder.finalMeter < workOrder.initialMeter) {
            // Verificar si hay un ajuste de medidor reciente que justifique el reinicio
            const recentAdj = await tx.meterAdjustment.findFirst({
              where: { equipmentId: workOrder.equipmentId },
              orderBy: { date: 'desc' },
            });

            if (!recentAdj || recentAdj.newValue > workOrder.finalMeter) {
              throw new BadRequestException(
                `El medidor final (${workOrder.finalMeter}) es menor al inicial (${workOrder.initialMeter}). Registre un Ajuste de Medidor para justificar el reinicio del contador.`,
              );
            }
          }

          // --- CONSUMO DE INVENTARIO CON STOCK NEGATIVO PERMITIDO ---
          const linkedParts = workOrder.parts.filter(
            (p: any) => p.inventoryItemId,
          );

          const effectiveWarehouseId = warehouseId || workOrder.warehouseId;

          if (linkedParts.length > 0 && !effectiveWarehouseId) {
            throw new BadRequestException(
              'Debe seleccionar una bodega de origen para descontar los repuestos vinculados al catálogo.',
            );
          }

          const updateData: any = {
            status: 'CLOSED',
            closedAt: new Date(),
          };
          if (effectiveWarehouseId && !workOrder.warehouseId) {
            updateData.warehouseId = effectiveWarehouseId;
          }

          const updatedOt = await tx.workOrder.update({
            where: { id },
            data: updateData,
          });

          await tx.equipment.update({
            where: { id: workOrder.equipmentId },
            data: { currentMeter: workOrder.finalMeter },
          });

          // Procesar consumo — stock negativo PERMITIDO
          if (linkedParts.length > 0 && effectiveWarehouseId) {
            for (const part of linkedParts) {
              // Buscar o crear stock
              let currentStock = await tx.itemStock.findUnique({
                where: {
                  warehouseId_itemId: {
                    warehouseId: effectiveWarehouseId,
                    itemId: part.inventoryItemId,
                  },
                },
              });

              const previousQty = currentStock?.quantity || 0;
              const newQty = previousQty - part.quantity;
              const isPendingRegularization = newQty < 0;

              // Upsert stock (permite negativo)
              await tx.itemStock.upsert({
                where: {
                  warehouseId_itemId: {
                    warehouseId: effectiveWarehouseId,
                    itemId: part.inventoryItemId,
                  },
                },
                update: { quantity: newQty },
                create: {
                  warehouseId: effectiveWarehouseId,
                  itemId: part.inventoryItemId,
                  quantity: newQty,
                  unitCost: 0,
                },
              });

              // Generar registro OUT en el Kárdex
              await tx.inventoryTransaction.create({
                data: {
                  type: 'OUT',
                  quantity: part.quantity,
                  previousStock: previousQty,
                  newStock: newQty,
                  isPendingRegularization,
                  referenceId: workOrder.id,
                  referenceType: 'WORK_ORDER',
                  notes: `Consumo OT ${workOrder.correlative} - ${part.partNumber}${isPendingRegularization ? ' [STOCK NEGATIVO - REQUIERE REGULARIZACIÓN]' : ''}`,
                  warehouse: { connect: { id: effectiveWarehouseId } },
                  item: { connect: { id: part.inventoryItemId } },
                  user: { connect: { id: userId } },
                },
              });

              // [NUEVO] CONGELAR COSTO HISTÓRICO EN LA OT
              await tx.workOrderPart.update({
                where: { id: part.id },
                data: { unitCost: currentStock?.unitCost || 0 },
              });
            }
          }

          // --- LIMPIEZA DE RESERVAS ---
          await tx.stockReservation.deleteMany({
            where: { workOrderId: workOrder.id },
          });

          return updatedOt;
        });
      } else {
        const existing = await this.prisma.workOrder.findFirst({ where });
        if (!existing) throw new BadRequestException('Orden no encontrada');

        return await this.prisma.workOrder.update({
          where: { id },
          data: { status: status as any },
        });
      }
    } catch (error) {
      this.logger.error('Error at WorkOrdersService.updateStatus:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Error al actualizar estado de la OT',
      );
    }
  }
}
