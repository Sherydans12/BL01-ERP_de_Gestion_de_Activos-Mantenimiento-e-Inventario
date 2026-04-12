import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable, throwError } from 'rxjs';

export interface PurchaseSettings {
  id: string;
  tenantId: string;
  approvalThreshold: number;
  currency: string;
  approvalPolicies: ApprovalPolicy[];
}

export interface ApprovalPolicy {
  id: string;
  level: number;
  description?: string;
  roleId: string;
  minAmount: number;
  role?: { id: string; name: string; baseRole: string };
}

export interface PurchaseRequisition {
  id: string;
  correlative: string;
  contractId: string;
  subcontractId?: string;
  requestedById: string;
  status: string;
  description: string;
  justification?: string;
  items: RequisitionItem[];
  quotations?: PurchaseQuotation[];
  requestedBy?: { id: string; name: string; email: string };
  contract?: { id: string; code: string; name: string };
  subcontract?: { id: string; code: string; name: string };
  createdAt: string;
  _count?: { items: number; quotations: number };
}

export interface RequisitionItem {
  id: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  estimatedCost?: number;
  inventoryItemId?: string;
  inventoryItem?: { id: string; partNumber: string; name: string };
}

export interface PurchaseQuotation {
  id: string;
  vendorId: string;
  totalAmount: number;
  currency: string;
  deliveryDays?: number;
  validUntil?: string;
  attachmentUrl?: string;
  status: string;
  isWinner: boolean;
  vendor?: { id: string; code: string; name: string };
  items: QuotationItem[];
  createdAt: string;
}

export interface QuotationItem {
  id: string;
  requisitionItemId: string;
  unitPrice: number;
  brand?: string;
  notes?: string;
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
  items: PurchaseOrderItem[];
  approvals: PurchaseOrderApproval[];
  receipts?: WarehouseReceipt[];
  quotation?: PurchaseQuotation & {
    requisition?: { id: string; correlative: string; description: string };
  };
  contract?: { id: string; code: string; name: string };
  subcontract?: { id: string; code: string; name: string };
  createdAt: string;
  _count?: { approvals: number; items: number };
}

export interface PurchaseOrderItem {
  id: string;
  description: string;
  quantity: number;
  unitCost: number;
  inventoryItemId?: string;
  inventoryItem?: { id: string; partNumber: string; name: string };
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
  purchaseOrder?: { id: string; correlative: string; totalAmount: number; status: string };
  warehouse?: { id: string; code: string; name: string };
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
  orderItem?: PurchaseOrderItem & {
    inventoryItem?: { id: string; partNumber: string; name: string; unitOfMeasure: string };
  };
}

export type ActivityLogAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'SIGNATURE';

export interface ActivityLogDetails {
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
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

  // -- Settings --
  getSettings(): Observable<PurchaseSettings> {
    return this.http.get<PurchaseSettings>(`${this.base}/purchase-settings`);
  }

  updateSettings(data: { approvalThreshold?: number; currency?: string }): Observable<PurchaseSettings> {
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
    return this.http.get<PurchaseRequisition[]>(`${this.base}/purchase-requisitions`, { params: params as any });
  }

  getRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.get<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}`);
  }

  createRequisition(data: any): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.base}/purchase-requisitions`, data);
  }

  updateRequisition(id: string, data: any): Observable<PurchaseRequisition> {
    return this.http.patch<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}`, data);
  }

  submitRequisition(id: string): Observable<PurchaseRequisition> {
    return this.http.post<PurchaseRequisition>(`${this.base}/purchase-requisitions/${id}/submit`, {});
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
    return this.http.post<PurchaseQuotation>(
      `${this.base}/purchase-requisitions/${requisitionId}/quotations`, formData,
    );
  }

  selectQuotation(requisitionId: string, quotationId: string): Observable<PurchaseQuotation> {
    return this.http.post<PurchaseQuotation>(
      `${this.base}/purchase-requisitions/${requisitionId}/quotations/${quotationId}/select`, {},
    );
  }

  // -- Purchase Orders --
  getOrders(params?: { status?: string }): Observable<PurchaseOrder[]> {
    return this.http.get<PurchaseOrder[]>(`${this.base}/purchase-orders`, { params: params as any });
  }

  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`${this.base}/purchase-orders/${id}`);
  }

  getOrderPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/purchase-orders/${id}/pdf`, {
      responseType: 'blob',
    });
  }

  getOrderActivityLogs(id: string): Observable<ActivityLogEntry[]> {
    return this.http.get<ActivityLogEntry[]>(`${this.base}/purchase-orders/${id}/logs`);
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
}
