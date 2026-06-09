import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { fetchTenantPdfLogoDataUri } from '../../common/pdf/fetch-tenant-pdf-logo';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateEquipmentResumePdfBuffer,
  type EquipmentResumePdfPayload,
} from './equipment-resume-pdf.generator';
import { generateFleetMasterExcelBuffer } from './fleet-master-excel.generator';
import {
  FaultReportStatus,
  MeterLogSource,
  OperationalStatus,
  Prisma,
} from '@prisma/client';
import { pickEquipmentWritablePayload } from './equipment-write-keys';
import { applyCurrentMeterChange } from './equipment-meter-sync';
import { BulkSyncMeterReadingsDto } from './dto/bulk-sync-meter-readings.dto';
import { getMeterJumpLimit } from './meter-jump-limits.util';
import {
  getImportNullableString,
  getImportString,
  normalizeImportKey,
  parseBaseLogicMasterImportWorkbook,
  parseImportBoolean,
  parseImportDate,
  parseImportInt,
} from '../../common/excel/baselogic-master-import.util';
import {
  buildEquipmentContractAccessOr,
  userCanAccessContractId,
} from '../../common/contract-scope.util';

type FleetImportAction = 'CREATE' | 'UPDATE' | 'NO_CHANGE' | 'DELETE_CANDIDATE' | 'ERROR';

type FleetImportRequirement = {
  kind: 'CONTRACT' | 'SUBCONTRACT' | 'EQUIPMENT_TYPE';
  code: string;
  name?: string | null;
  rows: number[];
  severity: 'blocking' | 'warning';
  message: string;
};

type FleetImportImpact = {
  workOrders: number;
  availabilityRecords: number;
  availabilityEvents: number;
  faultReports: number;
  lubeReports: number;
  meterAdjustments: number;
  meterLogs: number;
  assetCosts: number;
  purchaseRequisitions: number;
  purchaseOrders: number;
};

type FleetImportPreviewRow = {
  rowNumber: number;
  action: FleetImportAction;
  equipmentId: string | null;
  internalId: string;
  label: string;
  errors: string[];
  warnings: string[];
  changes: Array<{ field: string; before: unknown; after: unknown }>;
};

type FleetDeleteCandidate = {
  equipmentId: string;
  internalId: string;
  label: string;
  impact: FleetImportImpact;
  warnings: string[];
};

type FleetImportOptions = {
  allowCreates?: boolean;
  allowUpdates?: boolean;
  allowDeletes?: boolean;
  forceDeleteWithAssociations?: boolean;
};

@Injectable()
export class EquipmentsService {
  private readonly logger = new Logger(EquipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Alcance por contrato/subcontrato (JWT `allowedContracts`; vacío → sin filas). */
  private pushEquipmentContractScope(
    andConditions: Prisma.EquipmentWhereInput[],
    user: { role?: string; allowedContracts?: string[] },
    siteHeader?: string,
  ): void {
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (siteHeader && siteHeader !== 'ALL') {
        andConditions.push({
          OR: [
            { contractId: siteHeader },
            { subcontract: { contractId: siteHeader } },
          ],
        });
      }
      return;
    }
    andConditions.push({
      OR: buildEquipmentContractAccessOr(
        user,
      ) as Prisma.EquipmentWhereInput['OR'],
    });
  }

  /**
   * Coherencia subarriendo: si isSubleased, exige empresa; si no, limpia nombre.
   * En update, si el body no trae claves de subarriendo, no toca el estado persistido.
   */
  private normalizeSubleasePayload(
    data: Record<string, unknown>,
    existing: {
      isSubleased: boolean;
      subleaseCompanyName: string | null;
    } | null,
  ): void {
    const hasIs = Object.prototype.hasOwnProperty.call(data, 'isSubleased');
    const hasName = Object.prototype.hasOwnProperty.call(
      data,
      'subleaseCompanyName',
    );

    if (!hasIs && !hasName) {
      if (!existing) {
        data['isSubleased'] = false;
        data['subleaseCompanyName'] = null;
      }
      return;
    }

    const isSubleased = hasIs
      ? data['isSubleased'] === true ||
        data['isSubleased'] === 'true' ||
        data['isSubleased'] === 1 ||
        data['isSubleased'] === '1'
      : Boolean(existing?.isSubleased);

    let company = '';
    if (hasName) {
      const rawName = data['subleaseCompanyName'];
      company = typeof rawName === 'string' ? rawName.trim() : '';
    } else if (existing?.subleaseCompanyName) {
      company = String(existing.subleaseCompanyName).trim();
    }

    if (isSubleased && !company) {
      throw new BadRequestException(
        'Si el equipo está en subarriendo, indique la empresa arrendataria (razón social o nombre).',
      );
    }

    data['isSubleased'] = Boolean(isSubleased);
    data['subleaseCompanyName'] = isSubleased ? company : null;
  }

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

    if (!userCanAccessContractId(user, data.contractId)) {
      throw new BadRequestException(
        'Equipo no encontrado o sin permisos sobre el contrato indicado.',
      );
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

    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'Usuario no válido para auditoría de medidor.',
      );
    }

    this.normalizeSubleasePayload(data as Record<string, unknown>, null);

    try {
      const scalars = pickEquipmentWritablePayload(
        data as Record<string, unknown>,
      );
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.equipment.create({
          data: {
            ...(scalars as Prisma.EquipmentCreateInput),
            tenantId,
          },
        });
        if (row.initialMeter !== row.currentMeter) {
          await applyCurrentMeterChange(tx, {
            tenantId,
            equipmentId: row.id,
            oldMeter: row.initialMeter,
            newMeter: row.currentMeter,
            source: MeterLogSource.MANUAL,
            sourceId: null,
            userId,
          });
        }
        return row;
      });
      return created;
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

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

    if (query?.type) andConditions.push({ type: query.type });
    if (query?.brand) andConditions.push({ brand: query.brand });

    // Lógica de Búsqueda
    if (query?.search) {
      const q = query.search.trim();
      if (q.length > 0) {
        andConditions.push({
          OR: [
            { internalId: { contains: q, mode: 'insensitive' } },
            { plate: { contains: q, mode: 'insensitive' } },
            { mineInternalId: { contains: q, mode: 'insensitive' } },
          ],
        });
      }
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

    const equipmentIds = data.map((eq) => eq.id);
    const [activeFaultRows, availabilityRows] = equipmentIds.length
      ? await this.prisma.$transaction([
          this.prisma.faultReport.findMany({
            where: {
              tenantId,
              equipmentId: { in: equipmentIds },
              status: {
                in: [FaultReportStatus.OPEN, FaultReportStatus.LINKED],
              },
            },
            orderBy: { eventDate: 'desc' },
            select: {
              equipmentId: true,
              status: true,
              correlative: true,
            },
          }),
          this.prisma.equipmentAvailability.findMany({
            where: {
              tenantId,
              equipmentId: { in: equipmentIds },
            },
            orderBy: [
              { reportDate: 'desc' },
              { shift: 'desc' },
              { updatedAt: 'desc' },
            ],
            select: {
              equipmentId: true,
              status: true,
            },
          }),
        ])
      : [[], []];

    const activeFaultByEquipment = new Map<
      string,
      { status: FaultReportStatus; correlative: string }
    >();
    for (const fault of activeFaultRows) {
      if (!activeFaultByEquipment.has(fault.equipmentId)) {
        activeFaultByEquipment.set(fault.equipmentId, {
          status: fault.status,
          correlative: fault.correlative,
        });
      }
    }

    const latestM2ByEquipment = new Map<string, OperationalStatus>();
    for (const availability of availabilityRows) {
      if (!latestM2ByEquipment.has(availability.equipmentId)) {
        latestM2ByEquipment.set(availability.equipmentId, availability.status);
      }
    }

    const enrichedData = data.map((eq) => {
      const activeFault = activeFaultByEquipment.get(eq.id);
      const latestM2 = latestM2ByEquipment.get(eq.id);
      return {
        ...eq,
        actionRequiredFault:
          Boolean(activeFault) && latestM2 !== OperationalStatus.DOWN_MAINTENANCE,
        activeFaultReportStatus: activeFault?.status ?? null,
        activeFaultReportCorrelative: activeFault?.correlative ?? null,
      };
    });

    return { data: enrichedData, total, page, limit };
  }

  async getAnalytics(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;

    const where: Prisma.EquipmentWhereInput = { id, tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [
      equipment,
      workOrders,
      meterAdjustments,
      assetCostRecords,
      meterLogs,
    ] = await this.prisma.$transaction([
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
        include: {
          // Repuestos despachados a la OT (Consumos del activo, Sprint 2.1).
          parts: {
            select: {
              id: true,
              partNumber: true,
              description: true,
              quantity: true,
              unitCost: true,
              inventoryItemId: true,
            },
          },
        },
      }),
      this.prisma.meterAdjustment.findMany({
        where: { equipmentId: id },
        orderBy: { date: 'desc' },
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.assetCostRecord.findMany({
        where: { equipmentId: id, tenantId },
        orderBy: { recordedAt: 'desc' },
        take: 100,
        include: {
          purchaseOrder: { select: { correlative: true } },
          workOrder: { select: { correlative: true } },
          warehouseReceipt: { select: { correlative: true } },
        },
      }),
      this.prisma.equipmentMeterLog.findMany({
        where: { equipmentId: id, tenantId },
        orderBy: { date: 'desc' },
        take: 500,
        include: {
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    if (!equipment) {
      throw new BadRequestException('Equipo no encontrado o sin permisos');
    }

    const otIds = [
      ...new Set(
        meterLogs
          .filter((l) => l.source === 'OT' && l.sourceId)
          .map((l) => l.sourceId as string),
      ),
    ];
    const woRows =
      otIds.length > 0
        ? await this.prisma.workOrder.findMany({
            where: { tenantId, id: { in: otIds } },
            select: { id: true, correlative: true },
          })
        : [];
    const woMap = new Map(woRows.map((w) => [w.id, w.correlative]));

    const meterLogsEnriched = meterLogs.map((l) => ({
      ...l,
      workOrderCorrelative:
        l.source === 'OT' && l.sourceId
          ? (woMap.get(l.sourceId) ?? null)
          : null,
    }));

    return {
      equipment,
      workOrders,
      meterAdjustments,
      assetCostRecords,
      meterLogs: meterLogsEnriched,
    };
  }

  async getMeterSnapshot(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;
    const where: Prisma.EquipmentWhereInput = { id, tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const equipment = await this.prisma.equipment.findFirst({
      where,
      select: {
        id: true,
        currentMeter: true,
        meterType: true,
        internalId: true,
      },
    });

    if (!equipment) {
      throw new BadRequestException('Equipo no encontrado o sin permisos');
    }

    const lastLog = await this.prisma.equipmentMeterLog.findFirst({
      where: { equipmentId: id, tenantId },
      orderBy: { date: 'desc' },
      include: {
        user: { select: { name: true } },
      },
    });

    let otCorrelative: string | null = null;
    if (lastLog?.source === 'OT' && lastLog.sourceId) {
      const wo = await this.prisma.workOrder.findFirst({
        where: { id: lastLog.sourceId, tenantId },
        select: { correlative: true },
      });
      otCorrelative = wo?.correlative ?? null;
    }

    return {
      equipmentId: equipment.id,
      currentMeter: equipment.currentMeter,
      meterType: equipment.meterType,
      internalId: equipment.internalId,
      lastLog: lastLog
        ? {
            date: lastLog.date,
            source: lastLog.source,
            sourceId: lastLog.sourceId,
            otCorrelative,
            userName: lastLog.user?.name ?? null,
          }
        : null,
    };
  }

  async findOne(user: any, id: string, siteHeader?: string) {
    const where: Prisma.EquipmentWhereInput = { id, tenantId: user.tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

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

  async getFleetMasterExcelBuffer(
    user: any,
    siteHeader?: string,
  ): Promise<Buffer> {
    const tenantId = user.tenantId as string;
    const where: Prisma.EquipmentWhereInput = { tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [tenant, equipments, equipmentTypes, contracts] =
      await this.prisma.$transaction([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        }),
        this.prisma.equipment.findMany({
          where,
          orderBy: [{ contract: { code: 'asc' } }, { internalId: 'asc' }],
          include: {
            contract: { select: { code: true, name: true } },
            subcontract: { select: { code: true, name: true } },
          },
        }),
        this.prisma.catalogItem.findMany({
          where: { tenantId, category: 'EQUIPMENT_TYPE', isActive: true },
          orderBy: [{ code: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.contract.findMany({
          where: { tenantId },
          orderBy: { code: 'asc' },
          include: {
            subcontracts: { orderBy: { code: 'asc' } },
          },
        }),
      ]);

    const contractRows = contracts.flatMap((contract) => [
      {
        code: contract.code,
        name: contract.name,
        type: 'Contrato' as const,
        parentCode: null,
      },
      ...contract.subcontracts.map((subcontract) => ({
        code: subcontract.code,
        name: subcontract.name,
        type: 'Subcontrato' as const,
        parentCode: contract.code,
      })),
    ]);

    return generateFleetMasterExcelBuffer({
      tenantName: tenant?.name ?? 'BaseLogic TPM',
      generatedAt: new Date(),
      equipments,
      equipmentTypes,
      contractRows,
    });
  }

  private buildFleetImportScopeWhere(user: any, siteHeader?: string) {
    const where: Prisma.EquipmentWhereInput = { tenantId: user.tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];
    this.pushEquipmentContractScope(andConditions, user, siteHeader);
    if (andConditions.length > 0) where.AND = andConditions;
    return where;
  }

  private registerFleetRequirement(
    map: Map<string, FleetImportRequirement>,
    requirement: FleetImportRequirement,
  ): void {
    const key = `${requirement.kind}:${requirement.code}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows = [...new Set([...existing.rows, ...requirement.rows])].sort(
        (a, b) => a - b,
      );
      if (requirement.severity === 'blocking') existing.severity = 'blocking';
      return;
    }
    map.set(key, requirement);
  }

  private async buildFleetDeleteImpact(
    tenantId: string,
    equipmentIds: string[],
  ): Promise<Map<string, FleetImportImpact>> {
    const empty = (): FleetImportImpact => ({
      workOrders: 0,
      availabilityRecords: 0,
      availabilityEvents: 0,
      faultReports: 0,
      lubeReports: 0,
      meterAdjustments: 0,
      meterLogs: 0,
      assetCosts: 0,
      purchaseRequisitions: 0,
      purchaseOrders: 0,
    });
    const map = new Map(equipmentIds.map((id) => [id, empty()]));
    if (equipmentIds.length === 0) return map;

    const attach = <K extends keyof FleetImportImpact>(
      key: K,
      rows: Array<{ equipmentId: string | null; _count: { _all: number } }>,
    ) => {
      for (const row of rows) {
        if (!row.equipmentId) continue;
        const entry = map.get(row.equipmentId);
        if (entry) entry[key] = row._count._all;
      }
    };

    const [
      workOrders,
      availabilityRecords,
      availabilityEvents,
      faultReports,
      lubeReports,
      meterAdjustments,
      meterLogs,
      assetCosts,
      purchaseRequisitions,
      purchaseOrders,
    ] = await Promise.all([
      this.prisma.workOrder.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.equipmentAvailability.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.availabilityEvent.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.faultReport.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.lubeReport.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.meterAdjustment.groupBy({
        by: ['equipmentId'],
        where: { equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.equipmentMeterLog.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.assetCostRecord.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.purchaseRequisition.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['equipmentId'],
        where: { tenantId, equipmentId: { in: equipmentIds } },
        _count: { _all: true },
      }),
    ]);

    attach('workOrders', workOrders);
    attach('availabilityRecords', availabilityRecords);
    attach('availabilityEvents', availabilityEvents);
    attach('faultReports', faultReports);
    attach('lubeReports', lubeReports);
    attach('meterAdjustments', meterAdjustments);
    attach('meterLogs', meterLogs);
    attach('assetCosts', assetCosts);
    attach('purchaseRequisitions', purchaseRequisitions);
    attach('purchaseOrders', purchaseOrders);
    return map;
  }

  private hasFleetDeleteImpact(impact: FleetImportImpact): boolean {
    return Object.values(impact).some((count) => count > 0);
  }

  async validateFleetMasterImport(
    buffer: Buffer,
    user: any,
    siteHeader?: string,
  ) {
    const tenantId = user.tenantId as string;
    const workbook = await parseBaseLogicMasterImportWorkbook(buffer, 'fleet');
    const where = this.buildFleetImportScopeWhere(user, siteHeader);

    const [equipments, equipmentTypes, contracts] =
      await this.prisma.$transaction([
        this.prisma.equipment.findMany({
          where,
          include: {
            contract: { select: { id: true, code: true, name: true } },
            subcontract: { select: { id: true, code: true, name: true } },
          },
        }),
        this.prisma.catalogItem.findMany({
          where: { tenantId, category: 'EQUIPMENT_TYPE', isActive: true },
        }),
        this.prisma.contract.findMany({
          where: { tenantId },
          include: { subcontracts: true },
        }),
      ]);

    const equipmentById = new Map(equipments.map((equipment) => [equipment.id, equipment]));
    const equipmentByInternal = new Map(
      equipments.map((equipment) => [normalizeImportKey(equipment.internalId), equipment]),
    );
    const typeByCode = new Map(
      equipmentTypes.map((type) => [normalizeImportKey(type.code), type]),
    );
    const typeByName = new Map(
      equipmentTypes.map((type) => [normalizeImportKey(type.name), type]),
    );
    const contractByCode = new Map(
      contracts.map((contract) => [normalizeImportKey(contract.code), contract]),
    );
    const subcontractsByContractAndCode = new Map<string, (typeof contracts)[number]['subcontracts'][number]>();
    for (const contract of contracts) {
      for (const subcontract of contract.subcontracts) {
        subcontractsByContractAndCode.set(
          `${normalizeImportKey(contract.code)}:${normalizeImportKey(subcontract.code)}`,
          subcontract,
        );
      }
    }

    const requirements = new Map<string, FleetImportRequirement>();
    const previewRows: FleetImportPreviewRow[] = [];
    const seenIds = new Set<string>();
    const seenInternalIds = new Map<string, number[]>();
    const seenPlates = new Map<string, number[]>();
    const includedEquipmentIds = new Set<string>();
    const includedInternalKeys = new Set<string>();

    const addSeen = (map: Map<string, number[]>, key: string, rowNumber: number) => {
      map.set(key, [...(map.get(key) ?? []), rowNumber]);
    };

    for (const row of workbook.rows) {
      const v = row.values;
      const id = getImportNullableString(v, 'ID sistema');
      const internalId = getImportString(v, 'N interno').toUpperCase();
      const plate = getImportNullableString(v, 'Patente')?.toUpperCase() ?? null;
      const typeCode = getImportNullableString(v, 'Codigo tipo catalogo');
      const typeName = getImportString(v, 'Tipo equipo');
      const contractCode = getImportString(v, 'Contrato');
      const subcontractCode = getImportNullableString(v, 'Subcontrato');
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!internalId) errors.push('N interno requerido.');
      if (!typeName && !typeCode) errors.push('Tipo equipo o codigo tipo catalogo requerido.');
      if (!contractCode) errors.push('Contrato requerido.');
      if (id) {
        if (seenIds.has(id)) errors.push(`ID sistema duplicado en el archivo: ${id}.`);
        seenIds.add(id);
      }
      if (internalId) {
        addSeen(seenInternalIds, normalizeImportKey(internalId), row.rowNumber);
      }
      if (plate) {
        addSeen(seenPlates, normalizeImportKey(plate), row.rowNumber);
      }

      const type =
        (typeCode ? typeByCode.get(normalizeImportKey(typeCode)) : null) ??
        (typeName ? typeByName.get(normalizeImportKey(typeName)) : null);
      if (!type && (typeCode || typeName)) {
        this.registerFleetRequirement(requirements, {
          kind: 'EQUIPMENT_TYPE',
          code: typeCode || typeName,
          name: typeName || null,
          rows: [row.rowNumber],
          severity: 'blocking',
          message:
            'Debe existir en Catalogos Maestros > Tipos de equipo antes de importar.',
        });
        errors.push(`Tipo de equipo no existe: ${typeCode || typeName}.`);
      }

      const contract = contractCode
        ? contractByCode.get(normalizeImportKey(contractCode))
        : null;
      if (!contract && contractCode) {
        this.registerFleetRequirement(requirements, {
          kind: 'CONTRACT',
          code: contractCode,
          rows: [row.rowNumber],
          severity: 'blocking',
          message: 'Debe existir el contrato antes de importar equipos.',
        });
        errors.push(`Contrato no existe: ${contractCode}.`);
      }

      let subcontract: (typeof contracts)[number]['subcontracts'][number] | null = null;
      if (subcontractCode && contractCode) {
        subcontract = subcontractsByContractAndCode.get(
          `${normalizeImportKey(contractCode)}:${normalizeImportKey(subcontractCode)}`,
        ) ?? null;
        if (!subcontract) {
          this.registerFleetRequirement(requirements, {
            kind: 'SUBCONTRACT',
            code: subcontractCode,
            rows: [row.rowNumber],
            severity: 'blocking',
            message: `Debe existir bajo el contrato ${contractCode}.`,
          });
          errors.push(`Subcontrato no existe o no pertenece al contrato: ${subcontractCode}.`);
        }
      } else if (contract && contract.subcontracts.length > 0) {
        warnings.push(
          `El contrato ${contract.code} tiene subcontratos; la fila quedara sin subcontrato.`,
        );
      }

      const existing =
        (id ? equipmentById.get(id) : null) ??
        (internalId ? equipmentByInternal.get(normalizeImportKey(internalId)) : null) ??
        null;
      if (existing) {
        includedEquipmentIds.add(existing.id);
      }
      if (internalId) includedInternalKeys.add(normalizeImportKey(internalId));

      const changes: FleetImportPreviewRow['changes'] = [];
      const compare = (field: string, before: unknown, after: unknown) => {
        const normalize = (value: unknown) =>
          value instanceof Date ? value.toISOString().slice(0, 10) : (value ?? null);
        if (JSON.stringify(normalize(before)) !== JSON.stringify(normalize(after))) {
          changes.push({ field, before: normalize(before), after: normalize(after) });
        }
      };

      const imported = {
        contractId: contract?.id ?? null,
        subcontractId: subcontract?.id ?? null,
        mineInternalId: getImportNullableString(v, 'NIC mina'),
        plate,
        type: type?.name ?? typeName,
        brand: getImportString(v, 'Marca').toUpperCase() || 'SIN MARCA',
        model: getImportString(v, 'Modelo').toUpperCase() || 'SIN MODELO',
        year: parseImportInt(v['Ano']),
        meterType:
          normalizeImportKey(v['Tipo medidor']).includes('KILOMETERS') ||
          normalizeImportKey(v['Tipo medidor']).includes('KM')
            ? ('KILOMETERS' as const)
            : ('HOURS' as const),
        initialMeter: parseImportInt(v['Medidor inicial']) ?? 0,
        currentMeter: parseImportInt(v['Medidor actual']) ?? 0,
        serialNumber: getImportNullableString(v, 'N serie'),
        ownership: getImportNullableString(v, 'Propiedad'),
        isSubleased: parseImportBoolean(v['Subarriendo']) ?? false,
        subleaseCompanyName: getImportNullableString(v, 'Empresa subarriendo'),
        maintenanceFrequency: parseImportInt(v['Frecuencia mantencion']),
        pmIntervalOverride: parseImportInt(v['Intervalo PM']),
        lastMaintenanceDate: parseImportDate(v['Ultima PM fecha']),
        lastMaintenanceMeter: parseImportInt(v['Ultima PM medidor']),
        lastMaintenanceType: getImportNullableString(v, 'Tipo ultima PM'),
        techReviewExp: parseImportDate(v['Revision tecnica vence']),
        circPermitExp: parseImportDate(v['Permiso circulacion vence']),
        soapExp: parseImportDate(v['SOAP/seguro vence']),
        mechanicalCertExp: parseImportDate(v['Certificado mecanico vence']),
        liabilityPolicyExp: parseImportDate(v['Poliza RC vence']),
        vin: getImportNullableString(v, 'VIN'),
        engineNumber: getImportNullableString(v, 'N motor'),
        isOperational: parseImportBoolean(v['Operativo']) ?? true,
      };

      if (existing) {
        for (const [field, after] of Object.entries(imported)) {
          compare(field, (existing as any)[field], after);
        }
      }

      previewRows.push({
        rowNumber: row.rowNumber,
        action: errors.length
          ? 'ERROR'
          : existing
            ? changes.length
              ? 'UPDATE'
              : 'NO_CHANGE'
            : 'CREATE',
        equipmentId: existing?.id ?? null,
        internalId,
        label: [internalId, plate, imported.brand, imported.model].filter(Boolean).join(' · '),
        errors,
        warnings,
        changes,
      });
    }

    for (const [key, rows] of seenInternalIds) {
      if (rows.length <= 1) continue;
      for (const preview of previewRows.filter((row) => rows.includes(row.rowNumber))) {
        preview.errors.push(`N interno duplicado en filas ${rows.join(', ')}.`);
        preview.action = 'ERROR';
      }
    }
    for (const [key, rows] of seenPlates) {
      if (!key || rows.length <= 1) continue;
      for (const preview of previewRows.filter((row) => rows.includes(row.rowNumber))) {
        preview.errors.push(`Patente duplicada en filas ${rows.join(', ')}.`);
        preview.action = 'ERROR';
      }
    }

    const deleteSource = equipments.filter((equipment) => {
      return (
        !includedEquipmentIds.has(equipment.id) &&
        !includedInternalKeys.has(normalizeImportKey(equipment.internalId))
      );
    });
    const impactById = await this.buildFleetDeleteImpact(
      tenantId,
      deleteSource.map((equipment) => equipment.id),
    );
    const deleteCandidates: FleetDeleteCandidate[] = deleteSource.map((equipment) => {
      const impact = impactById.get(equipment.id) ?? {
        workOrders: 0,
        availabilityRecords: 0,
        availabilityEvents: 0,
        faultReports: 0,
        lubeReports: 0,
        meterAdjustments: 0,
        meterLogs: 0,
        assetCosts: 0,
        purchaseRequisitions: 0,
        purchaseOrders: 0,
      };
      return {
        equipmentId: equipment.id,
        internalId: equipment.internalId,
        label: [equipment.internalId, equipment.plate, equipment.brand, equipment.model]
          .filter(Boolean)
          .join(' · '),
        impact,
        warnings: this.hasFleetDeleteImpact(impact)
          ? ['Tiene registros asociados. Solo se eliminara con confirmacion destructiva explicita.']
          : [],
      };
    });

    const blockingErrors = previewRows.reduce(
      (count, row) => count + row.errors.length,
      0,
    );

    return {
      domain: 'fleet' as const,
      version: workbook.version,
      summary: {
        rows: previewRows.length,
        creates: previewRows.filter((row) => row.action === 'CREATE').length,
        updates: previewRows.filter((row) => row.action === 'UPDATE').length,
        unchanged: previewRows.filter((row) => row.action === 'NO_CHANGE').length,
        errors: blockingErrors,
        deleteCandidates: deleteCandidates.length,
      },
      requirements: [...requirements.values()],
      previewRows,
      deleteCandidates,
      configuration: {
        requiredBeforeCommit: [
          'Contratos existentes',
          'Subcontratos existentes cuando se informan en el Excel',
          'Tipos de equipo existentes en Catalogos Maestros',
        ],
        options: {
          allowCreates: true,
          allowUpdates: true,
          allowDeletes: false,
          forceDeleteWithAssociations: false,
        },
      },
    };
  }

  private async deleteEquipmentWithAssociations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    equipmentId: string,
  ): Promise<void> {
    await tx.purchaseRequisition.updateMany({
      where: { tenantId, equipmentId },
      data: { equipmentId: null },
    });
    await tx.purchaseOrder.updateMany({
      where: { tenantId, equipmentId },
      data: { equipmentId: null },
    });
    await tx.availabilityEvent.deleteMany({ where: { tenantId, equipmentId } });
    await tx.equipmentAvailability.deleteMany({ where: { tenantId, equipmentId } });
    await tx.faultReport.deleteMany({ where: { tenantId, equipmentId } });
    await tx.lubeReport.deleteMany({ where: { tenantId, equipmentId } });
    await tx.workOrder.deleteMany({ where: { tenantId, equipmentId } });
    await tx.meterAdjustment.deleteMany({ where: { equipmentId } });
    await tx.equipmentMeterLog.deleteMany({ where: { tenantId, equipmentId } });
    await tx.assetCostRecord.deleteMany({ where: { tenantId, equipmentId } });
    await tx.equipment.delete({ where: { id: equipmentId } });
  }

  async commitFleetMasterImport(
    buffer: Buffer,
    user: any,
    options: FleetImportOptions = {},
    siteHeader?: string,
  ) {
    const tenantId = user.tenantId as string;
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException('Usuario no valido para auditoria de medidor.');
    }

    const validation = await this.validateFleetMasterImport(buffer, user, siteHeader);
    const blockingRows = validation.previewRows.filter((row) => row.errors.length > 0);
    const blockingRequirements = validation.requirements.filter(
      (req) => req.severity === 'blocking',
    );
    if (blockingRows.length || blockingRequirements.length) {
      throw new BadRequestException({
        message: 'La importacion tiene errores bloqueantes. Valide y configure antes de confirmar.',
        blockingRows: blockingRows.length,
        blockingRequirements,
      });
    }

    const allowCreates = options.allowCreates !== false;
    const allowUpdates = options.allowUpdates !== false;
    const allowDeletes = options.allowDeletes === true;
    const forceDeleteWithAssociations = options.forceDeleteWithAssociations === true;

    if (!allowCreates && validation.previewRows.some((row) => row.action === 'CREATE')) {
      throw new BadRequestException('La importacion contiene altas, pero allowCreates=false.');
    }
    if (!allowUpdates && validation.previewRows.some((row) => row.action === 'UPDATE')) {
      throw new BadRequestException('La importacion contiene actualizaciones, pero allowUpdates=false.');
    }
    if (allowDeletes && !forceDeleteWithAssociations) {
      const blockedDeletes = validation.deleteCandidates.filter((candidate) =>
        this.hasFleetDeleteImpact(candidate.impact),
      );
      if (blockedDeletes.length > 0) {
        throw new BadRequestException({
          message:
            'Hay bajas con registros asociados. Active forceDeleteWithAssociations solo si desea borrar historial vinculado.',
          deleteCandidates: blockedDeletes,
        });
      }
    }

    const workbook = await parseBaseLogicMasterImportWorkbook(buffer, 'fleet');
    const [equipmentTypes, contracts, existing] = await this.prisma.$transaction([
      this.prisma.catalogItem.findMany({
        where: { tenantId, category: 'EQUIPMENT_TYPE', isActive: true },
      }),
      this.prisma.contract.findMany({
        where: { tenantId },
        include: { subcontracts: true },
      }),
      this.prisma.equipment.findMany({
        where: this.buildFleetImportScopeWhere(user, siteHeader),
      }),
    ]);

    const typeByCode = new Map(equipmentTypes.map((type) => [normalizeImportKey(type.code), type]));
    const typeByName = new Map(equipmentTypes.map((type) => [normalizeImportKey(type.name), type]));
    const contractByCode = new Map(contracts.map((contract) => [normalizeImportKey(contract.code), contract]));
    const subcontractByContractAndCode = new Map<string, (typeof contracts)[number]['subcontracts'][number]>();
    for (const contract of contracts) {
      for (const subcontract of contract.subcontracts) {
        subcontractByContractAndCode.set(
          `${normalizeImportKey(contract.code)}:${normalizeImportKey(subcontract.code)}`,
          subcontract,
        );
      }
    }
    const existingById = new Map(existing.map((equipment) => [equipment.id, equipment]));
    const existingByInternal = new Map(
      existing.map((equipment) => [normalizeImportKey(equipment.internalId), equipment]),
    );
    const previewByRowNumber = new Map(
      validation.previewRows.map((preview) => [preview.rowNumber, preview]),
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let deleted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of workbook.rows) {
        const preview = previewByRowNumber.get(row.rowNumber);
        if (!preview || preview.action === 'ERROR') continue;
        if (preview.action === 'NO_CHANGE') {
          unchanged++;
          continue;
        }

        const v = row.values;
        const id = getImportNullableString(v, 'ID sistema');
        const internalId = getImportString(v, 'N interno').toUpperCase();
        if (!internalId) continue;

        const typeCode = getImportNullableString(v, 'Codigo tipo catalogo');
        const typeName = getImportString(v, 'Tipo equipo');
        const type =
          (typeCode ? typeByCode.get(normalizeImportKey(typeCode)) : null) ??
          (typeName ? typeByName.get(normalizeImportKey(typeName)) : null);
        const contractCode = getImportString(v, 'Contrato');
        const contract = contractByCode.get(normalizeImportKey(contractCode));
        const subcontractCode = getImportNullableString(v, 'Subcontrato');
        const subcontract =
          subcontractCode && contract
            ? subcontractByContractAndCode.get(
                `${normalizeImportKey(contract.code)}:${normalizeImportKey(subcontractCode)}`,
              )
            : null;
        const existingRow =
          (id ? existingById.get(id) : null) ??
          existingByInternal.get(normalizeImportKey(internalId)) ??
          null;

        const currentMeter = parseImportInt(v['Medidor actual']) ?? 0;
        const data = {
          tenantId,
          contractId: contract?.id ?? null,
          subcontractId: subcontract?.id ?? null,
          mineInternalId: getImportNullableString(v, 'NIC mina'),
          internalId,
          plate: getImportNullableString(v, 'Patente')?.toUpperCase() ?? null,
          type: type?.name ?? typeName,
          brand: getImportString(v, 'Marca').toUpperCase() || 'SIN MARCA',
          model: getImportString(v, 'Modelo').toUpperCase() || 'SIN MODELO',
          meterType:
            normalizeImportKey(v['Tipo medidor']).includes('KILOMETERS') ||
            normalizeImportKey(v['Tipo medidor']).includes('KM')
              ? ('KILOMETERS' as const)
              : ('HOURS' as const),
          initialMeter: parseImportInt(v['Medidor inicial']) ?? currentMeter,
          currentMeter,
          serialNumber: getImportNullableString(v, 'N serie'),
          year: parseImportInt(v['Ano']),
          ownership: getImportNullableString(v, 'Propiedad'),
          isSubleased: parseImportBoolean(v['Subarriendo']) ?? false,
          subleaseCompanyName: getImportNullableString(v, 'Empresa subarriendo'),
          maintenanceFrequency: parseImportInt(v['Frecuencia mantencion']),
          pmIntervalOverride: parseImportInt(v['Intervalo PM']),
          lastMaintenanceDate: parseImportDate(v['Ultima PM fecha']),
          lastMaintenanceMeter: parseImportInt(v['Ultima PM medidor']),
          lastMaintenanceType: getImportNullableString(v, 'Tipo ultima PM'),
          techReviewExp: parseImportDate(v['Revision tecnica vence']),
          circPermitExp: parseImportDate(v['Permiso circulacion vence']),
          soapExp: parseImportDate(v['SOAP/seguro vence']),
          mechanicalCertExp: parseImportDate(v['Certificado mecanico vence']),
          liabilityPolicyExp: parseImportDate(v['Poliza RC vence']),
          vin: getImportNullableString(v, 'VIN'),
          engineNumber: getImportNullableString(v, 'N motor'),
          isOperational: parseImportBoolean(v['Operativo']) ?? true,
        };

        if (!existingRow) {
          if (preview.action !== 'CREATE') continue;
          if (!allowCreates) continue;
          await tx.equipment.create({
            data: {
              id: id ?? undefined,
              ...data,
            },
          });
          created++;
          continue;
        }

        if (preview.action !== 'UPDATE') {
          unchanged++;
          continue;
        }

        if (!allowUpdates) {
          unchanged++;
          continue;
        }

        const { currentMeter: nextMeter, tenantId: _tenantId, ...updateData } = data;
        await tx.equipment.update({
          where: { id: existingRow.id },
          data: updateData,
        });
        await applyCurrentMeterChange(tx, {
          tenantId,
          equipmentId: existingRow.id,
          oldMeter: existingRow.currentMeter,
          newMeter: nextMeter,
          source: MeterLogSource.MANUAL,
          sourceId: 'fleet-master-import',
          userId,
        });
        updated++;
      }

      if (allowDeletes) {
        for (const candidate of validation.deleteCandidates) {
          await this.deleteEquipmentWithAssociations(tx, tenantId, candidate.equipmentId);
          deleted++;
        }
      }
    });

    return {
      created,
      updated,
      unchanged,
      deleted,
      skippedDeleteCandidates: allowDeletes ? 0 : validation.deleteCandidates.length,
      warnings:
        validation.deleteCandidates.length > 0 && !allowDeletes
          ? [
              'Se detectaron equipos ausentes en el Excel. No fueron eliminados porque allowDeletes=false.',
            ]
          : [],
    };
  }

  /**
   * PDF hoja de vida del activo (HTML + Chromium).
   */
  async getEquipmentResumePdfStream(
    user: any,
    id: string,
    siteHeader?: string,
  ): Promise<Readable> {
    const tenantId = user.tenantId as string;
    const where: Prisma.EquipmentWhereInput = { id, tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];
    this.pushEquipmentContractScope(andConditions, user, siteHeader);
    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const equipment = await this.prisma.equipment.findFirst({
      where,
      include: {
        contract: { select: { code: true, name: true } },
        subcontract: { select: { code: true, name: true } },
      },
    });
    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado o sin permisos');
    }

    const [tenant, closedWorkOrders, openWorkOrdersCount, meterLogs] =
      await Promise.all([
        this.prisma.tenant.findFirst({
          where: { id: tenantId },
          select: { name: true, pdfLogoUrl: true, primaryColor: true },
        }),
        this.prisma.workOrder.findMany({
          where: { equipmentId: id, tenantId, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
          take: 15,
          select: {
            correlative: true,
            status: true,
            category: true,
            maintenanceType: true,
            description: true,
            createdAt: true,
            closedAt: true,
            initialMeter: true,
            finalMeter: true,
            metricHh: true,
          },
        }),
        this.prisma.workOrder.count({
          where: {
            equipmentId: id,
            tenantId,
            status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
          },
        }),
        this.prisma.equipmentMeterLog.findMany({
          where: { equipmentId: id, tenantId },
          orderBy: { date: 'desc' },
          take: 8,
          include: { user: { select: { name: true } } },
        }),
      ]);

    const otIds = [
      ...new Set(
        meterLogs
          .filter((l) => l.source === 'OT' && l.sourceId)
          .map((l) => l.sourceId as string),
      ),
    ];
    const woMap =
      otIds.length > 0
        ? new Map(
            (
              await this.prisma.workOrder.findMany({
                where: { tenantId, id: { in: otIds } },
                select: { id: true, correlative: true },
              })
            ).map((w) => [w.id, w.correlative]),
          )
        : new Map<string, string>();

    const recentMeterLogs = meterLogs.map((l) => ({
      date: l.date,
      oldValue: l.oldValue,
      newValue: l.newValue,
      source: l.source,
      workOrderCorrelative:
        l.source === 'OT' && l.sourceId
          ? (woMap.get(l.sourceId) ?? null)
          : null,
      user: l.user,
    }));

    const payload: EquipmentResumePdfPayload = {
      equipment,
      tenantName: tenant?.name ?? 'Empresa',
      closedWorkOrders,
      openWorkOrdersCount,
      recentMeterLogs,
    };

    const tenantLogoDataUri = await fetchTenantPdfLogoDataUri(
      this.storage,
      tenant?.pdfLogoUrl,
    );
    const buffer = await generateEquipmentResumePdfBuffer(payload, {
      tenantLogoDataUri,
      tenantPrimaryColor: tenant?.primaryColor,
    });
    return Readable.from(buffer);
  }

  // PUT: Actualizar un equipo existente
  async update(user: any, id: string, data: any, siteHeader?: string) {
    const tenantId = user.tenantId;
    try {
      const where: Prisma.EquipmentWhereInput = { id, tenantId };
      const andConditions: Prisma.EquipmentWhereInput[] = [];

      this.pushEquipmentContractScope(andConditions, user, siteHeader);

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      // Verificamos propiedad del tenant y seguridad
      const existing = await this.prisma.equipment.findFirst({
        where,
      });
      if (!existing)
        throw new BadRequestException('Equipo no encontrado o sin permisos');

      this.normalizeSubleasePayload(data as Record<string, unknown>, {
        isSubleased: existing.isSubleased,
        subleaseCompanyName: existing.subleaseCompanyName,
      });

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

      if (nextContractId && !userCanAccessContractId(user, nextContractId)) {
        throw new BadRequestException('Equipo no encontrado o sin permisos');
      }

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

      const patch = pickEquipmentWritablePayload(
        data as Record<string, unknown>,
      );
      if (Object.keys(patch).length === 0) {
        throw new BadRequestException(
          'No hay campos válidos para actualizar el equipo.',
        );
      }

      const userId = user.id || user.sub;
      if (!userId) {
        throw new BadRequestException(
          'Usuario no válido para auditoría de medidor.',
        );
      }

      let newMeter: number | undefined;
      if (patch.currentMeter !== undefined) {
        newMeter = Number(patch.currentMeter);
        if (Number.isNaN(newMeter)) {
          throw new BadRequestException('Medidor actual inválido.');
        }
      }

      const rest = { ...patch };
      delete rest.currentMeter;

      if (newMeter !== undefined && newMeter !== existing.currentMeter) {
        return await this.prisma.$transaction(async (tx) => {
          await applyCurrentMeterChange(tx, {
            tenantId,
            equipmentId: id,
            oldMeter: existing.currentMeter,
            newMeter,
            source: MeterLogSource.MANUAL,
            sourceId: null,
            userId,
          });
          if (Object.keys(rest).length > 0) {
            await tx.equipment.update({
              where: { id },
              data: rest as Prisma.EquipmentUpdateInput,
            });
          }
          return tx.equipment.findFirst({
            where: { id, tenantId },
            include: {
              contract: true,
              subcontract: true,
            },
          });
        });
      }

      return await this.prisma.equipment.update({
        where: { id },
        data: patch as Prisma.EquipmentUpdateInput,
        include: {
          contract: true,
          subcontract: true,
        },
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
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

  /**
   * Tabla ligera para captura masiva: medidor actual y fecha del último log.
   */
  async findMeterCaptureBoard(
    user: any,
    siteHeader: string | undefined,
    query?: { type?: string; search?: string; limit?: number },
  ) {
    const tenantId = user.tenantId;
    const rawLimit = Number(query?.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 2000)
      : 800;

    const where: Prisma.EquipmentWhereInput = { tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);

    if (query?.type) {
      andConditions.push({ type: query.type });
    }

    if (query?.search) {
      const q = query.search.trim();
      if (q.length > 0) {
        andConditions.push({
          OR: [
            { internalId: { contains: q, mode: 'insensitive' } },
            { plate: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
          ],
        });
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const rows = await this.prisma.equipment.findMany({
      where,
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        type: true,
        currentMeter: true,
        meterType: true,
        contractId: true,
        contract: { select: { code: true, name: true } },
        subcontract: {
          select: {
            code: true,
            name: true,
            contract: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { internalId: 'asc' },
      take: limit,
    });

    const ids = rows.map((r) => r.id);
    const maxDates =
      ids.length === 0
        ? []
        : await this.prisma.equipmentMeterLog.groupBy({
            by: ['equipmentId'],
            where: { tenantId, equipmentId: { in: ids } },
            _max: { date: true },
          });
    const dateMap = new Map(
      maxDates.map((d) => [d.equipmentId, d._max.date] as const),
    );

    const pairsWithDate = maxDates.filter((d) => d._max.date != null);
    const lastLogRows =
      pairsWithDate.length === 0
        ? []
        : await this.prisma.equipmentMeterLog.findMany({
            where: {
              tenantId,
              OR: pairsWithDate.map((p) => ({
                equipmentId: p.equipmentId,
                date: p._max.date!,
              })),
            },
            select: {
              equipmentId: true,
              date: true,
              source: true,
            },
          });
    const sourceMap = new Map(
      lastLogRows.map((log) => [log.equipmentId, log.source] as const),
    );

    return {
      limit,
      data: rows.map((r) => {
        const dt = dateMap.get(r.id);
        return {
          id: r.id,
          internalId: r.internalId,
          displayName: [r.brand, r.model].filter(Boolean).join(' ').trim(),
          type: r.type,
          currentMeter: r.currentMeter,
          meterType: r.meterType,
          lastReadingAt: dt ? dt.toISOString() : null,
          lastReadingSource: sourceMap.get(r.id) ?? null,
          contractCode:
            r.contract?.code ?? r.subcontract?.contract?.code ?? null,
          subcontractCode: r.subcontract?.code ?? null,
        };
      }),
    };
  }

  /**
   * Aplica N lecturas sobre el medidor actual en una única transacción Prisma.
   */
  async bulkSyncMeterReadings(
    user: any,
    siteHeader: string | undefined,
    body: BulkSyncMeterReadingsDto,
  ) {
    const tenantId = user.tenantId;
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'Usuario no válido para auditoría de medidor.',
      );
    }
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) {
      throw new BadRequestException('Debe enviar al menos una lectura.');
    }
    if (rawItems.length > 500) {
      throw new BadRequestException('Máximo 500 lecturas por solicitud.');
    }

    const merged = new Map<
      string,
      { newReading: number; confirmedLargeJump?: boolean }
    >();
    for (const it of rawItems) {
      if (!it?.equipmentId || typeof it.newReading !== 'number') {
        throw new BadRequestException('Formato de ítem inválido.');
      }
      if (!Number.isInteger(it.newReading) || it.newReading < 0) {
        throw new BadRequestException(
          'Cada lectura debe ser un entero mayor o igual a cero.',
        );
      }
      merged.set(it.equipmentId, {
        newReading: it.newReading,
        confirmedLargeJump: it.confirmedLargeJump === true,
      });
    }
    const items = [...merged.entries()].map(
      ([equipmentId, { newReading, confirmedLargeJump }]) => ({
        equipmentId,
        newReading,
        confirmedLargeJump,
      }),
    );

    const whereBase: Prisma.EquipmentWhereInput = { tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);
    if (andConditions.length > 0) {
      whereBase.AND = andConditions;
    }

    type BulkErrorRow = {
      equipmentId: string;
      error:
        | 'READING_LOWER_THAN_CURRENT'
        | 'EQUIPMENT_NOT_FOUND_OR_FORBIDDEN'
        | 'READING_JUMP_REQUIRES_CONFIRMATION';
      serverValue?: number;
      delta?: number;
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        let successCount = 0;
        let unchangedCount = 0;
        const errors: BulkErrorRow[] = [];
        const applied: {
          equipmentId: string;
          internalId: string;
          from: number;
          to: number;
        }[] = [];
        for (const { equipmentId, newReading, confirmedLargeJump } of items) {
          const equipment = await tx.equipment.findFirst({
            where: {
              ...whereBase,
              id: equipmentId,
            },
          });
          if (!equipment) {
            errors.push({
              equipmentId,
              error: 'EQUIPMENT_NOT_FOUND_OR_FORBIDDEN',
            });
            continue;
          }
          if (newReading < equipment.currentMeter) {
            errors.push({
              equipmentId,
              error: 'READING_LOWER_THAN_CURRENT',
              serverValue: equipment.currentMeter,
            });
            continue;
          }
          if (newReading === equipment.currentMeter) {
            unchangedCount += 1;
            continue;
          }
          const delta = newReading - equipment.currentMeter;
          const jumpLimit = getMeterJumpLimit(equipment.meterType);
          if (delta > jumpLimit && !confirmedLargeJump) {
            errors.push({
              equipmentId,
              error: 'READING_JUMP_REQUIRES_CONFIRMATION',
              serverValue: equipment.currentMeter,
              delta,
            });
            continue;
          }
          await applyCurrentMeterChange(tx, {
            tenantId,
            equipmentId,
            oldMeter: equipment.currentMeter,
            newMeter: newReading,
            source: MeterLogSource.MANUAL,
            sourceId: null,
            userId,
          });
          successCount += 1;
          applied.push({
            equipmentId,
            internalId: equipment.internalId,
            from: equipment.currentMeter,
            to: newReading,
          });
        }
        return {
          successCount,
          unchangedCount,
          errors,
          applied,
        };
      });
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        'Error en bulkSyncMeterReadings',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException(
        'No se pudo sincronizar las lecturas. Intente nuevamente.',
      );
    }
  }

  // DELETE: Eliminar un equipo
  async remove(user: any, id: string, siteHeader?: string) {
    const tenantId = user.tenantId;
    try {
      const where: Prisma.EquipmentWhereInput = { id, tenantId };
      const andConditions: Prisma.EquipmentWhereInput[] = [];

      this.pushEquipmentContractScope(andConditions, user, siteHeader);

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
