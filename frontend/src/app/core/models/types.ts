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

// Respuesta analítica para el modal de detalle
export interface EquipmentAnalytics {
  equipment: Equipment;
  workOrders: WorkOrder[];
  meterAdjustments: MeterAdjustment[];
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
