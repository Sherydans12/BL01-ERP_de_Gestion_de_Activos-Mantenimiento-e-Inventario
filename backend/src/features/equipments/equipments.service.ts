import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeterLogSource, Prisma } from '@prisma/client';
import { pickEquipmentWritablePayload } from './equipment-write-keys';
import { applyCurrentMeterChange } from './equipment-meter-sync';
import {
  buildEquipmentContractAccessOr,
  userCanAccessContractId,
} from '../../common/contract-scope.util';

@Injectable()
export class EquipmentsService {
  private readonly logger = new Logger(EquipmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    return { data, total, page, limit };
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
    body: { items?: { equipmentId: string; newReading: number }[] },
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

    const merged = new Map<string, number>();
    for (const it of rawItems) {
      if (!it?.equipmentId || typeof it.newReading !== 'number') {
        throw new BadRequestException('Formato de ítem inválido.');
      }
      if (!Number.isInteger(it.newReading) || it.newReading < 0) {
        throw new BadRequestException(
          'Cada lectura debe ser un entero mayor o igual a cero.',
        );
      }
      merged.set(it.equipmentId, it.newReading);
    }
    const items = [...merged.entries()].map(([equipmentId, newReading]) => ({
      equipmentId,
      newReading,
    }));

    const whereBase: Prisma.EquipmentWhereInput = { tenantId };
    const andConditions: Prisma.EquipmentWhereInput[] = [];

    this.pushEquipmentContractScope(andConditions, user, siteHeader);
    if (andConditions.length > 0) {
      whereBase.AND = andConditions;
    }

    type BulkErrorRow = {
      equipmentId: string;
      error: 'READING_LOWER_THAN_CURRENT' | 'EQUIPMENT_NOT_FOUND_OR_FORBIDDEN';
      serverValue?: number;
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
        for (const { equipmentId, newReading } of items) {
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
