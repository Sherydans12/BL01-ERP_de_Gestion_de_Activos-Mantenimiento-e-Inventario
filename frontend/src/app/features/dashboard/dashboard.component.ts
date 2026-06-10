import { Component, effect, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkOrdersService } from '../../core/services/work-orders/work-orders.service';
import type { DashboardStats, DashboardUiModel } from '../../core/models/dashboard-stats';
import { EquipmentDetailModalComponent } from '../fleet/equipment-detail-modal/equipment-detail-modal.component';
import { WorkOrderDetailModalComponent } from '../work-orders/work-order-detail-modal/work-order-detail-modal.component';
import { NotificationService } from '../../core/services/notification/notification.service';
import { EquipmentAvailabilityService } from '../../core/services/equipment-availability/equipment-availability.service';
import { ShiftService } from '../../core/services/shift/shift.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    EquipmentDetailModalComponent,
    WorkOrderDetailModalComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private workOrdersService = inject(WorkOrdersService);
  private notificationService = inject(NotificationService);
  private availabilityService = inject(EquipmentAvailabilityService);
  protected shiftService = inject(ShiftService);

  stats = signal<DashboardUiModel | null>(null);
  lastUpdated = signal<Date>(new Date());

  showEquipmentDetail = signal(false);
  detailEquipmentId = signal<string | null>(null);

  showOtDetail = signal(false);
  detailOtId = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (!this.shiftService.operationalConfigLoaded()) return;
      this.shiftService.currentShift();
      this.shiftService.todayIso();
      this.loadUnreported();
    });
  }

  ngOnInit() {
    this.loadStats();
    this.loadUnreported();
  }

  loadStats() {
    this.workOrdersService.getStats().subscribe({
      next: (data) => {
        this.stats.set(this.normalizeStats(data));
        this.lastUpdated.set(new Date());
      },
      error: () => {
        this.notificationService.error('No se pudo cargar el dashboard.');
        this.stats.set(null);
      },
    });
  }

  /**
   * Equipos sin reporte de disponibilidad en el turno activo (auto-detectado).
   * No es crítico: si falla, el tile queda en 0 sin romper el dashboard.
   */
  loadUnreported() {
    const date = this.shiftService.todayIso();
    const shift = this.shiftService.coerceShift(this.shiftService.currentShift());
    this.availabilityService
      .getUnreported({ date, shift, page: 1, pageSize: 1 })
      .subscribe({
        next: (res) =>
          this.stats.update((s) =>
            s ? { ...s, unreportedCount: res.total } : s,
          ),
        error: () => {
          /* silencioso — métrica complementaria */
        },
      });
  }

  /** Compatibilidad si el API aún no expone bloques nuevos. */
  private normalizeStats(raw: DashboardStats): DashboardUiModel {
    const o = raw.otsByStatus;
    const active = (o?.OPEN ?? 0) + (o?.IN_PROGRESS ?? 0);
    const top = raw.topAlerts ?? [];
    const low = raw.lowStocks ?? [];
    return {
      ...raw,
      topAlerts: top,
      lastClosed: raw.lastClosed ?? [],
      kpiStrip: raw.kpiStrip ?? {
        activeOts: active,
        legalDocsAttention30d: top.filter((a) => a.daysRemaining <= 30).length,
        lowStockLines: low.length,
        requisitionsPipeline: 0,
        purchaseOrdersInbound: 0,
      },
      pmDueSoon: raw.pmDueSoon ?? [],
      openOtsHot: raw.openOtsHot ?? [],
      purchaseRequisitionsAttention: raw.purchaseRequisitionsAttention ?? [],
      purchaseOrdersInbound: raw.purchaseOrdersInbound ?? [],
      lowStocks: low,
      equiposDetenidos: raw.equiposDetenidos ?? 0,
      faultReportsOpen: raw.faultReportsOpen ?? 0,
      // Lo rellena loadUnreported(); se preserva si ya venía seteado por una recarga previa.
      unreportedCount: this.stats()?.unreportedCount ?? 0,
    };
  }

  openAlertEquipment(alert: { id: string }) {
    this.detailEquipmentId.set(alert.id);
    this.showEquipmentDetail.set(true);
  }

  closeEquipmentDetail() {
    this.showEquipmentDetail.set(false);
    this.detailEquipmentId.set(null);
  }

  openRecentOt(ot: { id: string }) {
    this.detailOtId.set(ot.id);
    this.showOtDetail.set(true);
  }

  closeOtDetail() {
    this.showOtDetail.set(false);
    this.detailOtId.set(null);
  }

  meterSuffix(meterType: string): string {
    return meterType === 'KILOMETERS' ? 'km' : 'hrs';
  }

  otStatusLabel(status: string): string {
    switch (status) {
      case 'OPEN':
        return 'Abierta';
      case 'IN_PROGRESS':
        return 'En progreso';
      case 'ON_HOLD':
        return 'En espera';
      case 'CLOSED':
        return 'Cerrada';
      default:
        return status;
    }
  }

  reqPriorityLabel(p: string): string {
    switch (p) {
      case 'HIGH':
        return 'Alta';
      case 'LOW':
        return 'Baja';
      default:
        return 'Media';
    }
  }

  poStatusShort(status: string): string {
    const map: Record<string, string> = {
      PENDING_APPROVAL: 'Aprobación',
      PARTIALLY_APPROVED: 'Aprob. parcial',
      APPROVED: 'Aprobada',
      ORDERED: 'Pedido',
      SENT: 'Enviada',
      SENT_TO_SUPPLIER: 'Enviada',
      PARTIALLY_RECEIVED: 'Recep. parcial',
      RECEIVED: 'Recepcionada',
      CLOSED: 'Cerrada',
    };
    return map[status] ?? status;
  }

  legalDocTone(days: number): string {
    if (days <= 0) return 'dash-tone--danger';
    if (days <= 7) return 'dash-tone--danger';
    if (days <= 30) return 'dash-tone--warn';
    return 'dash-tone--ok';
  }

  pmUrgencyTone(pct: number): string {
    if (pct >= 90) return 'dash-tone--danger';
    if (pct >= 75) return 'dash-tone--warn';
    return 'dash-tone--ok';
  }
}
