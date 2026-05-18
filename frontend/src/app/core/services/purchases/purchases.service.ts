import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { resolveUploadPublicUrl } from '../../utils/media-url';

export interface CreateOrdersFromRequisitionResult {
  orders: PurchaseOrder[];
  requisitionStatus: string;
  idempotent?: boolean;
}
import { HttpResponse } from '@angular/common/http';
import type {
  CreateRequisitionPayload,
  PurchaseEquipmentLink,
  PurchaseWorkOrderLink,
  UpdateRequisitionPayload,
} from '../../models/purchases.interface';

export type {
  CreateRequisitionPayload,
  PurchaseEquipmentLink,
  PurchaseWorkOrderLink,
  UpdateRequisitionPayload,
} from '../../models/purchases.interface';

export interface PurchaseSettings {
  id: string;
  tenantId: string;
  approvalThreshold: number;
  currency: string;
  /** Margen relativo para 3-way match (p. ej. 1 = 1%). */
  invoiceMatchTolerancePercent?: number;
  approvalPolicies: ApprovalPolicy[];
}

export interface ApprovalPolicyUser {
  userId: string;
  user: { id: string; name: string; email: string; role: string; customRole?: { id: string; name: string } | null };
}

export interface ApprovalPolicy {
  id: string;
  level: number;
  description?: string;
  minAmount: number;
  allowedUsers: ApprovalPolicyUser[];
}

/** Payload adjudicación por ítem (split multiproveedor). */
export interface LineAward {
  requisitionItemId: string;
  quotationItemId: string;
}

/** OC vinculada al requerimiento (listado en detalle SRC). */
export interface RequisitionLinkedPurchaseOrder {
  id: string;
  correlative: string;
  status: string;
  totalAmount: number;
  currency: string;
  quotationId?: string | null;
  items?: Array<{ sourceQuotationItemId?: string | null }>;
}

export interface RequisitionReconciliationSnapshot {
  totalRequisitionLines: number;
  linesInProcurement: number;
  linesFullyReceived: number;
  linesWithInvoice: number;
  adjudicatedLineCount: number;
  allAdjudicatedLinesFullyReconciled: boolean;
  adjudicatedMatrixTotal: number;
  invoicesTotal: number;
  currency: string | null;
  budgetExceeded: boolean;
}

export interface PurchaseRequisition {
  id: string;
  correlative: string;
  contractId: string;
  subcontractId?: string;
  requestedById: string;
  status: string;
  /** Baja | Media | Alta */
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
  justification?: string;
  equipmentId?: string | null;
  workOrderId?: string | null;
  equipment?: PurchaseEquipmentLink | null;
  workOrder?: PurchaseWorkOrderLink | null;
  items: RequisitionItem[];
  quotations?: PurchaseQuotation[];
  purchaseOrders?: RequisitionLinkedPurchaseOrder[];
  requestedBy?: { id: string; name: string; email: string };
  contract?: { id: string; code: string; name: string };
  subcontract?: { id: string; code: string; name: string };
  createdAt: string;
  _count?: { items: number; quotations: number };
  /** Avance 3-way agregado (varias OC / facturas). */
  reconciliationSnapshot?: RequisitionReconciliationSnapshot;
}

export interface RequisitionItem {
  id: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  estimatedCost?: number;
  inventoryItemId?: string;
  /** Nº de parte indicado por el solicitante (opcional) */
  partNumber?: string | null;
  /** Notas / especificación opcional */
  itemNotes?: string | null;
  inventoryItem?: { id: string; partNumber: string; name: string };
  /** Línea de cotización adjudicada (persistida vía saveLineAwards). */
  awardedQuotationItemId?: string | null;
  awardedQuotationItem?: {
    id: string;
    unitPrice: number;
    quotation?: {
      id: string;
      vendorId: string;
      currency: string;
      vendor?: { id: string; code: string; name: string };
    };
  } | null;
}

export interface PurchaseQuotation {
  id: string;
  vendorId: string;
  totalAmount: number;
  currency: string;
  deliveryDays?: number;
  paymentDays?: number | null;
  validUntil?: string;
  attachmentUrl?: string;
  status: string;
  isWinner: boolean;
  vendor?: {
    id: string;
    code: string;
    name: string;
    rut?: string | null;
    address?: string | null;
    city?: string | null;
    businessActivity?: string | null;
    fax?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
  };
  items: QuotationItem[];
  createdAt: string;
}

export interface QuotationItem {
  id: string;
  requisitionItemId: string;
  unitPrice: number;
  brand?: string;
  notes?: string;
  requisitionItem?: {
    id: string;
    description: string;
    quantity: number;
    unitOfMeasure: string;
    partNumber?: string | null;
    itemNotes?: string | null;
    inventoryItem?: { id: string; partNumber: string; name: string };
  };
}

export type PurchaseInvoiceStatus = 'PENDING' | 'MATCHED' | 'DISCREPANCY' | 'PAID';

export interface PurchaseInvoice {
  id: string;
  tenantId: string;
  vendorId: string;
  purchaseOrderId: string;
  invoiceNumber: string;
  emissionDate: string;
  /** Vencimiento para calendario de pagos. */
  dueDate?: string | null;
  totalAmount: number;
  /** Monto neto (opcional, registro manual). */
  netAmount?: number | null;
  /** IVA u otros impuestos (opcional, registro manual). */
  taxAmount?: number | null;
  status: PurchaseInvoiceStatus;
  pdfUrl?: string | null;
  paymentReference?: string | null;
  paidAt?: string | null;
  /** Excepción manual 3-way (short shipment). */
  threeWayMatchOverruled?: boolean;
  threeWayMatchOverruledAt?: string | null;
  threeWayMatchOverruledById?: string | null;
  threeWayMatchOverruleNotes?: string | null;
  vendor?: { id: string; name: string; code: string };
  purchaseOrder?: {
    id: string;
    correlative: string;
    totalAmount: number;
    status: string;
    contractId?: string;
  };
  /** Presente en respuestas API enriquecidas. */
  hasDiscrepancy?: boolean;
  discrepancyReason?: string;
  match?: {
    poAmount: number;
    invoiceAmount: number;
    creditNotesAmount: number;
    netInvoiceAmount: number;
    receivedAmount: number;
    tolerancePercent: number;
    matchPo: boolean;
    matchReceived: boolean;
    reasons: string[];
  };
}

export interface PurchaseCreditNote {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  purchaseInvoiceId?: string | null;
  creditNoteNumber: string;
  emissionDate: string;
  totalAmount: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrder {
  id: string;
  correlative: string;
  contractId: string;
  subcontractId?: string;
  quotationId?: string;
  status: string;
  totalAmount: number;
  currency: string;
  requiredSignatures: number;
  notes?: string;
  deliveryAddress?: string | null;
  paymentTerms?: string | null;
  equipmentId?: string | null;
  workOrderId?: string | null;
  equipment?: PurchaseEquipmentLink | null;
  workOrder?: PurchaseWorkOrderLink | null;
  items: PurchaseOrderItem[];
  approvals: PurchaseOrderApproval[];
  receipts?: WarehouseReceipt[];
  purchaseInvoices?: PurchaseInvoice[];
  purchaseCreditNotes?: PurchaseCreditNote[];
  quotation?: PurchaseQuotation & {
    requisition?: {
      id: string;
      correlative: string;
      description: string;
      /** Todas las cotizaciones del requerimiento (comparativo; la OC surge de la ganadora). */
      quotations?: PurchaseQuotation[];
    };
  };
  contract?: { id: string; code: string; name: string };
  subcontract?: { id: string; code: string; name: string };
  createdAt: string;
  /** Marca de envío al proveedor (lead time / KPI). */
  sentAt?: string | null;
  _count?: { approvals: number; items: number };
}

export interface PurchaseOrderItem {
  id: string;
  description: string;
  quantity: number;
  unitCost: number;
  inventoryItemId?: string;
  inventoryItem?: { id: string; partNumber: string; name: string; isInventory?: boolean };
  sourceQuotationItemId?: string | null;
}

export interface PurchaseOrderApproval {
  id: string;
  level: number;
  comment?: string;
  signatureHash: string;
  integrityStatus: 'VALID' | 'COMPROMISED';
  approvedAt: string;
  policy?: { id: string; level: number; description: string };
  approvedBy?: { id: string; name: string; email: string };
}

export interface WarehouseReceipt {
  id: string;
  correlative: string;
  purchaseOrderId: string;
  warehouseId: string;
  receivedById: string;
  status: string;
  observations?: string;
  receivedAt?: string;
  items: ReceiptItem[];
  purchaseOrder?: {
    id: string;
    correlative: string;
    totalAmount: number;
    status: string;
    contract?: { id: string; code: string; name: string };
    subcontract?: { id: string; code: string; name: string } | null;
    equipment?: PurchaseEquipmentLink | null;
    workOrder?: PurchaseWorkOrderLink | null;
  };
  warehouse?: { id: string; code: string; name: string; location?: string | null };
  receivedBy?: { id: string; name: string };
  createdAt: string;
  _count?: { items: number };
}

export interface ReceiptItem {
  id: string;
  orderItemId: string;
  quantityExpected: number;
  quantityReceived: number;
  observations?: string;
  /** OC − suma recibida en otras recepciones (mismo `orderItemId`); solo detalle GET. */
  quantityPendingOnPurchase?: number;
  orderItem?: PurchaseOrderItem & {
    inventoryItem?: {
      id: string;
      partNumber: string;
      name: string;
      unitOfMeasure: { id: string; name: string; abbreviation: string };
    };
  };
}

export type ActivityLogAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'SIGNATURE'
  | 'SYSTEM_UPDATE';

export interface ActivityLogDetails {
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  /** Capa unificada (diff por campo) — alineada con backend. */
  field?: string;
  prev?: unknown;
  next?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ActivityLogEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: ActivityLogAction;
  entityType: string;
  entityId: string;
  details: ActivityLogDetails;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user: { id: string; name: string; email?: string | null };
}

@Injectable({ providedIn: 'root' })
export class PurchasesService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  private normalizeQuotationMedia(quotation?: PurchaseQuotation | null): void {
    if (!quotation) return;
    if (quotation.attachmentUrl) {
      quotation.attachmentUrl = resolveUploadPublicUrl(quotation.attachmentUrl) ?? undefined;
    }
  }

  private normalizeInvoiceMedia(invoice?: PurchaseInvoice | null): void {
    if (!invoice) return;
    if (invoice.pdfUrl) {
      invoice.pdfUrl = resolveUploadPublicUrl(invoice.pdfUrl);
    }
  }

  private normalizeRequisitionMedia(req: PurchaseRequisition): PurchaseRequisition {
    req.quotations?.forEach((q) => this.normalizeQuotationMedia(q));
    return req;
  }

  private normalizeOrderMedia(order: PurchaseOrder): PurchaseOrder {
    this.normalizeQuotationMedia(order.quotation);
    order.quotation?.requisition?.quotations?.forEach((q) =>
      this.normalizeQuotationMedia(q),
    );
    order.purchaseInvoices?.forEach((inv) => this.normalizeInvoiceMedia(inv));
    return order;
  }

  // -- Notas de crédito --
  getCreditNotes(purchaseOrderId: string): Observable<PurchaseCreditNote[]> {
    return this.http.get<PurchaseCreditNote[]>(
      `${this.base}/purchase-credit-notes`,
      { params: { purchaseOrderId } },
    );
  }

  createCreditNote(data: {
    purchaseOrderId: string;
    purchaseInvoiceId?: string | null;
    creditNoteNumber: string;
    emissionDate: string;
    totalAmount: number;
    notes?: string | null;
  }): Observable<PurchaseCreditNote> {
    return this.http.post<PurchaseCreditNote>(
      `${this.base}/purchase-credit-notes`,
      data,
    );
  }

  deleteCreditNote(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/purchase-credit-notes/${id}`);
  }

  // -- Settings --
  getSettings(): Observable<PurchaseSettings> {
    return this.http.get<PurchaseSettings>(`${this.base}/purchase-settings`);
  }

  updateSettings(data: {
    approvalThreshold?: number;
    currency?: string;
    invoiceMatchTolerancePercent?: number;
  }): Observable<PurchaseSettings> {
    return this.http.put<PurchaseSettings>(`${this.base}/purchase-settings`, data);
  }

  getPolicies(): Observable<ApprovalPolicy[]> {
    return this.http.get<ApprovalPolicy[]>(`${this.base}/purchase-settings/policies`);
  }

  upsertPolicies(policies: Partial<ApprovalPolicy>[]): Observable<ApprovalPolicy[]> {
    return this.http.put<ApprovalPolicy[]>(`${this.base}/purchase-settings/policies`, { policies });
  }

  // -- Requisitions --
  getRequisitions(params?: { contractId?: string; status?: string }): Observable<PurchaseRequisition[]> {
    return this.http
      .get<PurchaseRequisition[]>(`${this.base}/purchase-requisitions`, { params: params as any })
      .pipe(map((rows) => rows.map((r) => this.normalizeRequisitionMedia(r))));
  }

  getRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http
      .get<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}`)
      .pipe(map((row) => this.normalizeRequisitionMedia(row)));
  }

  getRequisitionActivityLogs(id: string): Observable<ActivityLogEntry[]> {
    return this.http.get<ActivityLogEntry[]>(
      `${this.base}/purchase-requisitions/${id}/logs`,
    );
  }

  createRequisition(
    data: CreateRequisitionPayload,
  ): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(
      `${this.base}/purchase-requisitions`,
      data,
    );
  }

  updateRequisition(
    id: string,
    data: UpdateRequisitionPayload,
  ): Observable<PurchaseRequisition> {
    return this.http.patch<PurchaseRequisition>(
      `${this.base}/purchase-requisitions/${id}`,
      data,
    );
  }

  submitRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}/submit`, {});
  }

  cancelRequisition(id: string, reason: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(
      `${this.base}/purchase-requisitions/${id}/cancel`,
      { reason },
    );
  }

  duplicateRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}/duplicate`, {});
  }

  /**
   * Transiciones de estado soportadas en el backend (p. ej. SUBMITTED → QUOTING vía start-quoting).
   */
  updateStatus(id: string, status: string): Observable<PurchaseRequisition> {
    if (status === 'QUOTING') {
      return this.http.post<PurchaseRequisition>(
        `${this.base}/purchase-requisitions/${id}/start-quoting`,
        {},
      );
    }
    return throwError(
      () => new Error(`Transición de estado no soportada: ${status}`),
    );
  }

  addQuotation(requisitionId: string, data: any, file?: File): Observable<PurchaseQuotation> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(data));
    if (file) formData.append('attachment', file);
    return this.http
      .post<PurchaseQuotation>(
        `${this.base}/purchase-requisitions/${requisitionId}/quotations`,
        formData,
      )
      .pipe(
        map((q) => {
          this.normalizeQuotationMedia(q);
          return q;
        }),
      );
  }

  selectQuotation(requisitionId: string, quotationId: string): Observable<PurchaseQuotation> {
    return this.http.post<PurchaseQuotation>(
      `${this.base}/purchase-requisitions/${requisitionId}/quotations/${quotationId}/select`, {},
    );
  }

  /**
   * Persiste adjudicación por ítem (split multiproveedor).
   * El backend devuelve el requerimiento actualizado; aquí se expone como void para simplificar el consumo.
   */
  saveLineAwards(
    requisitionId: string,
    awards: LineAward[],
  ): Observable<void> {
    return this.http
      .post<PurchaseRequisition>(
        `${this.base}/purchase-requisitions/${requisitionId}/line-awards`,
        { awards },
      )
      .pipe(map(() => undefined));
  }

  /** Genera una o más OC agrupadas por cotización (transacción atómica en backend). */
  createOrdersFromRequisition(
    requisitionId: string,
  ): Observable<CreateOrdersFromRequisitionResult> {
    return this.http.post<CreateOrdersFromRequisitionResult>(
      `${this.base}/purchase-orders/from-requisition/${requisitionId}`,
      {},
    );
  }

  // -- Purchase Orders --
  getOrders(params?: { status?: string }): Observable<PurchaseOrder[]> {
    return this.http
      .get<PurchaseOrder[]>(`${this.base}/purchase-orders`, { params: params as any })
      .pipe(map((rows) => rows.map((o) => this.normalizeOrderMedia(o))));
  }

  /** OC en SENT | ORDERED | PARTIALLY_RECEIVED | SENT_TO_SUPPLIER (alcance contractual del usuario). */
  getOrdersEligibleForReceipt(): Observable<PurchaseOrder[]> {
    return this.http.get<PurchaseOrder[]>(
      `${this.base}/purchase-orders/eligible-for-receipt`,
    );
  }

  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http
      .get<PurchaseOrder>(`${this.base}/purchase-orders/${id}`)
      .pipe(map((row) => this.normalizeOrderMedia(row)));
  }

  linkOrderItemToCatalog(
    orderId: string,
    orderItemId: string,
    inventoryItemId: string,
  ): Observable<PurchaseOrder> {
    return this.http.patch<PurchaseOrder>(
      `${this.base}/purchase-orders/${orderId}/items/${orderItemId}/link-catalog`,
      { inventoryItemId },
    );
  }

  getOrderPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/purchase-orders/${id}/pdf`, {
      responseType: 'blob',
    });
  }

  getOrderActivityLogs(id: string): Observable<ActivityLogEntry[]> {
    return this.http.get<ActivityLogEntry[]>(`${this.base}/purchase-orders/${id}/logs`);
  }

  patchOrderLogistics(
    id: string,
    body: { deliveryAddress?: string | null; paymentTerms?: string | null },
  ): Observable<PurchaseOrder> {
    return this.http.patch<PurchaseOrder>(
      `${this.base}/purchase-orders/${id}/logistics`,
      body,
    );
  }

  createOrder(quotationId: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders`, { quotationId });
  }

  approveOrder(id: string, comment?: string): Observable<any> {
    return this.http.post(`${this.base}/purchase-orders/${id}/approve`, { comment });
  }

  rejectOrder(id: string, reason?: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders/${id}/reject`, { reason });
  }

  resetOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders/${id}/reset`, {});
  }

  forceCloseOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders/${id}/force-close`, { reason });
  }

  cancelOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders/${id}/cancel`, { reason });
  }

  /** APPROVED → SENT (documento comunicado al proveedor). */
  markOrderSentToSupplier(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.base}/purchase-orders/${id}/sent-to-supplier`, {});
  }

  // -- Receipts --
  getReceipts(): Observable<WarehouseReceipt[]> {
    return this.http.get<WarehouseReceipt[]>(`${this.base}/warehouse-receipts`);
  }

  getReceipt(id: string): Observable<WarehouseReceipt> {
    return this.http.get<WarehouseReceipt>(`${this.base}/warehouse-receipts/${id}`);
  }

  createReceipt(data: { purchaseOrderId: string; warehouseId: string }): Observable<WarehouseReceipt> {
    return this.http.post<WarehouseReceipt>(`${this.base}/warehouse-receipts`, data);
  }

  updateReceiptItems(receiptId: string, items: Array<{ id: string; quantityReceived: number; observations?: string }>): Observable<any> {
    return this.http.patch(`${this.base}/warehouse-receipts/${receiptId}/items`, { items });
  }

  confirmReceipt(id: string): Observable<WarehouseReceipt> {
    return this.http.post<WarehouseReceipt>(`${this.base}/warehouse-receipts/${id}/confirm`, {});
  }

  // -- Purchase invoices (3-way match) --
  createPurchaseInvoice(formData: FormData): Observable<PurchaseInvoice & { match?: PurchaseInvoice['match'] }> {
    return this.http.post<PurchaseInvoice & { match?: PurchaseInvoice['match'] }>(
      `${this.base}/purchase-invoices`,
      formData,
    );
  }

  updatePurchaseInvoice(
    id: string,
    formData: FormData,
  ): Observable<PurchaseInvoice & { match?: PurchaseInvoice['match'] }> {
    return this.http.patch<PurchaseInvoice & { match?: PurchaseInvoice['match'] }>(
      `${this.base}/purchase-invoices/${id}`,
      formData,
    );
  }

  validatePurchaseInvoice(id: string): Observable<PurchaseInvoice & { match: NonNullable<PurchaseInvoice['match']> }> {
    return this.http.post<PurchaseInvoice & { match: NonNullable<PurchaseInvoice['match']> }>(
      `${this.base}/purchase-invoices/${id}/validate`,
      {},
    );
  }

  overrulePurchaseInvoiceThreeWayMatch(
    id: string,
    notes: string,
  ): Observable<PurchaseInvoice & { match: NonNullable<PurchaseInvoice['match']> }> {
    return this.http.post<PurchaseInvoice & { match: NonNullable<PurchaseInvoice['match']> }>(
      `${this.base}/purchase-invoices/${id}/three-way-match/overrule`,
      { notes },
    );
  }

  markPurchaseInvoicePaid(id: string): Observable<PurchaseInvoice> {
    return this.http.post<PurchaseInvoice>(`${this.base}/purchase-invoices/${id}/mark-paid`, {});
  }

  /** Registra pago con referencia y fecha efectiva (paidAt). */
  recordPurchaseInvoicePayment(
    id: string,
    paymentReference: string,
  ): Observable<PurchaseInvoice> {
    return this.http.post<PurchaseInvoice>(`${this.base}/purchase-invoices/${id}/pay`, {
      paymentReference,
    });
  }

  /** Calendario de pagos: totales por día de vencimiento (PENDING / MATCHED / DISCREPANCY no pagadas). */
  getPaymentCalendar(params: {
    from: string;
    to: string;
    contractId: string;
  }): Observable<PurchasePaymentCalendarDay[]> {
    return this.http.get<PurchasePaymentCalendarDay[]>(
      `${this.base}/purchase-invoices/payment-calendar`,
      {
        params: {
          from: params.from,
          to: params.to,
          contractId: params.contractId,
        },
      },
    );
  }

  /** Detalle enriquecido (hasDiscrepancy, discrepancyReason, etc.). */
  getPurchaseInvoice(id: string): Observable<PurchaseInvoice> {
    return this.http
      .get<PurchaseInvoice>(`${this.base}/purchase-invoices/${id}`)
      .pipe(
        map((invoice) => {
          this.normalizeInvoiceMedia(invoice);
          return invoice;
        }),
      );
  }

  deletePurchaseInvoice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/purchase-invoices/${id}`);
  }

  /** Listado global: filtros opcionales `status`, `contractId`, `dueDateFrom`, `dueDateTo` (YYYY-MM-DD). */
  listPurchaseInvoices(params: {
    status?: string;
    contractId?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
  }): Observable<PurchaseInvoice[]> {
    const q: Record<string, string> = {};
    if (params.contractId?.trim()) q['contractId'] = params.contractId.trim();
    if (params.status?.trim()) q['status'] = params.status.trim();
    if (params.dueDateFrom?.trim()) q['dueDateFrom'] = params.dueDateFrom.trim();
    if (params.dueDateTo?.trim()) q['dueDateTo'] = params.dueDateTo.trim();
    return this.http
      .get<PurchaseInvoice[]>(`${this.base}/purchase-invoices`, { params: q })
      .pipe(
        map((rows) =>
          rows.map((invoice) => {
            this.normalizeInvoiceMedia(invoice);
            return invoice;
          }),
        ),
      );
  }

  // -- Analytics --
  getPurchasesAnalyticsDashboard(params?: {
    contractId?: string;
    from?: string;
    to?: string;
    /** false = incluir SRC cerrados en el embudo (historial). */
    excludeClosedRequisitions?: boolean;
  }): Observable<PurchasesAnalyticsDashboard> {
    const httpParams: Record<string, string> = {};
    if (params?.contractId) httpParams['contractId'] = params.contractId;
    if (params?.from) httpParams['from'] = params.from;
    if (params?.to) httpParams['to'] = params.to;
    if (params?.excludeClosedRequisitions === false) {
      httpParams['excludeClosedRequisitions'] = 'false';
    }
    return this.http.get<PurchasesAnalyticsDashboard>(
      `${this.base}/purchases/analytics/dashboard`,
      { params: httpParams },
    );
  }

  /**
   * Reporte ejecutivo PDF (analítica). Respuesta binaria + nombre sugerido por el servidor.
   */
  downloadExecutiveReport(filters: {
    contractId?: string;
    from: string;
    to: string;
  }): Observable<{ blob: Blob; filename: string }> {
    const httpParams: Record<string, string> = {
      from: filters.from,
      to: filters.to,
    };
    if (filters.contractId?.trim()) {
      httpParams['contractId'] = filters.contractId.trim();
    }
    return this.http
      .get(`${this.base}/purchases/analytics/report/pdf`, {
        params: httpParams,
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((resp: HttpResponse<Blob>) => {
          let filename = 'Reporte_Compras.pdf';
          const cd = resp.headers.get('Content-Disposition');
          if (cd) {
            const quoted = /filename="([^"]+)"/.exec(cd);
            if (quoted?.[1]) {
              filename = quoted[1];
            } else {
              const star = /filename\*=UTF-8''([^;\n]+)/i.exec(cd);
              if (star?.[1]) {
                try {
                  filename = decodeURIComponent(star[1]);
                } catch {
                  filename = star[1];
                }
              }
            }
          }
          const body = resp.body;
          if (!body) {
            throw new Error('Respuesta PDF vacía');
          }
          return { blob: body, filename };
        }),
      );
  }
}

export interface PurchasePaymentCalendarDay {
  date: string;
  matchedTotal: number;
  discrepancyTotal: number;
  /** Facturas registradas aún sin validación 3-way (vencimiento planificado). */
  pendingTotal: number;
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
}

export interface PurchasesAnalyticsDashboard {
  filters: {
    from: string;
    to: string;
    contractId: string | null;
    excludeClosedRequisitions?: boolean;
  };
  kpis: {
    totalApprovedSpend: number;
    pendingSignaturePurchaseOrders: number;
    invoiceDiscrepancyRate: number;
    invoiceDiscrepancyCount: number;
    invoiceTotalForRate: number;
    multiproviderAdjudicationSavings: number;
  };
  imputationSpend: { general: number; equipment: number; workOrder: number };
  monthlySpend: Array<{ month: string; total: number }>;
  topVendors: Array<{
    vendorId: string;
    vendorName: string;
    vendorCode: string;
    purchaseVolume: number;
    avgLeadTimeDays: number | null;
  }>;
  criticalOrders: Array<{
    id: string;
    correlative: string;
    totalAmount: number;
    status: string;
    requiredSignatures: number;
    approvalsCount: number;
    hoursWaiting: number;
    contract: { code: string; name: string };
  }>;
  /** Suma de montos corregidos vía 3-way match (prevención de sobrepagos). */
  overpaymentPrevention: number;
  /** Conteo de SRC por estado (instantáneo, alcance contrato). */
  requisitionPipeline: Record<string, number>;
  /** Líneas de SRC en «compra parcial» con OC activa vs total de líneas. */
  partialRequisitionPurchaseProgress: {
    partialRequisitionCount: number;
    lineItemsTotal: number;
    lineItemsWithActivePo: number;
  };
  /** SRC recientes en el período con desglose OC/proveedor. */
  requisitionPurchaseRows: Array<{
    correlative: string;
    status: string;
    ocLines: string[];
  }>;
}
