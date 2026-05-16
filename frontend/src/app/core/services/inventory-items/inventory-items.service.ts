import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

export interface ItemCategory {
  id: string;
  name: string;
  description?: string | null;
  parentCategoryId?: string | null;
  isGlobal?: boolean;
  parentCategory?: { id: string; name: string };
  _count?: { items: number; childCategories?: number };
}

export interface UnitOfMeasureRef {
  id: string;
  name: string;
  abbreviation: string;
  allowsDecimals?: boolean;
}

export interface QuickCreateItemResult {
  id: string;
  qrCode?: string;
  inventoryCode?: string | null;
  partNumber: string | null;
  name: string;
  unitOfMeasure: UnitOfMeasureRef;
  categoryId: string | null;
  itemCategory: {
    id: string;
    name: string;
    parentCategoryId?: string | null;
    parentCategory?: { id: string; name: string };
  } | null;
}

/** GET /inventory-items/next-inventory-code (vista previa; no reserva correlativo). */
export interface NextInventorySkuPreview {
  inventoryCode: string;
}

/** Bodega inicial + umbrales (POST maestro exige min/max si hay bodega; quick-create puede omitirlos → 0). */
export interface InitialItemStockPayload {
  warehouseId?: string;
  minStock?: number;
  maxStock?: number;
}

/** Cuerpo POST /inventory-items (catálogo maestro). */
export type CreateInventoryItemPayload = {
  partNumber?: string | null;
  name: string;
  description?: string;
  compatibilityInfo?: string | null;
  categoryId: string;
  unitOfMeasureId: string;
  brand?: string;
  isSerialized?: boolean;
  isInventory?: boolean;
  isAsset?: boolean;
  isConsumable?: boolean;
} & InitialItemStockPayload;

/** Cuerpo POST /inventory-items/quick-create. */
export type QuickCreateItemPayload = {
  name: string;
  categoryId: string;
  unitOfMeasureId: string;
  /** No usar: el backend asigna el SKU; si se envía no vacío, responde 400. */
  inventoryCode?: string;
  partNumber?: string;
  description?: string;
  brand?: string;
  compatibilityInfo?: string;
  isSerialized?: boolean;
  isInventory?: boolean;
  isAsset?: boolean;
  isConsumable?: boolean;
} & InitialItemStockPayload;

/** Fila devuelta por `GET /inventory-items/picker` (selector global). */
export interface ItemPickerRow {
  id: string;
  /** Payload QR (mismo esquema que backend: INV:<uuid>). */
  qrCode?: string;
  /** SKU interno ERP (típicamente IN####; legado u otros valores posibles en datos importados). */
  inventoryCode?: string | null;
  partNumber: string | null;
  name: string;
  description?: string | null;
  /** Equipos / marcas / modelos compatibles (texto libre). */
  compatibilityInfo?: string | null;
  unitOfMeasure: UnitOfMeasureRef;
  brand?: string | null;
  categoryId: string;
  itemCategory: ItemCategory;
  /** Saldo en la bodega indicada; `null` si no se pidió bodega. */
  stockQuantity: number | null;
  /** CPP en la bodega del contexto; solo cuando el picker envía `warehouseId`. */
  stockUnitCost?: number | null;
  /** Ubicación física registrada en esa bodega (pasillo/estante), si existe. */
  stockLocation?: string | null;
  /** true si disponible (físico − reservado) está por debajo del mínimo en esa bodega. */
  stockCritical?: boolean;
}

export interface ItemPickerPage {
  data: ItemPickerRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Respuesta paginada GET /inventory-items */
export interface InventoryCatalogPage {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemLedgerReference {
  /** Incluye `ADJUST_SALDO_PENDIENTE` (ajuste desde stock vinculado a recepción/OC). */
  kind: string;
  label: string;
  workOrderId?: string;
  warehouseReceiptId?: string;
  purchaseOrderId?: string;
  /** Correlativo de la OC (kardex / vista rápida). */
  purchaseOrderCorrelative?: string;
  transferId?: string;
}

export interface InventoryItemAttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  url: string;
}

export interface ItemLedgerRow {
  id: string;
  date: string;
  type: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  notes: string | null;
  isPendingRegularization: boolean;
  referenceType: string | null;
  warehouse: { id: string; code: string; name: string };
  user: { id: string; name: string };
  reference: ItemLedgerReference | null;
}

export interface ItemLedgerPage {
  data: ItemLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({
  providedIn: 'root',
})
export class InventoryItemsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-items`;
  private categoriesUrl = `${environment.apiUrl}/item-categories`;

  /** Catálogo maestro paginado (no cargar miles de filas en memoria). */
  getCatalogPage(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    categoryId?: string;
  }): Observable<InventoryCatalogPage> {
    let p = new HttpParams();
    if (params.page != null) {
      p = p.set('page', String(params.page));
    }
    if (params.pageSize != null) {
      p = p.set('pageSize', String(params.pageSize));
    }
    if (params.search?.trim()) {
      p = p.set('search', params.search.trim());
    }
    if (params.categoryId?.trim()) {
      p = p.set('categoryId', params.categoryId.trim());
    }
    return this.http.get<InventoryCatalogPage>(this.apiUrl, { params: p });
  }

  /** Listado paginado para el selector global de artículos. */
  getPickerPage(params: {
    search?: string;
    categoryId?: string;
    warehouseId?: string;
    /** Solo ítems con cantidad &gt; 0 en la bodega indicada (requiere warehouseId). */
    onlyWithStockInWarehouse?: boolean;
    /** Solo ítems con salida a esta OT desde la bodega y cantidad aún devolvible (requiere warehouseId). */
    workOrderReturnFilterId?: string;
    /** Solo ítems con saldo pendiente de reingreso (terreno) en la bodega (requiere warehouseId). */
    fieldReentryOutstanding?: boolean;
    page?: number;
    pageSize?: number;
  }): Observable<ItemPickerPage> {
    let p = new HttpParams();
    if (params.search?.trim()) {
      p = p.set('search', params.search.trim());
    }
    if (params.categoryId?.trim()) {
      p = p.set('categoryId', params.categoryId.trim());
    }
    if (params.warehouseId?.trim()) {
      p = p.set('warehouseId', params.warehouseId.trim());
    }
    if (params.onlyWithStockInWarehouse === true) {
      p = p.set('onlyWithStock', '1');
    }
    if (params.workOrderReturnFilterId?.trim()) {
      p = p.set('workOrderId', params.workOrderReturnFilterId.trim());
    }
    if (params.fieldReentryOutstanding === true) {
      p = p.set('fieldReentryOutstanding', '1');
    }
    if (params.page != null) {
      p = p.set('page', String(params.page));
    }
    if (params.pageSize != null) {
      p = p.set('pageSize', String(params.pageSize));
    }
    return this.http.get<ItemPickerPage>(`${this.apiUrl}/picker`, { params: p });
  }

  searchItems(q: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/search`, {
      params: { q },
    });
  }

  getItem(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  /** PDF de etiqueta térmica (GET /inventory-items/:id/label). */
  getItemLabelPdf(
    id: string,
    params?: { qr?: 'url' | 'json'; size?: '50x25' | '100x50' },
  ): Observable<Blob> {
    let p = new HttpParams();
    if (params?.qr) {
      p = p.set('qr', params.qr);
    }
    if (params?.size) {
      p = p.set('size', params.size);
    }
    return this.http.get(`${this.apiUrl}/${id}/label`, {
      params: p,
      responseType: 'blob',
    });
  }

  /** Kardex paginado del artículo. */
  getItemLedger(
    id: string,
    params?: { page?: number; pageSize?: number; warehouseId?: string },
  ): Observable<ItemLedgerPage> {
    let p = new HttpParams();
    if (params?.page != null) {
      p = p.set('page', String(params.page));
    }
    if (params?.pageSize != null) {
      p = p.set('pageSize', String(params.pageSize));
    }
    if (params?.warehouseId?.trim()) {
      p = p.set('warehouseId', params.warehouseId.trim());
    }
    return this.http.get<ItemLedgerPage>(`${this.apiUrl}/${id}/ledger`, {
      params: p,
    });
  }

  createItem(data: CreateInventoryItemPayload): Observable<any> {
    return this.http.post<any>(this.apiUrl, data);
  }

  /** Próximo código `IN####` que asignaría el sistema (misma lógica que al guardar, salvo carreras). */
  getNextInventorySkuPreview(): Observable<NextInventorySkuPreview> {
    return this.http.get<NextInventorySkuPreview>(
      `${this.apiUrl}/next-inventory-code`,
    );
  }

  quickCreateItem(data: QuickCreateItemPayload): Observable<QuickCreateItemResult> {
    return this.http.post<QuickCreateItemResult>(
      `${this.apiUrl}/quick-create`,
      data,
    );
  }

  updateItem(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, data);
  }

  deleteItem(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }

  getAttachments(itemId: string): Observable<InventoryItemAttachmentRow[]> {
    return this.http.get<InventoryItemAttachmentRow[]>(
      `${this.apiUrl}/${itemId}/attachments`,
    );
  }

  uploadAttachment(
    itemId: string,
    file: File,
  ): Observable<InventoryItemAttachmentRow> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<InventoryItemAttachmentRow>(
      `${this.apiUrl}/${itemId}/attachments`,
      fd,
    );
  }

  deleteAttachment(itemId: string, attachmentId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/${itemId}/attachments/${attachmentId}`,
    );
  }

  /** Todas las categorías (admin / árbol completo; volúmenes grandes: usar paginación). */
  getCategories(): Observable<ItemCategory[]> {
    return this.http.get<ItemCategory[]>(this.categoriesUrl);
  }

  /** Categorías paginadas (opcional). */
  getCategoriesPage(params: {
    page?: number;
    pageSize?: number;
  }): Observable<{ data: ItemCategory[]; total: number; page: number; pageSize: number }> {
    let p = new HttpParams();
    if (params.page != null) {
      p = p.set('page', String(params.page));
    }
    if (params.pageSize != null) {
      p = p.set('pageSize', String(params.pageSize));
    }
    return this.http.get(this.categoriesUrl, { params: p }) as Observable<{
      data: ItemCategory[];
      total: number;
      page: number;
      pageSize: number;
    }>;
  }

  /** Solo familias (nivel 1). */
  getCategoryFamilies(): Observable<ItemCategory[]> {
    return this.http.get<ItemCategory[]>(`${this.categoriesUrl}/families`);
  }

  /** Subcategorías bajo una familia. */
  getCategoryChildren(parentId: string): Observable<ItemCategory[]> {
    return this.http.get<ItemCategory[]>(
      `${this.categoriesUrl}/children/${parentId}`,
    );
  }

  createCategory(data: {
    name: string;
    parentCategoryId?: string | null;
    description?: string | null;
  }): Observable<ItemCategory> {
    return this.http.post<ItemCategory>(this.categoriesUrl, data);
  }

  updateCategory(
    id: string,
    data: { name: string; description?: string | null },
  ): Observable<ItemCategory> {
    return this.http.put<ItemCategory>(`${this.categoriesUrl}/${id}`, data);
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.categoriesUrl}/${id}`);
  }
}
