import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface InventoryTransferLinePayload {
  itemId: string;
  quantity: number;
}

export interface CreateInventoryTransferPayload {
  originWarehouseId: string;
  destinationWarehouseId: string;
  lines: InventoryTransferLinePayload[];
}

export interface TransferWarehouseRef {
  id: string;
  code: string;
  name: string;
  contractId?: string;
}

export interface TransferCreatedByRef {
  id: string;
  name: string;
  email: string;
}

export interface InventoryTransferRow {
  id: string;
  status: string;
  createdAt: string;
  lineCount?: number;
  originWarehouse?: TransferWarehouseRef | null;
  destinationWarehouse?: TransferWarehouseRef | null;
  createdBy?: TransferCreatedByRef | null;
  /** Presente en respuestas POST (crear / recibir). */
  lines?: Array<{
    id: string;
    itemId: string;
    quantity: number;
    unitCost?: number | string;
  }>;
}

export interface TransferLineDetail {
  id: string;
  itemId: string;
  quantity: number;
  unitCost?: number | string;
  item?: {
    id: string;
    partNumber: string | null;
    name: string;
    inventoryCode: string | null;
    unitOfMeasure?: { abbreviation: string; allowsDecimals: boolean } | null;
  };
}

export interface InventoryTransferDetail extends Omit<InventoryTransferRow, 'lines'> {
  lines: TransferLineDetail[];
  reception: {
    at: string;
    user: { id: string; name: string; email: string };
  } | null;
}

export interface TransferListParams {
  page?: number;
  pageSize?: number;
  sort?: 'createdAt' | 'origin' | 'dest' | 'status';
  dir?: 'asc' | 'desc';
}

export interface TransferListResponse {
  data: InventoryTransferRow[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({
  providedIn: 'root',
})
export class InventoryTransferService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-transfers`;

  listTransfers(params?: TransferListParams): Observable<TransferListResponse> {
    let httpParams = new HttpParams();
    if (params?.page != null) {
      httpParams = httpParams.set('page', String(params.page));
    }
    if (params?.pageSize != null) {
      httpParams = httpParams.set('pageSize', String(params.pageSize));
    }
    if (params?.sort) {
      httpParams = httpParams.set('sort', params.sort);
    }
    if (params?.dir) {
      httpParams = httpParams.set('dir', params.dir);
    }
    return this.http.get<TransferListResponse>(this.apiUrl, { params: httpParams });
  }

  getTransfer(id: string): Observable<InventoryTransferDetail> {
    return this.http.get<InventoryTransferDetail>(`${this.apiUrl}/${id}`);
  }

  createTransfer(
    payload: CreateInventoryTransferPayload,
  ): Observable<InventoryTransferRow> {
    return this.http.post<InventoryTransferRow>(this.apiUrl, payload);
  }

  confirmReception(transferId: string): Observable<InventoryTransferRow> {
    return this.http.post<InventoryTransferRow>(
      `${this.apiUrl}/${transferId}/receive`,
      {},
    );
  }
}
