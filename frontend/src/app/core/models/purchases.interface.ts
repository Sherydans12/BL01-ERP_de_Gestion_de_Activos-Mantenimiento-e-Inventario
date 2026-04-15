/**
 * Vínculos opcionales con flota y OT (misma forma que devuelve el API en compras).
 */
export interface PurchaseEquipmentLink {
  id: string;
  internalId: string;
  plate?: string | null;
  brand: string;
  model: string;
  type: string;
}

export interface PurchaseWorkOrderLink {
  id: string;
  correlative: string;
  description: string;
}

export interface RequisitionItemInput {
  id?: string;
  inventoryItemId?: string | null;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  estimatedCost?: number | null;
  partNumber?: string;
  itemNotes?: string;
}

export interface CreateRequisitionPayload {
  contractId: string;
  subcontractId?: string;
  description: string;
  justification?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  workOrderId?: string | null;
  equipmentId?: string | null;
  items: RequisitionItemInput[];
}

export interface UpdateRequisitionPayload {
  description?: string;
  justification?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  workOrderId?: string | null;
  equipmentId?: string | null;
  items?: RequisitionItemInput[];
}
