import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

export interface InventoryTransferRow {
  id: string;
  status: string;
  createdAt: string;
  originWarehouse?: { id: string; code: string; name: string } | null;
  destinationWarehouse?: { id: string; code: string; name: string } | null;
  lines?: Array<{
    id: string;
    itemId: string;
    quantity: number;
    unitCost?: number | string;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class InventoryTransferService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-transfers`;

  listTransfers(): Observable<InventoryTransferRow[]> {
    return this.http.get<InventoryTransferRow[]>(this.apiUrl);
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
