// Enums
export enum MeterType {
  HOURS = 'HOURS',
  KILOMETERS = 'KILOMETERS',
}

export enum OtCategory {
  PROGRAMADA = 'PROGRAMADA',
  NO_PROGRAMADA_CORRECTIVA = 'NO_PROGRAMADA_CORRECTIVA',
  NO_PROGRAMADA_REACTIVA = 'NO_PROGRAMADA_REACTIVA',
}

// Contratos y Subcontratos
export interface Contract {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  subcontracts?: Subcontract[];
}

export interface Subcontract {
  id: string;
  contractId: string;
  code: string;
  name: string;
  isActive: boolean;
  contract?: Contract;
}

// Maestro de Flota
export interface Equipment {
  id: string;
  contractId?: string; // Añadido para la asignación directa al contrato
  subcontractId?: string; // Ahora es opcional
  mineInternalId?: string;
  internalId: string;
  plate?: string;
  type: string;
  brand: string;
  model: string;

  meterType: MeterType;
  initialMeter: number;
  currentMeter: number;

  // Operación
  vin?: string;
  engineNumber?: string;
  year?: number;
  fuelType?: string;
  driveType?: string;
  ownership?: string;

  // Mantenimiento y Vencimientos (DateTime transformado a string ISO)
  maintenanceFrequency?: number;
  /** Override del intervalo PM (horas o km según meterType). Si null, usa reglas por tipo (`pm-interval.ts`). */
  pmIntervalOverride?: number | null;
  lastMaintenanceDate?: string;
  lastMaintenanceMeter?: number;
  lastMaintenanceType?: string;

  techReviewExp?: string;
  circPermitExp?: string;
  soapExp?: string;
  mechanicalCertExp?: string;
  liabilityPolicyExp?: string;

  // Relaciones Pobladas
  contract?: Contract; // Relación añadida para la vista 'ALL'
  subcontract?: Subcontract;
}

// Órdenes de Trabajo (Nuevos modelos TPM)
export interface WorkOrderTask {
  id?: string;
  description: string;
  isCompleted: boolean;
  observation?: string;
  measurement?: number;
}

export interface WorkOrderPart {
  id?: string;
  partNumber: string;
  description: string;
  quantity: number;
}

export interface WorkOrder {
  id: string;
  correlative: string;
  equipmentId: string;
  category: OtCategory;
  maintenanceType: string;
  status: string;
  initialMeter: number;
  finalMeter: number;
  description: string;
  createdAt: string;
  closedAt?: string;
  equipment?: Equipment;
  responsible?: string;
  tasks?: WorkOrderTask[];
  parts?: WorkOrderPart[];
  fluids?: any[];
  systems?: any[];
}

export type MeterLogSource = 'OT' | 'MANUAL' | 'TELEMETRY';

/** Historial unificado de lecturas / cambios de medidor (maestro + OT + telemetría). */
export interface EquipmentMeterLog {
  id: string;
  equipmentId?: string;
  oldValue: string | number;
  newValue: string | number;
  source: MeterLogSource;
  sourceId?: string | null;
  date: string;
  user?: { name?: string; email?: string };
  /** Solo si source === OT y el backend resolvió la OT */
  workOrderCorrelative?: string | null;
}

/** Fila del tablero de captura masiva de horómetro (`GET /equipments/meter-capture-board`). */
export interface MeterCaptureBoardRow {
  id: string;
  internalId: string;
  displayName: string;
  type: string;
  currentMeter: number;
  meterType: MeterType;
  lastReadingAt: string | null;
  contractCode: string | null;
  subcontractCode: string | null;
}

export interface MeterCaptureBoardResponse {
  limit: number;
  data: MeterCaptureBoardRow[];
}

export type MeterBulkSyncErrorCode =
  | 'READING_LOWER_THAN_CURRENT'
  | 'EQUIPMENT_NOT_FOUND_OR_FORBIDDEN';

export interface MeterBulkSyncErrorItem {
  equipmentId: string;
  error: MeterBulkSyncErrorCode;
  /** Medidor actual en BD cuando `error === READING_LOWER_THAN_CURRENT`. */
  serverValue?: number;
}

export interface MeterBulkSyncAppliedItem {
  equipmentId: string;
  internalId: string;
  from: number;
  to: number;
}

export interface MeterBulkSyncResponse {
  successCount: number;
  unchangedCount: number;
  errors: MeterBulkSyncErrorItem[];
  applied: MeterBulkSyncAppliedItem[];
}

/** Respuesta ligera para widget OT / caché offline */
export interface EquipmentMeterSnapshot {
  equipmentId: string;
  currentMeter: number;
  meterType: MeterType;
  internalId: string;
  lastLog: {
    date: string;
    source: MeterLogSource;
    sourceId: string | null;
    otCorrelative: string | null;
    userName: string | null;
  } | null;
}

// Ajustes de Medidor (Horómetro/Odómetro)
export interface MeterAdjustment {
  id: string;
  equipmentId: string;
  userId: string;
  oldValue: number;
  newValue: number;
  date: string;
  reason?: string;
  user?: { name: string; email: string };
}

/** Costos imputados al activo desde recepciones de OC (compras externas). */
export interface AssetCostRecord {
  id: string;
  equipmentId: string;
  amount: string | number;
  type: 'PURCHASE';
  referenceId: string;
  warehouseReceiptId?: string | null;
  recordedAt: string;
  purchaseOrder?: { correlative: string };
  warehouseReceipt?: { correlative: string } | null;
}

// Respuesta analítica para el modal de detalle
export interface EquipmentAnalytics {
  equipment: Equipment;
  workOrders: WorkOrder[];
  meterAdjustments: MeterAdjustment[];
  /** Costos por compras externas imputados al activo (recepciones de OC con equipo). */
  assetCostRecords?: AssetCostRecord[];
  /** Bitácora cronológica de medidor (valor acumulado por evento). */
  meterLogs?: EquipmentMeterLog[];
}

// Usuario (Payload Auth)
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant: {
    id: string;
    name: string;
    logoUrl?: string;
  } | null;
  allowedContracts: string[]; // Reemplaza allowedSites
}
