import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { SkeletonRowComponent } from '../../../shared/components/skeleton-row/skeleton-row.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

export interface SupplyAlertRow {
  id: string;
  quantity: number;
  minStock: number;
  maxStock: number;
  optimalTarget: number;
  /** Salidas (OUT / OT / traslado) últimos 90 días en esta bodega. */
  consumptionLast90Days: number;
  /** Consumo medio mensual = salidas 90d / 3. */
  avgMonthlyConsumption: number;
  /** Déficit al mínimo + ~30 días de cobertura al ritmo medio. */
  suggestedOrderQty: number;
  warehouse: { id: string; code: string; name: string };
  item: {
    id: string;
    partNumber: string;
    name: string;
    unitOfMeasure?: { abbreviation: string };
  };
  /** Requerimiento abierto reciente que incluye este artículo (si existe). */
  linkedRequisition?: { id: string; correlative: string } | null;
  /** Detalle OC / adjudicación para tooltip (multiproveedor). */
  linkedPurchaseSummary?: string | null;
}

@Component({
  selector: 'app-supply-alerts',
  standalone: true,
  imports: [CommonModule, RouterLink, SkeletonRowComponent, EntityLinkComponent],
  templateUrl: './supply-alerts.component.html',
})
export class SupplyAlertsComponent implements OnInit {
  private stockService = inject(InventoryStockService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  rows = signal<SupplyAlertRow[]>([]);
  loading = signal(true);
  readonly skeletonRows = Array.from({ length: 10 }, (_, i) => i);

  ngOnInit() {
    this.load();
  }

  forceRefresh() {
    this.rows.set([]);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.stockService.getSupplyAlerts().subscribe({
      next: (data) => {
        this.rows.set(data as SupplyAlertRow[]);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('No se pudieron cargar las alertas.');
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  generateRequisition() {
    const list = this.rows();
    if (list.length === 0) {
      this.notificationService.info('No hay ítems en alerta para sugerir.');
      return;
    }
    const prefill = list
      .filter((r) => r.suggestedOrderQty > 0)
      .map((r) => ({
        description: r.item.name,
        quantity: Math.ceil(r.suggestedOrderQty),
        unitOfMeasure: r.item.unitOfMeasure?.abbreviation || 'UN',
        estimatedCost: null,
        partNumber: r.item.partNumber,
        itemNotes:
          `Abastecimiento ${r.warehouse.code}: actual ${r.quantity}, mín ${r.minStock}. ` +
          `Consumo 90d: ${(r.consumptionLast90Days ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })}, ` +
          `prom./mes: ${(r.avgMonthlyConsumption ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })}. ` +
          `Sugerido (mín + ~30d): ${(r.suggestedOrderQty ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })}.`,
        inventoryItemId: r.item.id,
        inventoryItemName: r.item.name,
      }));

    if (prefill.length === 0) {
      this.notificationService.info(
        'No hay cantidades sugeridas mayores a cero.',
      );
      return;
    }

    try {
      sessionStorage.setItem(
        'requisitionSupplyPrefill',
        JSON.stringify(prefill),
      );
    } catch {
      this.notificationService.error('No se pudo preparar el requerimiento.');
      return;
    }

    this.router.navigate(['/app/compras/requerimientos/nuevo']);
  }

  consumptionTooltip(r: SupplyAlertRow): string {
    const s90 = r.consumptionLast90Days ?? 0;
    const pm = r.avgMonthlyConsumption ?? 0;
    return `Salidas registradas (90 días): ${s90.toLocaleString('es-CL', { maximumFractionDigits: 2 })} · Equiv. mensual: ${pm.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
  }
}
