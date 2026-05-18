import { Injectable } from '@nestjs/common';
import { ActivityAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildActivityLogDetails,
  type UnifiedActivityLayer,
} from './activity-log-details.util';

export type AuditEntityType =
  | 'PURCHASE_ORDER'
  | 'REQUISITION'
  | 'PURCHASE_INVOICE'
  | 'PURCHASE_DOCUMENT'
  | 'WORK_ORDER'
  | 'INVENTORY_ITEM';

/** Devuelve solo las claves cuyo valor serializado difiere entre `before` y `after`. */
export function pickChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const va = before[key];
    const vb = after[key];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      oldValue[key] = va;
      newValue[key] = vb;
    }
  }
  return { oldValue, newValue };
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra un evento de auditoría. En `details` solo deben incluirse campos relevantes
   * (p. ej. diff de oldValue/newValue con las claves que cambiaron).
   */
  async log(params: {
    userId: string;
    tenantId: string;
    entityType: AuditEntityType;
    entityId: string;
    action: ActivityAction;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    unified?: UnifiedActivityLayer;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const details = buildActivityLogDetails(
      params.oldValue,
      params.newValue,
      params.unified,
    );
    await this.prisma.activityLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        details,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  }

  /** Inserción masiva (p. ej. varias OC en un split) sin N+1. */
  async logMany(
    entries: Array<Parameters<AuditService['log']>[0]>,
  ): Promise<void> {
    if (!entries.length) return;
    await this.prisma.activityLog.createMany({
      data: entries.map((params) => ({
        tenantId: params.tenantId,
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        details: buildActivityLogDetails(
          params.oldValue,
          params.newValue,
          params.unified,
        ),
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      })),
    });
  }
}
