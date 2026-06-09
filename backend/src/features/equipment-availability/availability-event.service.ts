import { Injectable, BadRequestException } from '@nestjs/common';
import {
  AvailabilityEventSource,
  OperationalStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RegisterAvailabilityEventInput {
  tenantId: string;
  availabilityId?: string | null;
  faultReportId?: string | null;
  equipmentId: string;
  reportedById?: string | null;
  status: OperationalStatus;
  previousStatus?: OperationalStatus | null;
  meterReading?: number | null;
  comments?: string | null;
  eventAt: Date;
  source?: AvailabilityEventSource;
}

@Injectable()
export class AvailabilityEventService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    tx: Prisma.TransactionClient,
    input: RegisterAvailabilityEventInput,
  ) {
    const source = input.source ?? AvailabilityEventSource.MANUAL;

    switch (source) {
      case AvailabilityEventSource.FAULT_REPORT:
        if (!input.faultReportId) {
          throw new BadRequestException('faultReportId es requerido para eventos de falla.');
        }
        if (input.availabilityId) {
          throw new BadRequestException('availabilityId no debe informarse para eventos de falla.');
        }
        const report = await tx.faultReport.findFirst({
          where: { id: input.faultReportId },
          select: { tenantId: true, equipmentId: true },
        });
        if (!report || report.tenantId !== input.tenantId || report.equipmentId !== input.equipmentId) {
          throw new BadRequestException('El FaultReport no existe o no corresponde al mismo tenant/equipo.');
        }
        break;

      case AvailabilityEventSource.MANUAL:
      case AvailabilityEventSource.LEGACY_SNAPSHOT:
        if (!input.availabilityId) {
          throw new BadRequestException(`availabilityId es requerido para el origen ${source}.`);
        }
        if (input.faultReportId) {
          throw new BadRequestException(`faultReportId no debe informarse para el origen ${source}.`);
        }
        break;

      case AvailabilityEventSource.OT:
        throw new BadRequestException('El origen OT aún no está soportado (requiere workOrderId).');
        
      default:
        throw new BadRequestException(`Origen ${source} no reconocido.`);
    }

    const initialEvent = await tx.availabilityEvent.create({
      data: {
        tenantId: input.tenantId,
        availabilityId: input.availabilityId ?? null,
        faultReportId: input.faultReportId ?? null,
        equipmentId: input.equipmentId,
        reportedById: input.reportedById ?? null,
        status: input.status,
        previousStatus: null,
        meterReading: input.meterReading ?? null,
        comments: input.comments ?? null,
        eventAt: input.eventAt,
        source,
        elapsedMinutes: null,
      },
    });

    const predecessor = await tx.availabilityEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        OR: [
          { eventAt: { lt: initialEvent.eventAt } },
          {
            eventAt: initialEvent.eventAt,
            createdAt: { lt: initialEvent.createdAt },
          },
          {
            eventAt: initialEvent.eventAt,
            createdAt: initialEvent.createdAt,
            id: { lt: initialEvent.id },
          },
        ],
      },
      orderBy: [
        { eventAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });

    const successor = await tx.availabilityEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        OR: [
          { eventAt: { gt: initialEvent.eventAt } },
          {
            eventAt: initialEvent.eventAt,
            createdAt: { gt: initialEvent.createdAt },
          },
          {
            eventAt: initialEvent.eventAt,
            createdAt: initialEvent.createdAt,
            id: { gt: initialEvent.id },
          },
        ],
      },
      orderBy: [
        { eventAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    const previousStatus = input.previousStatus ?? predecessor?.status ?? null;
    const elapsedMinutes = predecessor
      ? Math.max(
          0,
          Math.floor(
            (initialEvent.eventAt.getTime() - predecessor.eventAt.getTime()) / 60_000,
          ),
        )
      : null;

    const updatedEvent = await tx.availabilityEvent.update({
      where: { id: initialEvent.id },
      data: {
        previousStatus,
        elapsedMinutes,
      },
    });

    if (successor) {
      const sElapsedMinutes = Math.max(
        0,
        Math.floor(
          (successor.eventAt.getTime() - initialEvent.eventAt.getTime()) / 60_000,
        ),
      );
      await tx.availabilityEvent.update({
        where: { id: successor.id },
        data: {
          previousStatus: initialEvent.status,
          elapsedMinutes: sElapsedMinutes,
        },
      });
    }

    return updatedEvent;
  }

  async findTimeline(
    tenantId: string,
    equipmentId: string,
    options: { dateFrom?: Date; dateTo?: Date } = {},
  ) {
    return this.prisma.availabilityEvent.findMany({
      where: {
        tenantId,
        equipmentId,
        ...(options.dateFrom || options.dateTo
          ? {
              eventAt: {
                ...(options.dateFrom ? { gte: options.dateFrom } : {}),
                ...(options.dateTo ? { lte: options.dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [
        { eventAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });
  }
}
