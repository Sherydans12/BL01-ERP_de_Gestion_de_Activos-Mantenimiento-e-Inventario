/** Respuesta de `GET /work-orders/stats` (dashboard principal). */
export interface DashboardKpiStrip {
  activeOts: number;
  legalDocsAttention30d: number;
  lowStockLines: number;
  requisitionsPipeline: number;
  purchaseOrdersInbound: number;
}

export interface DashboardPmRow {
  id: string;
  internalId: string;
  plate: string | null;
  meterType: string;
  remainingUnits: number;
  interval: number;
  nextDueMeter: number;
  urgencyPct: number;
}

export interface DashboardOpenOtRow {
  id: string;
  correlative: string;
  status: string;
  createdAt: string;
  equipment: { internalId: string; type: string } | null;
}

export interface DashboardPurchaseReqRow {
  id: string;
  correlative: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export interface DashboardPurchaseOrderRow {
  id: string;
  correlative: string;
  status: string;
  updatedAt: string;
}

export interface DashboardLowStockRow {
  warehouseCode: string;
  partNumber: string;
  name: string;
  quantity: number;
  minStock: number;
}

export interface DashboardLegalAlert {
  id: string;
  internalId: string;
  plate: string | null;
  daysRemaining: number;
  docLabel: string;
}

export interface DashboardStats {
  otsByStatus: {
    OPEN: number;
    IN_PROGRESS: number;
    ON_HOLD: number;
    CLOSED: number;
  };
  expiredDocs: number;
  totalEquipments: number;
  equiposEnMantenimiento: number;
  disponibilidad: number;
  lastClosed: {
    id: string;
    correlative: string;
    closedAt: string | null;
    description?: string | null;
    equipment?: { internalId: string } | null;
  }[];
  topAlerts: DashboardLegalAlert[];
  /** Presente desde API extendido; el dashboard normaliza si falta. */
  kpiStrip?: DashboardKpiStrip;
  pmDueSoon?: DashboardPmRow[];
  openOtsHot?: DashboardOpenOtRow[];
  purchaseRequisitionsAttention?: DashboardPurchaseReqRow[];
  purchaseOrdersInbound?: DashboardPurchaseOrderRow[];
  lowStocks?: DashboardLowStockRow[];
}
