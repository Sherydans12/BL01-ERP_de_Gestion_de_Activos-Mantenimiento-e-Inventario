import { Prisma } from '@prisma/client';

/** Capa unificada para UI / frases naturales (además de oldValue/newValue). */
export type UnifiedActivityLayer = {
  field?: string;
  prev?: unknown;
  next?: unknown;
  metadata?: Record<string, unknown>;
};

function serializeScalar(v: unknown): unknown {
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
  return v;
}

/**
 * Construye el JSON `details` para `activity_logs`: prev/next/field/metadata + oldValue/newValue.
 */
export function buildActivityLogDetails(
  oldValue?: Record<string, unknown> | null,
  newValue?: Record<string, unknown> | null,
  unified?: UnifiedActivityLayer,
): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};

  if (unified?.field) out.field = unified.field;
  if (unified != null && unified.prev !== undefined) {
    out.prev = serializeScalar(unified.prev);
  }
  if (unified != null && unified.next !== undefined) {
    out.next = serializeScalar(unified.next);
  }
  if (unified?.metadata && Object.keys(unified.metadata).length > 0) {
    out.metadata = { ...unified.metadata };
  }

  if (oldValue && Object.keys(oldValue).length > 0) {
    out.oldValue = serializeRecord(oldValue);
  }
  if (newValue && Object.keys(newValue).length > 0) {
    out.newValue = serializeRecord(newValue);
  }

  return out as Prisma.InputJsonValue;
}

function serializeRecord(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      o[k] = serializeRecord(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      o[k] = v.map((x) =>
        x !== null && typeof x === 'object' && !(x instanceof Date)
          ? serializeRecord(x as Record<string, unknown>)
          : serializeScalar(x),
      );
    } else {
      o[k] = serializeScalar(v);
    }
  }
  return o;
}
