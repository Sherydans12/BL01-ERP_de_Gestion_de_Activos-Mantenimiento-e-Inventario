import {
  InternalServerErrorException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Prisma,
  OtCategory,
  OtType,
  MaintenanceType,
  AvailabilityImpact,
  EquipmentWorkLocation,
  WorkShift,
  FluidCompartment,
  BacklogStatus,
  MeterLogSource,
} from '@prisma/client';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';
import Decimal from 'decimal.js';

function truncateForDb(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max);
}

/** Alineado a `frontend/.../pm-interval.ts` para KPI de próximo PM en dashboard. */
function intervalFromHeuristicBackend(
  type: string,
  model: string,
  meterType: string,
): number {
  const t = `${type || ''} ${model || ''}`.toLowerCase();
  const isKm = meterType === 'KILOMETERS';
  if (t.includes('camioneta') || t.includes('suv') || t.includes('pickup')) {
    return isKm ? 10000 : 250;
  }
  if (
    t.includes('carretera') ||
    t.includes('tracto') ||
    t.includes('alto tonelaje')
  ) {
    return 600;
  }
  if (t.includes('camión') || t.includes('camion') || t.includes('dumper')) {
    return 500;
  }
  return 250;
}

function resolvePmIntervalBackend(eq: {
  pmIntervalOverride: number | null;
  maintenanceFrequency: number | null;
  type: string;
  model: string;
  meterType: string;
}): number {
  if (eq.pmIntervalOverride != null && eq.pmIntervalOverride > 0) {
    return eq.pmIntervalOverride;
  }
  if (eq.maintenanceFrequency != null && eq.maintenanceFrequency > 0) {
    return eq.maintenanceFrequency;
  }
  return intervalFromHeuristicBackend(eq.type, eq.model, eq.meterType);
}

function pmRemainingBackend(eq: {
  initialMeter: number;
  currentMeter: number;
  lastMaintenanceMeter: number | null;
  pmIntervalOverride: number | null;
  maintenanceFrequency: number | null;
  type: string;
  model: string;
  meterType: string;
}): { remaining: number; interval: number; nextDue: number } {
  const interval = resolvePmIntervalBackend(eq);
  const base =
    eq.lastMaintenanceMeter != null
      ? eq.lastMaintenanceMeter
      : eq.initialMeter ?? 0;
  const current = eq.currentMeter ?? base;
  const nextDue = base + interval;
  const remaining = Math.max(0, nextDue - current);
  return { remaining, interval, nextDue };
}

function nearestLegalDocAlert(
  e: {
    techReviewExp: Date | null;
    circPermitExp: Date | null;
    soapExp: Date | null;
    mechanicalCertExp: Date | null;
    liabilityPolicyExp: Date | null;
  },
  now: Date,
): { daysRemaining: number; docLabel: string } {
  const pairs: { exp: Date; label: string }[] = [];
  if (e.techReviewExp)
    pairs.push({ exp: new Date(e.techReviewExp), label: 'Rev. técnica' });
  if (e.circPermitExp)
    pairs.push({ exp: new Date(e.circPermitExp), label: 'Perm. circulación' });
  if (e.soapExp) pairs.push({ exp: new Date(e.soapExp), label: 'SOAP' });
  if (e.mechanicalCertExp)
    pairs.push({ exp: new Date(e.mechanicalCertExp), label: 'Cert. mecánica' });
  if (e.liabilityPolicyExp)
    pairs.push({
      exp: new Date(e.liabilityPolicyExp),
      label: 'Póliza RC',
    });
  if (pairs.length === 0) return { daysRemaining: 999999, docLabel: '—' };
  let bestDays = 999999;
  let bestLabel = '—';
  for (const p of pairs) {
    const days = Math.ceil(
      (p.exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days < bestDays) {
      bestDays = days;
      bestLabel = p.label;
    }
  }
  return { daysRemaining: bestDays, docLabel: bestLabel };
}

function deriveCategoryFromTags(tags: string[] | undefined): OtCategory {
  const t = tags ?? [];
  if (t.includes('PROGRAMADA')) return 'PROGRAMADA';
  if (t.includes('NO_PROGRAMADA')) return 'NO_PROGRAMADA_CORRECTIVA';
  return 'NO_PROGRAMADA_REACTIVA';
}

function deriveOtTypeFromTags(tags: string[] | undefined): OtType {
  if ((tags ?? []).includes('OT_ABIERTA_CONTINUIDAD')) return 'CONTINUIDAD';
  return 'NUEVA';
}

function deriveMaintenanceTypeFromTags(
  tags: string[] | undefined,
): MaintenanceType {
  return (tags ?? []).includes('ACCIDENTE_INCIDENTE')
    ? 'CORRECTIVO'
    : 'PREVENTIVO';
}

interface CreateWorkOrderDto {
  equipmentId: string;
  warehouseId?: string;
  /** Legacy / derivado desde classificationTags si no viene */
  type?: 'NUEVA' | 'CONTINUIDAD';
  category?:
    | 'PROGRAMADA'
    | 'NO_PROGRAMADA_CORRECTIVA'
    | 'NO_PROGRAMADA_REACTIVA';
  maintenanceType?: 'PREVENTIVO' | 'CORRECTIVO';
  /** Si no viene, usa detención o lanza validación */
  initialMeter?: number;
  finalMeter?: number;
  /** Texto único legacy; también puede armarse desde workPerformedDescription */
  description?: string;
  responsible?: string;
  systems?: string[];
  fluids?: { fluidId: string; liters: number; action: 'RELLENO' | 'CAMBIO' }[];
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

  detentionStartedAt?: string;
  detentionEndedAt?: string;
  detentionInitialMeter?: number;
  detentionFinalMeter?: number;
  mechanicAttentionStartedAt?: string;
  mechanicAttentionEndedAt?: string;
  personnelQuantity?: number;
  clientAttributedStart?: string;
  clientAttributedEnd?: string;
  clientAttributedReason?: string;
  affectsAvailability?: AvailabilityImpact;
  classificationTags?: string[];
  workLocation?: EquipmentWorkLocation;
  metricHm?: number | string;
  metricHh?: number | string;
  workShift?: WorkShift;
  initialRequestDescription?: string;
  intervenedSystemsJson?: Prisma.InputJsonValue;
  symptomsText?: string;
  causeText?: string;
  workPerformedDescription?: string;
  techniciansNames?: string;
  responsibleMechanicName?: string;
  responsibleMechanicSignature?: string;
  shiftSupervisorName?: string;
  shiftSupervisorSignature?: string;
  pmCycleNumber?: number;
  fluidCompartments?: {
    compartment: FluidCompartment;
    fluidType: string;
    liters: number | string;
    action: 'RELLENO' | 'CAMBIO';
    inventoryItemId?: string | null;
  }[];
}

export interface UpdateWorkOrderDto {
  warehouseId?: string | null;
  detentionStartedAt?: string | null;
  detentionEndedAt?: string | null;
  detentionInitialMeter?: number | null;
  detentionFinalMeter?: number | null;
  mechanicAttentionStartedAt?: string | null;
  mechanicAttentionEndedAt?: string | null;
  personnelQuantity?: number | null;
  clientAttributedStart?: string | null;
  clientAttributedEnd?: string | null;
  clientAttributedReason?: string | null;
  affectsAvailability?: AvailabilityImpact | null;
  classificationTags?: string[];
  workLocation?: EquipmentWorkLocation | null;
  metricHm?: number | string | null;
  metricHh?: number | string | null;
  workShift?: WorkShift | null;
  initialRequestDescription?: string | null;
  intervenedSystemsJson?: Prisma.InputJsonValue | null;
  symptomsText?: string | null;
  causeText?: string | null;
  workPerformedDescription?: string | null;
  /** Legacy `work_orders.description` (sincronizado con workPerformedDescription si ambos vienen). */
  description?: string | null;
  techniciansNames?: string | null;
  responsibleMechanicName?: string | null;
  responsibleMechanicSignature?: string | null;
  shiftSupervisorName?: string | null;
  shiftSupervisorSignature?: string | null;
  pmCycleNumber?: number | null;
  responsible?: string | null;
  initialMeter?: number | null;
  finalMeter?: number | null;
  maintenanceType?: 'PREVENTIVO' | 'CORRECTIVO';
  category?:
    | 'PROGRAMADA'
    | 'NO_PROGRAMADA_CORRECTIVA'
    | 'NO_PROGRAMADA_REACTIVA';
  type?: 'NUEVA' | 'CONTINUIDAD';
  systems?: string[];
  fluids?: { fluidId: string; liters: number; action: 'RELLENO' | 'CAMBIO' }[];
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
  fluidCompartments?: {
    compartment: FluidCompartment;
    fluidType: string;
    liters: number | string;
    action: 'RELLENO' | 'CAMBIO';
    inventoryItemId?: string | null;
  }[];
}

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Filtro de equipo por contrato activo / permisos de usuario (OT y backlog). */
  private equipmentAccessWhere(
    user: any,
    activeContract?: string,
  ): Prisma.EquipmentWhereInput | undefined {
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        return {
          OR: [
            { contractId: activeContract },
            { subcontract: { contractId: activeContract } },
          ],
        };
      }
      return undefined;
    }
    return {
      OR: [
        { contractId: { in: user.allowedContracts || [] } },
        {
          subcontract: { contractId: { in: user.allowedContracts || [] } },
        },
      ],
    };
  }

  private workOrderAccessWhere(
    user: any,
    id: string,
    activeContract?: string,
  ): Prisma.WorkOrderWhereInput {
    const tenantId = user.tenantId;
    const where: Prisma.WorkOrderWhereInput = { id, tenantId };
    const eqFilter = this.equipmentAccessWhere(user, activeContract);
    if (eqFilter) {
      where.equipment = eqFilter;
    }
    return where;
  }

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

      const tags = dto.classificationTags ?? [];
      const derivedType = dto.type ?? deriveOtTypeFromTags(tags);
      const derivedCategory = dto.category ?? deriveCategoryFromTags(tags);
      const derivedMaintenanceType =
        dto.maintenanceType ??
        (tags.includes('ACCIDENTE_INCIDENTE') ? 'CORRECTIVO' : 'PREVENTIVO');

      const ini = Number(
        dto.detentionInitialMeter ?? dto.initialMeter ?? NaN,
      );
      const finRaw = dto.detentionFinalMeter ?? dto.finalMeter;
      let fin: number | null = null;
      if (finRaw !== undefined && finRaw !== null && `${finRaw}`.trim() !== '') {
        const n = Number(finRaw);
        if (Number.isNaN(n)) {
          throw new BadRequestException(
            'La medición final debe ser numérica válida cuando se informa.',
          );
        }
        fin = n;
      }
      if (Number.isNaN(ini)) {
        throw new BadRequestException(
          'Debe indicar medición inicial (detención u horómetro).',
        );
      }

      let personnelQty = 1;
      if (dto.personnelQuantity != null) {
        const pq = Number(dto.personnelQuantity);
        if (!Number.isNaN(pq)) personnelQty = Math.max(1, Math.trunc(pq));
      }

      const narrative =
        (dto.workPerformedDescription ?? '').trim() ||
        (dto.description ?? '').trim() ||
        (dto.initialRequestDescription ?? '').trim();
      if (!narrative) {
        throw new BadRequestException(
          'Debe completar la descripción del trabajo o la solicitud inicial.',
        );
      }

      const descForLegacyField =
        (dto.workPerformedDescription ?? '').trim() ||
        (dto.description ?? '').trim() ||
        narrative;

      const parseOptDate = (s?: string) =>
        s && String(s).trim() ? new Date(s) : undefined;

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
            type: derivedType,
            category: derivedCategory,
            maintenanceType: derivedMaintenanceType,
            status: 'OPEN',
            initialMeter: ini,
            finalMeter: fin,
            description: descForLegacyField,
            responsible: dto.responsibleMechanicName ?? dto.responsible,
            detentionStartedAt: parseOptDate(dto.detentionStartedAt) ?? null,
            detentionEndedAt: parseOptDate(dto.detentionEndedAt) ?? null,
            detentionInitialMeter: ini,
            detentionFinalMeter: fin,
            mechanicAttentionStartedAt:
              parseOptDate(dto.mechanicAttentionStartedAt) ?? null,
            mechanicAttentionEndedAt:
              parseOptDate(dto.mechanicAttentionEndedAt) ?? null,
            personnelQuantity: personnelQty,
            clientAttributedStart: parseOptDate(dto.clientAttributedStart)
              ? new Date(dto.clientAttributedStart!)
              : null,
            clientAttributedEnd: parseOptDate(dto.clientAttributedEnd)
              ? new Date(dto.clientAttributedEnd!)
              : null,
            clientAttributedReason: dto.clientAttributedReason?.trim() || null,
            affectsAvailability: dto.affectsAvailability ?? null,
            classificationTags: tags,
            workLocation: dto.workLocation ?? null,
            metricHm:
              dto.metricHm !== undefined && dto.metricHm !== ''
                ? new Prisma.Decimal(String(dto.metricHm))
                : null,
            metricHh:
              dto.metricHh !== undefined && dto.metricHh !== ''
                ? new Prisma.Decimal(String(dto.metricHh))
                : null,
            workShift: dto.workShift ?? null,
            initialRequestDescription:
              dto.initialRequestDescription?.trim() || null,
            intervenedSystemsJson: dto.intervenedSystemsJson ?? undefined,
            symptomsText: dto.symptomsText?.trim() || null,
            causeText: dto.causeText?.trim() || null,
            workPerformedDescription:
              dto.workPerformedDescription?.trim() || null,
            techniciansNames: dto.techniciansNames?.trim() || null,
            responsibleMechanicName:
              dto.responsibleMechanicName?.trim() || null,
            responsibleMechanicSignature:
              dto.responsibleMechanicSignature?.trim() || null,
            shiftSupervisorName: dto.shiftSupervisorName?.trim() || null,
            shiftSupervisorSignature:
              dto.shiftSupervisorSignature?.trim() || null,
            pmCycleNumber:
              dto.pmCycleNumber != null
                ? Math.min(4, Math.max(1, Math.trunc(dto.pmCycleNumber)))
                : null,
          },
        });

        if (dto.fluidCompartments && dto.fluidCompartments.length > 0) {
          const fluidRows: Prisma.WorkOrderFluidCompartmentCreateManyInput[] =
            [];
          for (const fc of dto.fluidCompartments) {
            const invId = fc.inventoryItemId?.trim();
            if (!invId) {
              throw new BadRequestException(
                'Cada fluido por compartimiento debe estar vinculado a un ítem del inventario de la empresa.',
              );
            }
            const fluidItem = await tx.inventoryItem.findFirst({
              where: { id: invId, tenantId },
              select: { id: true, partNumber: true, name: true },
            });
            if (!fluidItem) {
              throw new BadRequestException(
                'Un ítem de fluido no existe o no pertenece a su empresa.',
              );
            }
            fluidRows.push({
              workOrderId: workOrder.id,
              compartment: fc.compartment,
              fluidType: truncateForDb(
                `${fluidItem.partNumber} — ${fluidItem.name}`,
                200,
              ),
              liters: new Prisma.Decimal(String(fc.liters)),
              action: fc.action,
              inventoryItemId: fluidItem.id,
            });
          }
          await tx.workOrderFluidCompartment.createMany({ data: fluidRows });
        }

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
          const partsData: Prisma.WorkOrderPartCreateManyInput[] = [];
          const linkedPartsForReservation: {
            itemId: string;
            quantity: number;
          }[] = [];

          for (const p of dto.parts) {
            const invItemId = p.inventoryItemId?.trim();
            if (!invItemId) {
              throw new BadRequestException(
                'Toda línea de repuesto debe estar vinculada a un ítem del inventario de la empresa (use el buscador de catálogo).',
              );
            }
            const inv = await tx.inventoryItem.findFirst({
              where: { id: invItemId, tenantId },
              select: { id: true, partNumber: true, name: true },
            });
            if (!inv) {
              throw new BadRequestException(
                'Un repuesto no existe o no pertenece a su empresa.',
              );
            }
            partsData.push({
              workOrderId: workOrder.id,
              partNumber: inv.partNumber,
              description: truncateForDb(inv.name, 100),
              quantity: Number(p.quantity),
              inventoryItemId: inv.id,
            });
            linkedPartsForReservation.push({
              itemId: inv.id,
              quantity: Number(p.quantity),
            });
          }

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
            fluidCompartments: {
              include: {
                inventoryItem: {
                  select: {
                    id: true,
                    partNumber: true,
                    name: true,
                    isInventory: true,
                  },
                },
              },
            },
            tasks: true,
            parts: { include: { inventoryItem: true } },
            fluidSamples: true,
            backlogItems: true,
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
          purchaseOrders: { select: { id: true, correlative: true } },
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

    const contractScope =
      user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
        ? activeContract && activeContract !== 'ALL'
          ? { contractId: activeContract }
          : {}
        : { contractId: { in: user.allowedContracts || [] } };

    const stockWarehouseWhere: Prisma.WarehouseWhereInput = {
      tenantId,
      ...contractScope,
    };

    const [
      open,
      inProgress,
      onHold,
      closed,
      expiredDocs,
      totalEquipments,
      activeOts,
      lastClosed,
      topAlertsData,
      equipmentForPm,
      openOtsHot,
      requisitionsAttention,
      purchaseOrdersInbound,
      requisitionPipelineCount,
      poAwaitingInboundCount,
      itemStockCandidates,
    ] = await Promise.all([
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
      this.prisma.equipment.count({
        where: {
          ...whereBaseEq,
          OR: [
            { techReviewExp: { lt: now } },
            { circPermitExp: { lt: now } },
            { soapExp: { lt: now } },
            { mechanicalCertExp: { lt: now } },
            { liabilityPolicyExp: { lt: now } },
          ],
        },
      }),
      this.prisma.equipment.count({ where: whereBaseEq }),
      this.prisma.workOrder.groupBy({
        by: ['equipmentId'],
        where: {
          ...whereBaseWO,
          status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
        },
      }),
      this.prisma.workOrder.findMany({
        where: { ...whereBaseWO, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        take: 4,
        include: {
          equipment: { select: { internalId: true } },
        },
      }),
      this.prisma.equipment.findMany({
        where: {
          ...whereBaseEq,
          OR: [
            { techReviewExp: { not: null } },
            { circPermitExp: { not: null } },
            { soapExp: { not: null } },
            { mechanicalCertExp: { not: null } },
            { liabilityPolicyExp: { not: null } },
          ],
        },
        take: 48,
      }),
      this.prisma.equipment.findMany({
        where: whereBaseEq,
        select: {
          id: true,
          internalId: true,
          plate: true,
          meterType: true,
          initialMeter: true,
          currentMeter: true,
          lastMaintenanceMeter: true,
          pmIntervalOverride: true,
          maintenanceFrequency: true,
          type: true,
          model: true,
        },
        take: 320,
      }),
      this.prisma.workOrder.findMany({
        where: {
          ...whereBaseWO,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 6,
        select: {
          id: true,
          correlative: true,
          status: true,
          createdAt: true,
          equipment: { select: { internalId: true, type: true } },
        },
      }),
      this.prisma.purchaseRequisition.findMany({
        where: {
          tenantId,
          ...contractScope,
          status: {
            in: [
              'SUBMITTED',
              'QUOTING',
              'PENDING_APPROVAL',
              'PARTIALLY_PURCHASED',
            ],
          },
        },
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
        select: {
          id: true,
          correlative: true,
          status: true,
          priority: true,
          updatedAt: true,
        },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          tenantId,
          ...contractScope,
          status: {
            in: [
              'PENDING_APPROVAL',
              'PARTIALLY_APPROVED',
              'APPROVED',
              'ORDERED',
              'SENT',
              'SENT_TO_SUPPLIER',
              'PARTIALLY_RECEIVED',
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          correlative: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.prisma.purchaseRequisition.count({
        where: {
          tenantId,
          ...contractScope,
          status: {
            in: [
              'SUBMITTED',
              'QUOTING',
              'PENDING_APPROVAL',
              'PARTIALLY_PURCHASED',
            ],
          },
        },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          tenantId,
          ...contractScope,
          status: {
            in: ['ORDERED', 'SENT', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED'],
          },
        },
      }),
      this.prisma.itemStock.findMany({
        where: {
          minStock: { gt: 0 },
          warehouse: stockWarehouseWhere,
        },
        include: {
          item: { select: { partNumber: true, name: true } },
          warehouse: { select: { code: true, name: true } },
        },
        take: 150,
      }),
    ]);

    const equiposEnMantenimientoCount = activeOts.length;

    const alerts = topAlertsData
      .map((e: any) => {
        const { daysRemaining, docLabel } = nearestLegalDocAlert(e, now);
        return {
          id: e.id,
          internalId: e.internalId,
          plate: e.plate,
          daysRemaining,
          docLabel,
        };
      })
      .filter((a: { daysRemaining: number }) => a.daysRemaining < 999999)
      .sort((a: any, b: any) => a.daysRemaining - b.daysRemaining)
      .slice(0, 6);

    const legalAttention30d = alerts.filter((a) => a.daysRemaining <= 30).length;

    const pmDueSoon = equipmentForPm
      .map((e) => {
        const { remaining, interval, nextDue } = pmRemainingBackend(e);
        return {
          id: e.id,
          internalId: e.internalId,
          plate: e.plate,
          meterType: e.meterType,
          remainingUnits: remaining,
          interval,
          nextDueMeter: nextDue,
          urgencyPct:
            interval > 0
              ? Math.min(100, Math.round(((interval - remaining) / interval) * 100))
              : 0,
        };
      })
      .sort((a, b) => a.remainingUnits - b.remainingUnits)
      .slice(0, 6);

    const lowStocks = itemStockCandidates
      .filter((s) => s.quantity < s.minStock)
      .sort((a, b) => a.quantity / a.minStock - b.quantity / b.minStock)
      .slice(0, 8)
      .map((s) => ({
        warehouseCode: s.warehouse.code,
        partNumber: s.item.partNumber,
        name: s.item.name,
        quantity: s.quantity,
        minStock: s.minStock,
      }));

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
      /** KPIs agregados (dashboard principal) */
      kpiStrip: {
        activeOts: open + inProgress,
        legalDocsAttention30d: legalAttention30d,
        lowStockLines: lowStocks.length,
        requisitionsPipeline: requisitionPipelineCount,
        purchaseOrdersInbound: poAwaitingInboundCount,
      },
      pmDueSoon,
      openOtsHot,
      purchaseRequisitionsAttention: requisitionsAttention,
      purchaseOrdersInbound,
      lowStocks,
    };
  }

  async findOne(user: any, id: string, activeContract?: string) {
    const where = this.workOrderAccessWhere(user, id, activeContract);

    return this.prisma.workOrder.findFirst({
      where,
      include: {
        subcontract: { select: { id: true, name: true, code: true } },
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
        fluidSamples: {
          include: { system: { select: { id: true, name: true } } },
        },
        fluidCompartments: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                partNumber: true,
                name: true,
                isInventory: true,
              },
            },
          },
        },
        backlogItems: true,
        stockReservations: true,
        purchaseRequisitions: {
          select: { id: true, correlative: true, status: true },
        },
        purchaseOrders: {
          select: { id: true, correlative: true, status: true },
        },
      },
    });
  }

  async update(
    user: any,
    id: string,
    dto: UpdateWorkOrderDto,
    activeContract?: string,
  ) {
    const where = this.workOrderAccessWhere(user, id, activeContract);
    const existing = await this.prisma.workOrder.findFirst({ where });
    if (!existing) {
      throw new BadRequestException('Orden de Trabajo no encontrada');
    }
    if (existing.status === 'CLOSED') {
      throw new BadRequestException('No se puede editar una OT cerrada.');
    }

    const parseOptDate = (s?: string | null) =>
      s && String(s).trim() ? new Date(s) : null;

    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const data: Prisma.WorkOrderUpdateInput = {};

        if (dto.warehouseId !== undefined) {
          data.warehouse = dto.warehouseId
            ? { connect: { id: dto.warehouseId } }
            : { disconnect: true };
        }
        if (dto.detentionStartedAt !== undefined) {
          data.detentionStartedAt = parseOptDate(dto.detentionStartedAt);
        }
        if (dto.detentionEndedAt !== undefined) {
          data.detentionEndedAt = parseOptDate(dto.detentionEndedAt);
        }
        if (dto.detentionInitialMeter !== undefined) {
          data.detentionInitialMeter = dto.detentionInitialMeter;
          if (dto.detentionInitialMeter != null) {
            data.initialMeter = dto.detentionInitialMeter;
          }
        }
        if (dto.detentionFinalMeter !== undefined) {
          data.detentionFinalMeter = dto.detentionFinalMeter;
          if (dto.detentionFinalMeter != null) {
            data.finalMeter = dto.detentionFinalMeter;
          }
        }
        if (dto.mechanicAttentionStartedAt !== undefined) {
          data.mechanicAttentionStartedAt = parseOptDate(
            dto.mechanicAttentionStartedAt,
          );
        }
        if (dto.mechanicAttentionEndedAt !== undefined) {
          data.mechanicAttentionEndedAt = parseOptDate(
            dto.mechanicAttentionEndedAt,
          );
        }
        if (dto.personnelQuantity !== undefined) {
          if (dto.personnelQuantity === null) {
            data.personnelQuantity = 1;
          } else {
            const pq = Number(dto.personnelQuantity);
            data.personnelQuantity = Number.isNaN(pq)
              ? 1
              : Math.max(1, Math.trunc(pq));
          }
        }
        if (dto.clientAttributedStart !== undefined) {
          data.clientAttributedStart = parseOptDate(dto.clientAttributedStart);
        }
        if (dto.clientAttributedEnd !== undefined) {
          data.clientAttributedEnd = parseOptDate(dto.clientAttributedEnd);
        }
        if (dto.clientAttributedReason !== undefined) {
          data.clientAttributedReason = dto.clientAttributedReason;
        }
        if (dto.affectsAvailability !== undefined) {
          data.affectsAvailability = dto.affectsAvailability;
        }
        if (dto.classificationTags !== undefined) {
          data.classificationTags = dto.classificationTags;
          const tags = dto.classificationTags ?? [];
          data.category = deriveCategoryFromTags(tags);
          data.type = deriveOtTypeFromTags(tags);
          data.maintenanceType = deriveMaintenanceTypeFromTags(tags);
        }
        if (dto.workLocation !== undefined) {
          data.workLocation = dto.workLocation;
        }
        if (dto.metricHm !== undefined) {
          data.metricHm =
            dto.metricHm !== null && dto.metricHm !== ''
              ? new Prisma.Decimal(String(dto.metricHm))
              : null;
        }
        if (dto.metricHh !== undefined) {
          data.metricHh =
            dto.metricHh !== null && dto.metricHh !== ''
              ? new Prisma.Decimal(String(dto.metricHh))
              : null;
        }
        if (dto.workShift !== undefined) {
          data.workShift = dto.workShift;
        }
        if (dto.initialRequestDescription !== undefined) {
          data.initialRequestDescription = dto.initialRequestDescription;
        }
        if (dto.intervenedSystemsJson !== undefined) {
          data.intervenedSystemsJson =
            dto.intervenedSystemsJson === null
              ? Prisma.JsonNull
              : (dto.intervenedSystemsJson as Prisma.InputJsonValue);
        }
        if (dto.symptomsText !== undefined) {
          data.symptomsText = dto.symptomsText;
        }
        if (dto.causeText !== undefined) {
          data.causeText = dto.causeText;
        }
        if (dto.workPerformedDescription !== undefined) {
          data.workPerformedDescription = dto.workPerformedDescription;
        }
        if (dto.techniciansNames !== undefined) {
          data.techniciansNames = dto.techniciansNames;
        }
        if (dto.responsibleMechanicName !== undefined) {
          data.responsibleMechanicName = dto.responsibleMechanicName;
        }
        if (dto.responsibleMechanicSignature !== undefined) {
          data.responsibleMechanicSignature = dto.responsibleMechanicSignature;
        }
        if (dto.shiftSupervisorName !== undefined) {
          data.shiftSupervisorName = dto.shiftSupervisorName;
        }
        if (dto.shiftSupervisorSignature !== undefined) {
          data.shiftSupervisorSignature = dto.shiftSupervisorSignature;
        }
        if (dto.pmCycleNumber !== undefined) {
          data.pmCycleNumber =
            dto.pmCycleNumber != null
              ? Math.min(4, Math.max(1, Math.trunc(dto.pmCycleNumber)))
              : null;
        }
        if (dto.responsible !== undefined) {
          data.responsible = dto.responsible;
        }
        if (dto.initialMeter !== undefined) {
          data.initialMeter = dto.initialMeter ?? undefined;
        }
        if (dto.finalMeter !== undefined) {
          data.finalMeter = dto.finalMeter ?? undefined;
        }
        if (dto.classificationTags === undefined) {
          if (dto.maintenanceType !== undefined) {
            data.maintenanceType = dto.maintenanceType;
          }
          if (dto.category !== undefined) {
            data.category = dto.category;
          }
          if (dto.type !== undefined) {
            data.type = dto.type;
          }
        }

        if (dto.workPerformedDescription !== undefined || dto.description !== undefined) {
          const legacyDesc =
            (dto.workPerformedDescription ?? '').toString().trim() ||
            (dto.description ?? '').toString().trim();
          if (legacyDesc) {
            data.description = legacyDesc;
          }
        }

        if (Object.keys(data).length > 0) {
          await tx.workOrder.update({ where: { id }, data });
        }

        if (dto.systems !== undefined) {
          await tx.workOrderSystem.deleteMany({ where: { workOrderId: id } });
          if (dto.systems.length > 0) {
            await tx.workOrderSystem.createMany({
              data: dto.systems.map((systemId) => ({
                workOrderId: id,
                catalogItemId: systemId,
              })),
            });
          }
        }

        if (dto.fluidCompartments !== undefined) {
          await tx.workOrderFluidCompartment.deleteMany({
            where: { workOrderId: id },
          });
          if (dto.fluidCompartments.length > 0) {
            const fluidRows: Prisma.WorkOrderFluidCompartmentCreateManyInput[] =
              [];
            for (const fc of dto.fluidCompartments) {
              const invId = fc.inventoryItemId?.trim();
              if (!invId) {
                throw new BadRequestException(
                  'Cada fluido por compartimiento debe estar vinculado a un ítem del inventario de la empresa.',
                );
              }
              const fluidItem = await tx.inventoryItem.findFirst({
                where: { id: invId, tenantId: user.tenantId },
                select: { id: true, partNumber: true, name: true },
              });
              if (!fluidItem) {
                throw new BadRequestException(
                  'Un ítem de fluido no existe o no pertenece a su empresa.',
                );
              }
              fluidRows.push({
                workOrderId: id,
                compartment: fc.compartment,
                fluidType: truncateForDb(
                  `${fluidItem.partNumber} — ${fluidItem.name}`,
                  200,
                ),
                liters: new Prisma.Decimal(String(fc.liters)),
                action: fc.action,
                inventoryItemId: fluidItem.id,
              });
            }
            await tx.workOrderFluidCompartment.createMany({ data: fluidRows });
          }
        }

        if (dto.parts !== undefined) {
          const tenantId = user.tenantId;
          await tx.stockReservation.deleteMany({ where: { workOrderId: id } });
          await tx.workOrderPart.deleteMany({ where: { workOrderId: id } });

          const whRow = await tx.workOrder.findUnique({
            where: { id },
            select: { warehouseId: true },
          });
          const whEffective = whRow?.warehouseId ?? undefined;

          if (dto.parts.length > 0) {
            const partsData: any[] = [];
            const linkedPartsForReservation: {
              itemId: string;
              quantity: number;
            }[] = [];

            for (const p of dto.parts) {
              const invItemId = p.inventoryItemId?.trim();
              if (!invItemId) {
                throw new BadRequestException(
                  'Toda línea de repuesto debe estar vinculada a un ítem del inventario de la empresa (use el buscador de catálogo).',
                );
              }
              const inv = await tx.inventoryItem.findFirst({
                where: { id: invItemId, tenantId },
                select: { id: true, partNumber: true, name: true },
              });
              if (!inv) {
                throw new BadRequestException(
                  'Un repuesto no existe o no pertenece a su empresa.',
                );
              }
              partsData.push({
                workOrderId: id,
                partNumber: inv.partNumber,
                description: truncateForDb(inv.name, 100),
                quantity: Number(p.quantity),
                inventoryItemId: inv.id,
              });
              linkedPartsForReservation.push({
                itemId: inv.id,
                quantity: Number(p.quantity),
              });
            }

            await tx.workOrderPart.createMany({ data: partsData });

            if (whEffective && linkedPartsForReservation.length > 0) {
              await tx.stockReservation.createMany({
                data: linkedPartsForReservation.map((p) => ({
                  workOrderId: id,
                  itemId: p.itemId,
                  warehouseId: whEffective,
                  quantity: p.quantity,
                })),
              });
            }
          }
        }

        return tx.workOrder.findFirst({
          where: { id },
          include: {
            subcontract: { select: { id: true, name: true, code: true } },
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
            fluidCompartments: {
              include: {
                inventoryItem: {
                  select: {
                    id: true,
                    partNumber: true,
                    name: true,
                    isInventory: true,
                  },
                },
              },
            },
            tasks: true,
            parts: { include: { inventoryItem: true } },
            fluidSamples: {
              include: { system: { select: { id: true, name: true } } },
            },
            backlogItems: true,
            stockReservations: true,
            purchaseRequisitions: {
              select: { id: true, correlative: true, status: true },
            },
            purchaseOrders: {
              select: { id: true, correlative: true, status: true },
            },
          },
        });
      });
    } catch (error) {
      this.logger.error('Error at WorkOrdersService.update:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error al actualizar la OT');
    }
  }

  async listBacklog(
    user: any,
    activeContract?: string,
    status?: BacklogStatus,
    query?: { limit?: number; offset?: number; search?: string },
  ) {
    const limit = Math.min(500, Math.max(1, query?.limit ?? 100));
    const offset = Math.max(0, query?.offset ?? 0);
    const search = query?.search?.trim();

    const tenantId = user.tenantId;
    const eqFilter = this.equipmentAccessWhere(user, activeContract);

    const where: Prisma.WorkOrderBacklogItemWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(eqFilter ? { workOrder: { equipment: eqFilter } } : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              {
                workOrder: {
                  correlative: { contains: search, mode: 'insensitive' },
                },
              },
              {
                workOrder: {
                  equipment: {
                    internalId: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.workOrderBacklogItem.findMany({
        where,
        include: {
          workOrder: {
            select: {
              id: true,
              correlative: true,
              status: true,
              equipment: {
                select: { internalId: true, brand: true, model: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.workOrderBacklogItem.count({ where }),
    ]);

    return { data, total, limit, offset };
  }

  async addBacklogItem(
    user: any,
    workOrderId: string,
    description: string,
    activeContract?: string,
  ) {
    const text = description?.trim();
    if (!text) {
      throw new BadRequestException('La descripción del backlog es obligatoria.');
    }

    const where = this.workOrderAccessWhere(user, workOrderId, activeContract);
    const wo = await this.prisma.workOrder.findFirst({ where });
    if (!wo) {
      throw new BadRequestException('Orden de Trabajo no encontrada');
    }

    const item = await this.prisma.workOrderBacklogItem.create({
      data: {
        tenantId: user.tenantId,
        workOrderId,
        description: text,
      },
    });

    await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: { hasBacklog: true },
    });

    return item;
  }

  async patchBacklogItem(
    user: any,
    workOrderId: string,
    itemId: string,
    body: { status: BacklogStatus },
    activeContract?: string,
  ) {
    const where = this.workOrderAccessWhere(user, workOrderId, activeContract);
    const wo = await this.prisma.workOrder.findFirst({ where });
    if (!wo) {
      throw new BadRequestException('Orden de Trabajo no encontrada');
    }

    const item = await this.prisma.workOrderBacklogItem.findFirst({
      where: { id: itemId, workOrderId, tenantId: user.tenantId },
    });
    if (!item) {
      throw new BadRequestException('Ítem de backlog no encontrado');
    }

    return this.prisma.workOrderBacklogItem.update({
      where: { id: itemId },
      data: { status: body.status },
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
    const where = this.workOrderAccessWhere(user, id, activeContract);

    const userId = user.id || user.sub;

    try {
      if (status === 'CLOSED') {
        return await this.prisma.$transaction(
          async (tx: any) => {
            const workOrder = await tx.workOrder.findFirst({
              where,
              include: {
                equipment: true,
                parts: {
                  include: { inventoryItem: { select: { isInventory: true } } },
                },
                fluidCompartments: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true,
                        partNumber: true,
                        isInventory: true,
                      },
                    },
                  },
                },
              },
            });

            if (!workOrder)
              throw new BadRequestException('Orden de Trabajo no encontrada');
            if (workOrder.status === 'CLOSED')
              throw new BadRequestException(
                'La Orden de Trabajo ya se encuentra CERRADA',
              );

            if (
              !workOrder.detentionStartedAt ||
              !workOrder.detentionEndedAt
            ) {
              throw new BadRequestException(
                'Para cerrar la OT debe registrar inicio y fin de detención.',
              );
            }

            const detMs =
              workOrder.detentionEndedAt.getTime() -
              workOrder.detentionStartedAt.getTime();
            if (detMs < 0) {
              throw new BadRequestException(
                'La fecha de fin de detención debe ser posterior al inicio.',
              );
            }

            const hmHours = detMs / (1000 * 60 * 60);

            if (
              !workOrder.mechanicAttentionStartedAt ||
              !workOrder.mechanicAttentionEndedAt
            ) {
              throw new BadRequestException(
                'Para cerrar la OT debe registrar atención mecánica (desde / hasta).',
              );
            }

            const mechMs =
              workOrder.mechanicAttentionEndedAt.getTime() -
              workOrder.mechanicAttentionStartedAt.getTime();
            if (mechMs < 0) {
              throw new BadRequestException(
                'La fecha de fin de atención mecánica debe ser posterior al inicio.',
              );
            }

            const pq = Math.max(1, workOrder.personnelQuantity ?? 1);
            const hhHours = hmHours * pq;

            if (
              workOrder.finalMeter != null &&
              workOrder.finalMeter < workOrder.initialMeter
            ) {
              const recentAdj = await tx.meterAdjustment.findFirst({
                where: { equipmentId: workOrder.equipmentId },
                orderBy: { date: 'desc' },
              });

              if (
                !recentAdj ||
                recentAdj.newValue > workOrder.finalMeter!
              ) {
                throw new BadRequestException(
                  `El medidor final (${workOrder.finalMeter}) es menor al inicial (${workOrder.initialMeter}). Registre un Ajuste de Medidor para justificar el reinicio del contador.`,
                );
              }
            }

            const inventoryParts = workOrder.parts.filter(
              (p: any) => p.inventoryItemId && p.inventoryItem?.isInventory,
            );

            const inventoryFluids = workOrder.fluidCompartments.filter(
              (f: any) =>
                f.inventoryItemId &&
                Number(f.liters) > 0 &&
                f.inventoryItem?.isInventory,
            );

            const effectiveWarehouseId = warehouseId || workOrder.warehouseId;

            if (
              (inventoryParts.length > 0 || inventoryFluids.length > 0) &&
              !effectiveWarehouseId
            ) {
              throw new BadRequestException(
                'Debe seleccionar una bodega de origen para descontar repuestos y fluidos vinculados al catálogo.',
              );
            }

            const updateData: any = {
              status: 'CLOSED',
              closedAt: new Date(),
              metricHm: new Prisma.Decimal(String(hmHours.toFixed(4))),
              metricHh: new Prisma.Decimal(String(hhHours.toFixed(4))),
            };
            if (effectiveWarehouseId && !workOrder.warehouseId) {
              updateData.warehouseId = effectiveWarehouseId;
            }

            const updatedOt = await tx.workOrder.update({
              where: { id },
              data: updateData,
            });

            if (workOrder.finalMeter != null) {
              await applyCurrentMeterChange(tx, {
                tenantId,
                equipmentId: workOrder.equipmentId,
                oldMeter: workOrder.equipment.currentMeter,
                newMeter: workOrder.finalMeter,
                source: MeterLogSource.OT,
                sourceId: workOrder.id,
                userId,
              });
            }

            let totalConsumableCost = new Decimal(0);

            if (inventoryParts.length > 0 && effectiveWarehouseId) {
              for (const part of inventoryParts) {
                const currentStock = await tx.itemStock.findUnique({
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

                const frozenUnitCost = Number(currentStock?.unitCost ?? 0);

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

                await tx.inventoryTransaction.create({
                  data: {
                    type: 'WORK_ORDER_ISSUE',
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

                await tx.workOrderPart.update({
                  where: { id: part.id },
                  data: { unitCost: frozenUnitCost },
                });

                totalConsumableCost = totalConsumableCost.plus(
                  new Decimal(part.quantity).mul(new Decimal(frozenUnitCost)),
                );
              }
            }

            if (inventoryFluids.length > 0 && effectiveWarehouseId) {
              for (const fc of inventoryFluids) {
                const qty = Number(fc.liters);
                const itemId = fc.inventoryItemId as string;

                const currentStock = await tx.itemStock.findUnique({
                  where: {
                    warehouseId_itemId: {
                      warehouseId: effectiveWarehouseId,
                      itemId,
                    },
                  },
                });

                const previousQty = currentStock?.quantity || 0;
                const newQty = previousQty - qty;
                const isPendingRegularization = newQty < 0;
                const frozenUnitCost = Number(currentStock?.unitCost ?? 0);
                const pn =
                  fc.inventoryItem?.partNumber ?? fc.fluidType ?? 'fluid';

                await tx.itemStock.upsert({
                  where: {
                    warehouseId_itemId: {
                      warehouseId: effectiveWarehouseId,
                      itemId,
                    },
                  },
                  update: { quantity: newQty },
                  create: {
                    warehouseId: effectiveWarehouseId,
                    itemId,
                    quantity: newQty,
                    unitCost: 0,
                  },
                });

                await tx.inventoryTransaction.create({
                  data: {
                    type: 'WORK_ORDER_ISSUE',
                    quantity: qty,
                    previousStock: previousQty,
                    newStock: newQty,
                    isPendingRegularization,
                    referenceId: workOrder.id,
                    referenceType: 'WORK_ORDER',
                    notes: `Consumo fluido OT ${workOrder.correlative} (${fc.compartment}) — ${pn}${isPendingRegularization ? ' [STOCK NEGATIVO - REQUIERE REGULARIZACIÓN]' : ''}`,
                    warehouse: { connect: { id: effectiveWarehouseId } },
                    item: { connect: { id: itemId } },
                    user: { connect: { id: userId } },
                  },
                });

                totalConsumableCost = totalConsumableCost.plus(
                  new Decimal(qty).mul(new Decimal(frozenUnitCost)),
                );
              }
            }

            if (totalConsumableCost.greaterThan(0)) {
              await tx.assetCostRecord.create({
                data: {
                  tenantId: workOrder.tenantId,
                  equipmentId: workOrder.equipmentId,
                  amount: totalConsumableCost.toFixed(2),
                  type: 'WORK_ORDER',
                  workOrderId: workOrder.id,
                  recordedAt: new Date(),
                },
              });
            }

            await tx.stockReservation.deleteMany({
              where: { workOrderId: workOrder.id },
            });

            return updatedOt;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 10_000,
            timeout: 60_000,
          },
        );
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

  /**
   * Promueve un ítem de backlog: tarea en la misma OT, o nueva OT generada desde la descripción.
   */
  async promoteBacklogItem(
    user: any,
    workOrderId: string,
    itemId: string,
    body: { mode: 'TO_TASK' | 'TO_NEW_OT' },
    activeContract?: string,
  ) {
    const whereWo = this.workOrderAccessWhere(
      user,
      workOrderId,
      activeContract,
    );
    const wo = await this.prisma.workOrder.findFirst({
      where: whereWo,
      include: {
        equipment: true,
      },
    });
    if (!wo) {
      throw new BadRequestException('Orden de Trabajo no encontrada');
    }

    const item = await this.prisma.workOrderBacklogItem.findFirst({
      where: {
        id: itemId,
        workOrderId,
        tenantId: user.tenantId,
      },
    });
    if (!item) {
      throw new BadRequestException('Ítem de backlog no encontrado');
    }
    if (item.status !== 'PENDING') {
      throw new BadRequestException(
        'Solo se pueden promover ítems en estado pendiente.',
      );
    }

    const text = item.description.trim();
    if (!text) {
      throw new BadRequestException('La descripción del backlog está vacía.');
    }

    if (body.mode === 'TO_TASK') {
      const desc = text.length <= 255 ? text : `${text.slice(0, 252)}...`;
      await this.prisma.workOrderTask.create({
        data: {
          workOrderId,
          description: desc,
          isCompleted: false,
        },
      });
      await this.prisma.workOrderBacklogItem.update({
        where: { id: itemId },
        data: { status: 'DONE' },
      });
      return { promoted: true as const, mode: 'TO_TASK' as const };
    }

    if (body.mode !== 'TO_NEW_OT') {
      throw new BadRequestException('Modo de promoción no válido.');
    }

    const meter =
      wo.equipment?.currentMeter ?? wo.finalMeter ?? wo.initialMeter ?? 0;

    const created = await this.create(user, {
      equipmentId: wo.equipmentId,
      warehouseId: wo.warehouseId ?? undefined,
      classificationTags:
        wo.classificationTags?.length > 0 ? [...wo.classificationTags] : [],
      detentionInitialMeter: meter,
      detentionFinalMeter: meter,
      workPerformedDescription: text,
      description: text,
      initialRequestDescription: text,
      affectsAvailability: wo.affectsAvailability ?? undefined,
      responsibleMechanicName:
        wo.responsibleMechanicName ?? wo.responsible ?? undefined,
    });

    await this.prisma.workOrderBacklogItem.update({
      where: { id: itemId },
      data: { status: 'DONE' },
    });

    return {
      promoted: true as const,
      mode: 'TO_NEW_OT' as const,
      newWorkOrderId: created?.id as string | undefined,
    };
  }
}
