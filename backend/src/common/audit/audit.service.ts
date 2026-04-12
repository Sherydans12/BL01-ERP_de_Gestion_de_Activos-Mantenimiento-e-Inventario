import { Injectable } from '@nestjs/common';
import { ActivityAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type AuditEntityType = 'PURCHASE_ORDER' | 'REQUISITION';

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
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const details = this.buildDetails(params.oldValue, params.newValue);
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

  private buildDetails(
    oldValue?: Record<string, unknown> | null,
    newValue?: Record<string, unknown> | null,
  ): Prisma.InputJsonValue {
    const out: Record<string, unknown> = {};
    if (oldValue && Object.keys(oldValue).length > 0) {
      out.oldValue = this.serializeJson(oldValue);
    }
    if (newValue && Object.keys(newValue).length > 0) {
      out.newValue = this.serializeJson(newValue);
    }
    return out as Prisma.InputJsonValue;
  }

  private serializeJson(obj: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      o[k] = this.serializeValue(v);
    }
    return o;
  }

  private serializeValue(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object' && v !== null && 'toNumber' in v) {
      try {
        return (v as { toNumber: () => number }).toNumber();
      } catch {
        return String(v);
      }
    }
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map((x) => this.serializeValue(x));
    if (typeof v === 'object') return this.serializeJson(v as Record<string, unknown>);
    return v;
  }
}
