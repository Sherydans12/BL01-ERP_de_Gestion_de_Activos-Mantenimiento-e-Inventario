import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityImpact,
  FaultCriticality,
  FaultReportStatus,
  MaintenanceType,
  MeterLogSource,
  OtCategory,
  OtType,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { NOTIFICATION_EVENTS } from '../../common/notifications/notification-events';
import { buildMailEquipmentDown } from '../../common/email/transactional-mail.builder';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';
import { CreateFaultReportDto } from './dto/create-fault-report.dto';

const FR_DOCUMENT_TYPE = 'FAULT_REPORT';
const FR_PREFIX = 'RF';

// ── Reglas de adjuntos ────────────────────────────────────────────────────────
const FR_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const FR_ATTACHMENT_MAX_COUNT = 3;
const FR_ATTACHMENT_ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
]);

export interface ListFaultReportsQuery {
  page?: string;
  pageSize?: string;
  equipmentId?: string;
  criticality?: FaultCriticality;
  status?: FaultReportStatus;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class FaultReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly storageService: StorageService,
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly config: ConfigService,
  ) {}

  // ── Includes reutilizables ──────────────────────────────────────────────────

  private readonly listInclude = {
    equipment: {
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        plate: true,
        isOperational: true,
      },
    },
    reportedBy: { select: { id: true, name: true } },
    workOrder: { select: { id: true, correlative: true, status: true } },
  } as const;

  private readonly detailInclude = {
    equipment: {
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        plate: true,
        isOperational: true,
        currentMeter: true,
      },
    },
    reportedBy: { select: { id: true, name: true } },
    workOrder: {
      select: {
        id: true,
        correlative: true,
        status: true,
        category: true,
        affectsAvailability: true,
      },
    },
    contract: { select: { id: true, code: true, name: true } },
    attachments: {
      select: {
        id: true,
        fileName: true,
        fileType: true,
        sizeBytes: true,
        storageKey: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' as const },
    },
  } as const;

  /**
   * Registra un evento de falla en terreno.
   *
   * Motor de reglas (en la misma transacción Serializable):
   *   HIGH  → crea OT NO_PROGRAMADA_REACTIVA  + isOperational=false + horómetro si avanza.
   *   MEDIUM → crea OT NO_PROGRAMADA_CORRECTIVA + horómetro si avanza.
   *   LOW   → solo registra el reporte (estado OPEN); planificador decide después.
   */
  async create(dto: CreateFaultReportDto, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    const result = await this.prisma.$transaction(
      async (tx) => {
        // ── 1. Validar equipo ─────────────────────────────────────────────────
        const equipment = await tx.equipment.findFirst({
          where: { id: dto.equipmentId, tenantId },
          select: {
            id: true,
            currentMeter: true,
            contractId: true,
            subcontractId: true,
          },
        });
        if (!equipment) {
          throw new NotFoundException(
            'El equipo no existe o no pertenece a este tenant.',
          );
        }
        if (!equipment.contractId) {
          throw new BadRequestException(
            'El equipo no tiene un contrato asignado. Asócialo a un contrato antes de registrar fallas.',
          );
        }

        // ── 2. Generar correlativo RF-XXXXX ───────────────────────────────────
        const correlative = await this.sequenceService.getNextCorrelative(
          tenantId,
          FR_DOCUMENT_TYPE,
          FR_PREFIX,
          { tx, padWidth: 5 },
        );

        // ── 3. Crear el reporte (estado inicial OPEN) ─────────────────────────
        const report = await tx.faultReport.create({
          data: {
            tenantId,
            contractId: equipment.contractId,
            equipmentId: dto.equipmentId,
            reportedById: userId,
            correlative,
            eventDate: new Date(dto.eventDate),
            meterAtFault: dto.meterAtFault ?? null,
            affectedSystem: dto.affectedSystem,
            criticality: dto.criticality,
            symptomDescription: dto.symptomDescription,
            status: FaultReportStatus.OPEN,
          },
        });

        // ── 4. Actualizar horómetro si avanza (silent ignore si retrocede) ────
        if (
          dto.meterAtFault != null &&
          dto.meterAtFault > equipment.currentMeter
        ) {
          await applyCurrentMeterChange(tx, {
            tenantId,
            equipmentId: dto.equipmentId,
            oldMeter: equipment.currentMeter,
            newMeter: dto.meterAtFault,
            source: MeterLogSource.FAULT_REPORT,
            sourceId: report.id,
            userId,
          });
        }

        // ── 5. Motor de reglas por criticidad ─────────────────────────────────
        if (
          dto.criticality === FaultCriticality.HIGH ||
          dto.criticality === FaultCriticality.MEDIUM
        ) {
          const isHigh = dto.criticality === FaultCriticality.HIGH;
          const category = isHigh
            ? OtCategory.NO_PROGRAMADA_REACTIVA
            : OtCategory.NO_PROGRAMADA_CORRECTIVA;
          const affectsAvailability = isHigh
            ? AvailabilityImpact.SI
            : AvailabilityImpact.NO;

          // Correlativo OT usando el patrón de count (alineado con WorkOrdersService)
          const woCount = await tx.workOrder.count({ where: { tenantId } });
          const year = new Date().getFullYear();
          const woCorrelative = `OT-${year}-${String(woCount + 1).padStart(3, '0')}`;

          const workOrder = await tx.workOrder.create({
            data: {
              tenantId,
              createdByUserId: userId,
              subcontractId: equipment.subcontractId ?? null,
              correlative: woCorrelative,
              equipmentId: dto.equipmentId,
              type: OtType.NUEVA,
              category,
              maintenanceType: MaintenanceType.CORRECTIVO,
              affectsAvailability,
              initialMeter:
                dto.meterAtFault != null
                  ? dto.meterAtFault
                  : equipment.currentMeter,
              description: dto.symptomDescription,
              initialRequestDescription: dto.symptomDescription,
              symptomsText: dto.symptomDescription,
              intervenedSystemsJson: [dto.affectedSystem],
              ...(isHigh
                ? { detentionStartedAt: new Date(dto.eventDate) }
                : {}),
            },
          });

          // Vincular OT al reporte y pasar a LINKED
          const linked = await tx.faultReport.update({
            where: { id: report.id },
            data: {
              workOrderId: workOrder.id,
              status: FaultReportStatus.LINKED,
            },
          });

          // Para falla ALTA: marcar el equipo fuera de servicio
          if (isHigh) {
            await tx.equipment.update({
              where: { id: dto.equipmentId },
              data: { isOperational: false },
            });
          }

          return linked;
        }

        // Criticidad LOW: devuelve el reporte sin OT
        return report;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    // ── 6. Notificar «Equipo fuera de servicio» (fuera de la transacción) ──────
    // Solo fallas ALTAS dejan el equipo detenido (isOperational=false).
    // Fire-and-forget: no bloquea ni revierte la respuesta si el push/correo falla.
    if (dto.criticality === FaultCriticality.HIGH) {
      this.notifyEquipmentDown(tenantId, result).catch(() => {
        /* fallo silencioso */
      });
    }

    return result;
  }

  /**
   * Resuelve los IDs de usuarios candidatos a recibir el aviso de equipo
   * detenido: ADMIN activos del tenant + usuarios con acceso al contrato del
   * equipo (`UserContract`). El dispatcher filtra por opt-in estricto
   * (`UserNotificationSetting`), así que aquí solo se arma el pool de candidatos.
   */
  private async resolveEquipmentDownRecipients(
    tenantId: string,
    contractId: string,
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { role: 'ADMIN' },
          { contractAccess: { some: { contractId } } },
        ],
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /**
   * Despacha el evento `EQUIPMENT_DOWN` (correo + Web Push opt-in) cuando una
   * falla ALTA dejó el equipo fuera de servicio. Enriquece el reporte con datos
   * de equipo, contrato, reportante y OT generada para el cuerpo del mensaje.
   */
  private async notifyEquipmentDown(
    tenantId: string,
    report: {
      id: string;
      correlative: string;
      equipmentId: string;
      contractId: string;
      reportedById: string;
      workOrderId: string | null;
      affectedSystem: string;
      symptomDescription: string;
      eventDate: Date;
    },
  ): Promise<void> {
    const [equipment, reporter, workOrder] = await Promise.all([
      this.prisma.equipment.findUnique({
        where: { id: report.equipmentId },
        select: {
          internalId: true,
          brand: true,
          model: true,
          contract: { select: { name: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: report.reportedById },
        select: { name: true, email: true },
      }),
      report.workOrderId
        ? this.prisma.workOrder.findUnique({
            where: { id: report.workOrderId },
            select: { correlative: true },
          })
        : Promise.resolve(null),
    ]);

    if (!equipment) {
      return;
    }

    const recipients = await this.resolveEquipmentDownRecipients(
      tenantId,
      report.contractId,
    );
    if (!recipients.length) {
      return;
    }

    const appUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const equipmentLabel =
      `${equipment.internalId} — ${equipment.brand} ${equipment.model}`.trim();
    const reportedBy = reporter?.name ?? reporter?.email ?? 'Operador';
    const eventDateLabel = report.eventDate.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    await this.notificationDispatcher.dispatch(
      NOTIFICATION_EVENTS.EQUIPMENT_DOWN,
      tenantId,
      {
        userIds: recipients,
        subject: `Equipo fuera de servicio: ${equipmentLabel} (${report.correlative})`,
        html: buildMailEquipmentDown({
          faultCorrelative: report.correlative,
          equipmentLabel,
          affectedSystem: String(report.affectedSystem),
          symptom: report.symptomDescription,
          reportedBy,
          eventDate: eventDateLabel,
          workOrderCorrelative: workOrder?.correlative ?? null,
          contractName: equipment.contract?.name ?? null,
          appUrl,
        }),
        pushPayload: {
          title: 'Equipo fuera de servicio',
          body: `${equipmentLabel} · ${report.correlative}`,
          data: {
            type: 'EQUIPMENT_DOWN',
            faultReportId: report.id,
            equipmentId: report.equipmentId,
          },
        },
      },
    );
  }

  /**
   * Convierte manualmente un reporte BAJA (LOW) en una OT correctiva.
   * Solo aplica a reportes en estado OPEN con criticidad LOW.
   * Usado por planificadores con el permiso `FAULT_REPORT_MANAGE`.
   */
  async createWorkOrderFromReport(id: string, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    const report = await this.prisma.faultReport.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        criticality: true,
        equipmentId: true,
        symptomDescription: true,
        affectedSystem: true,
        meterAtFault: true,
        equipment: { select: { currentMeter: true, subcontractId: true } },
      },
    });

    if (!report) {
      throw new NotFoundException(
        'El reporte de falla no existe o no pertenece a este tenant.',
      );
    }
    if (report.status !== FaultReportStatus.OPEN) {
      throw new ConflictException(
        'Solo se puede escalar a OT un reporte en estado OPEN.',
      );
    }
    if (report.criticality !== FaultCriticality.LOW) {
      throw new ConflictException(
        'Los reportes de criticidad ALTA y MEDIA generan OT automáticamente. Este endpoint solo aplica a fallas BAJA.',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const eq = report.equipment;

        const woCount = await tx.workOrder.count({ where: { tenantId } });
        const year = new Date().getFullYear();
        const woCorrelative = `OT-${year}-${String(woCount + 1).padStart(3, '0')}`;

        const workOrder = await tx.workOrder.create({
          data: {
            tenantId,
            createdByUserId: userId,
            subcontractId: eq.subcontractId ?? null,
            correlative: woCorrelative,
            equipmentId: report.equipmentId,
            type: OtType.NUEVA,
            category: OtCategory.NO_PROGRAMADA_CORRECTIVA,
            maintenanceType: MaintenanceType.CORRECTIVO,
            affectsAvailability: AvailabilityImpact.NO,
            initialMeter: report.meterAtFault ?? eq.currentMeter,
            description: report.symptomDescription,
            initialRequestDescription: report.symptomDescription,
            symptomsText: report.symptomDescription,
            intervenedSystemsJson: [report.affectedSystem],
          },
        });

        return tx.faultReport.update({
          where: { id: report.id },
          data: {
            workOrderId: workOrder.id,
            status: FaultReportStatus.LINKED,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  // ── Listado paginado ────────────────────────────────────────────────────────

  async findAll(user: any, query: ListFaultReportsQuery = {}) {
    const tenantId = user.tenantId as string;

    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSizeRaw = parseInt(String(query.pageSize ?? '25'), 10) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const skip = (page - 1) * pageSize;

    const where: Prisma.FaultReportWhereInput = { tenantId };

    if (query.equipmentId?.trim()) {
      where.equipmentId = query.equipmentId.trim();
    }
    if (query.criticality) {
      where.criticality = query.criticality;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.dateFrom || query.dateTo) {
      where.eventDate = {};
      if (query.dateFrom) {
        where.eventDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        where.eventDate.lte = to;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.faultReport.findMany({
        where,
        include: this.listInclude,
        orderBy: { eventDate: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.faultReport.count({ where }),
    ]);

    return { data: rows, total, page, pageSize };
  }

  // ── Detalle ─────────────────────────────────────────────────────────────────

  async findOne(id: string, user: any) {
    const tenantId = user.tenantId as string;

    const report = await this.prisma.faultReport.findFirst({
      where: { id, tenantId },
      include: this.detailInclude,
    });

    if (!report) {
      throw new NotFoundException(
        'El reporte de falla no existe o no pertenece a este tenant.',
      );
    }

    return report;
  }

  // ── Adjuntos multimedia ──────────────────────────────────────────────────────

  /**
   * Sube un archivo de evidencia (foto/video) y persiste el registro.
   *
   * Reglas de negocio:
   *   - MIME permitidos: image/jpeg, image/png, image/webp, video/mp4.
   *   - Tamaño máximo: 10 MB por archivo.
   *   - Límite: 3 adjuntos por reporte.
   *   - El reporte debe pertenecer al tenant del usuario autenticado.
   */
  async uploadAttachment(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    user: any,
  ) {
    const tenantId = user.tenantId as string;

    // ── Validar MIME (defense in depth; multer ya limita tamaño) ─────────────
    if (!FR_ATTACHMENT_ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        'Tipo de archivo no permitido. Solo se aceptan JPG, PNG, WEBP y MP4.',
      );
    }

    // ── Validar tamaño explícito (segunda capa) ───────────────────────────────
    if (file.buffer.length > FR_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(
        'El archivo supera el máximo de 10 MB permitido por reporte de falla.',
      );
    }

    // ── Validar que el reporte existe y pertenece al tenant ───────────────────
    const report = await this.prisma.faultReport.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!report) {
      throw new NotFoundException(
        'El reporte de falla no existe o no pertenece a este tenant.',
      );
    }

    // ── Validar límite de adjuntos ────────────────────────────────────────────
    const existingCount = await this.prisma.faultReportAttachment.count({
      where: { faultReportId: id },
    });
    if (existingCount >= FR_ATTACHMENT_MAX_COUNT) {
      throw new ConflictException(
        `El reporte ya tiene el máximo de ${FR_ATTACHMENT_MAX_COUNT} adjuntos permitidos.`,
      );
    }

    // ── Subir al proveedor de storage ─────────────────────────────────────────
    const storageKey = await this.storageService.uploadFile(
      file,
      `fault-reports/${tenantId}/${id}`,
    );

    // ── Persistir registro ────────────────────────────────────────────────────
    return this.prisma.faultReportAttachment.create({
      data: {
        faultReportId: id,
        storageKey,
        fileName: file.originalname,
        fileType: file.mimetype,
        sizeBytes: file.buffer.length,
      },
    });
  }
}
