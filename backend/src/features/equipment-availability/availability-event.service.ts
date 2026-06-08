import { Injectable } from '@nestjs/common';
import {
  AvailabilityEventSource,
  OperationalStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RegisterAvailabilityEventInput {
  tenantId: string;
  availabilityId: string;
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
    const previousEvent = await tx.availabilityEvent.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        eventAt: { lt: input.eventAt },
      },
      select: { eventAt: true, status: true },
      orderBy: { eventAt: 'desc' },
    });

    const previousStatus = input.previousStatus ?? previousEvent?.status ?? null;
    const elapsedMinutes = previousEvent
      ? Math.max(
          0,
          Math.floor(
            (input.eventAt.getTime() - previousEvent.eventAt.getTime()) /
              60_000,
          ),
        )
      : null;

    return tx.availabilityEvent.create({
      data: {
        tenantId: input.tenantId,
        availabilityId: input.availabilityId,
        equipmentId: input.equipmentId,
        reportedById: input.reportedById ?? null,
        status: input.status,
        previousStatus,
        meterReading: input.meterReading ?? null,
        comments: input.comments ?? null,
        eventAt: input.eventAt,
        source: input.source ?? AvailabilityEventSource.MANUAL,
        elapsedMinutes,
      },
    });
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
      orderBy: { eventAt: 'asc' },
    });
  }
}
