/**
 * Campos escalares permitidos desde el cliente en create/update de Equipment.
 * No incluye id, tenantId, createdAt, updatedAt.
 */
export const EQUIPMENT_WRITABLE_KEYS = [
  'contractId',
  'subcontractId',
  'mineInternalId',
  'internalId',
  'plate',
  'type',
  'brand',
  'model',
  'meterType',
  'initialMeter',
  'currentMeter',
  'vin',
  'engineNumber',
  'serialNumber',
  'year',
  'fuelType',
  'driveType',
  'ownership',
  'isSubleased',
  'subleaseCompanyName',
  'maintenanceFrequency',
  'pmIntervalOverride',
  'lastMaintenanceDate',
  'lastMaintenanceMeter',
  'lastMaintenanceType',
  'techReviewExp',
  'circPermitExp',
  'soapExp',
  'mechanicalCertExp',
  'liabilityPolicyExp',
] as const;

export type EquipmentWritableKey = (typeof EQUIPMENT_WRITABLE_KEYS)[number];

export function pickEquipmentWritablePayload(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EQUIPMENT_WRITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key];
    }
  }
  return out;
}
