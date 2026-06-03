import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { WorkOrderDetailModalComponent } from '../../work-orders/work-order-detail-modal/work-order-detail-modal.component';
import {
  AssetCostRecord,
  Equipment,
  EquipmentAnalytics,
  EquipmentMeterLog,
  MeterType,
  WorkOrder,
} from '../../../core/models/types';
import {
  FaultReportsService,
  FaultReportRow,
  CRITICALITY_META,
  SYSTEM_LABELS,
  STATUS_META as FAULT_STATUS_META,
} from '../../../core/services/fault-reports/fault-reports.service';
import {
  EquipmentAvailabilityService,
  AvailabilityRecord,
  SHIFT_LABELS,
  STATUS_LABELS as AVAILABILITY_STATUS_LABELS,
  STATUS_COLORS as AVAILABILITY_STATUS_COLORS,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import {
  LubeReportsService,
  LubeReportRow,
} from '../../../core/services/lube-reports/lube-reports.service';
import {
  EquipmentMeterHistoryTableComponent,
  EquipmentMeterHistoryRow,
} from '../components/equipment-meter-history-table/equipment-meter-history-table.component';

type TabId =
  | 'ficha'
  | 'salud'
  | 'consumos'
  | 'ots'
  | 'docs'
  | 'historial'
  | 'medidores';

type TimelineEventType = 'OT' | 'METER_ADJ' | 'PURCHASE';

interface DocItem {
  label: string;
  field: keyof Equipment;
  icon: string;
  expDate: string | null;
  daysLeft: number;
  status: 'VIGENTE' | 'PRÓXIMO' | 'VENCIDO' | 'N/A';
  progress: number;
}

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  date: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  meta?: string;
}

@Component({
  selector: 'app-equipment-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    EquipmentMeterHistoryTableComponent,
    WorkOrderDetailModalComponent,
  ],
  templateUrl: './equipment-detail-modal.component.html',
  styles: [
    `
      :host dialog.equipment-detail-dialog {
        box-sizing: border-box;
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0;
      }
    `,
  ],
})
export class EquipmentDetailModalComponent {
  private injector = inject(Injector);
  private fleetService = inject(FleetService);
  // ── Servicios transversales de Operaciones (M1·M2·M3) ──
  private faultService = inject(FaultReportsService);
  private availabilityService = inject(EquipmentAvailabilityService);
  private lubeService = inject(LubeReportsService);
  private workOrdersService = inject(WorkOrdersService);

  // Mapas de etiquetas/tokens (espejo backend) expuestos a la plantilla.
  protected readonly criticalityMeta = CRITICALITY_META;
  protected readonly systemLabels = SYSTEM_LABELS;
  protected readonly faultStatusMeta = FAULT_STATUS_META;
  protected readonly shiftLabels = SHIFT_LABELS;
  protected readonly availabilityStatusLabels = AVAILABILITY_STATUS_LABELS;
  protected readonly availabilityStatusColors = AVAILABILITY_STATUS_COLORS;

  detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  equipmentId = input<string | null>(null);
  isOpen = input<boolean>(false);
  close = output<void>();

  activeTab = signal<TabId>('ficha');
  loading = signal(false);
  analytics = signal<EquipmentAnalytics | null>(null);

  // ── Estado de las pestañas transversales (carga perezosa por equipo) ──
  lastFault = signal<FaultReportRow | null>(null);
  lastAvailability = signal<AvailabilityRecord | null>(null);
  lubeReports = signal<LubeReportRow[]>([]);
  healthLoading = signal(false);
  consumosLoading = signal(false);
  private healthLoadedFor: string | null = null;
  private consumosLoadedFor: string | null = null;

  // ── Pestaña «Órdenes de Trabajo»: OTs en todos los estados del equipo ──
  allOts = signal<WorkOrder[]>([]);
  otsLoading = signal(false);
  private otsLoadedFor: string | null = null;

  // Modal de detalle de OT embebido (no se pierde el contexto del equipo).
  showOtDetail = signal(false);
  selectedOtId = signal<string | null>(null);

  equipment = computed(() => this.analytics()?.equipment ?? null);
  workOrders = computed(() => this.analytics()?.workOrders ?? []);
  meterAdjustments = computed(() => this.analytics()?.meterAdjustments ?? []);
  assetCostRecords = computed(
    () => this.analytics()?.assetCostRecords ?? [],
  );
  meterLogs = computed(() => this.analytics()?.meterLogs ?? []);

  meterHistoryRows = computed<EquipmentMeterHistoryRow[]>(() => {
    const logs = this.meterLogs();
    if (!logs.length) return [];
    const asc = [...logs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    return asc.map((log, i) => {
      const nv = Number(log.newValue);
      const prevReading =
        i > 0 ? Number(asc[i - 1].newValue) : Number(log.oldValue);
      const delta = nv - prevReading;
      return {
        id: log.id,
        date: log.date,
        reading: nv,
        deltaFromPrevious: Number.isFinite(delta) ? delta : null,
        sourceLabel: this.formatMeterSourceLabel(log),
        userLabel: log.user?.name || log.user?.email || '—',
      };
    });
  });

  meterHistoryPreviewRows = computed(() => {
    const all = this.meterHistoryRows();
    if (all.length <= 8) return all;
    return all.slice(-8);
  });

  meterIcon = computed(() =>
    this.equipment()?.meterType === MeterType.KILOMETERS
      ? 'odometer'
      : 'clock',
  );

  meterUnit = computed(() =>
    this.equipment()?.meterType === MeterType.KILOMETERS ? 'Km' : 'Hrs',
  );

  nextServiceAt = computed(() => {
    const eq = this.equipment();
    if (!eq?.lastMaintenanceMeter || !eq?.maintenanceFrequency) return null;
    return eq.lastMaintenanceMeter + eq.maintenanceFrequency;
  });

  nextServiceRemaining = computed(() => {
    const eq = this.equipment();
    const next = this.nextServiceAt();
    if (!next || !eq) return null;
    return next - eq.currentMeter;
  });

  historicalAccumulated = computed(() => {
    const adjustments = this.meterAdjustments();
    if (!adjustments.length) return 0;
    return adjustments.reduce(
      (sum, adj) => sum + Math.abs(adj.newValue - adj.oldValue),
      0,
    );
  });

  legalStatus = computed<{
    label: string;
    color: string;
    bgColor: string;
    nearestDoc: string;
    daysLeft: number;
  }>(() => {
    const eq = this.equipment();
    if (!eq) {
      return {
        label: 'N/A',
        color: 'text-muted',
        bgColor: 'bg-dark',
        nearestDoc: '',
        daysLeft: 0,
      };
    }

    const docs: { name: string; date: string | undefined }[] = [
      { name: 'SOAP', date: eq.soapExp },
      { name: 'Rev. Técnica', date: eq.techReviewExp },
      { name: 'Perm. Circulación', date: eq.circPermitExp },
      { name: 'Cert. Mecánica', date: eq.mechanicalCertExp },
      { name: 'Póliza RC', date: eq.liabilityPolicyExp },
    ];

    let nearest: { name: string; days: number } | null = null;
    const now = new Date();

    for (const doc of docs) {
      if (!doc.date) continue;
      const diff = Math.ceil(
        (new Date(doc.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (!nearest || diff < nearest.days) {
        nearest = { name: doc.name, days: diff };
      }
    }

    if (!nearest) {
      return {
        label: 'Sin datos',
        color: 'text-muted',
        bgColor: 'bg-dark',
        nearestDoc: '',
        daysLeft: 0,
      };
    }

    if (nearest.days < 0) {
      return {
        label: 'VENCIDO',
        color: 'text-error',
        bgColor: 'bg-error/10',
        nearestDoc: nearest.name,
        daysLeft: nearest.days,
      };
    }
    if (nearest.days <= 30) {
      return {
        label: 'PRÓXIMO',
        color: 'text-warning',
        bgColor: 'bg-warning/10',
        nearestDoc: nearest.name,
        daysLeft: nearest.days,
      };
    }
    return {
      label: 'AL DÍA',
      color: 'text-success',
      bgColor: 'bg-success/10',
      nearestDoc: nearest.name,
      daysLeft: nearest.days,
    };
  });

  operationalStatus = computed(() => {
    const eq = this.equipment();
    if (!eq)
      return { label: 'Sin datos', color: 'text-muted', bgColor: 'bg-dark' };
    return eq.isOperational === false
      ? { label: 'FUERA DE SERVICIO', color: 'text-error', bgColor: 'bg-error/10' }
      : { label: 'OPERATIVO', color: 'text-success', bgColor: 'bg-success/10' };
  });

  documentItems = computed<DocItem[]>(() => {
    const eq = this.equipment();
    if (!eq) return [];

    const fields: { label: string; field: keyof Equipment; icon: string }[] = [
      { label: 'Seguro Obligatorio (SOAP)', field: 'soapExp', icon: 'shield' },
      { label: 'Revisión Técnica', field: 'techReviewExp', icon: 'clipboard-check' },
      { label: 'Permiso de Circulación', field: 'circPermitExp', icon: 'file-text' },
      { label: 'Certificado Mecánico', field: 'mechanicalCertExp', icon: 'wrench' },
      { label: 'Póliza Responsabilidad Civil', field: 'liabilityPolicyExp', icon: 'briefcase' },
    ];

    return fields.map((f) => {
      const dateStr = eq[f.field] as string | undefined;
      if (!dateStr) {
        return {
          ...f,
          expDate: null,
          daysLeft: 0,
          status: 'N/A' as const,
          progress: 0,
        };
      }

      const now = new Date();
      const exp = new Date(dateStr);
      const daysLeft = Math.ceil(
        (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const totalDays = 365;
      const progress = Math.max(0, Math.min(100, (daysLeft / totalDays) * 100));

      let status: 'VIGENTE' | 'PRÓXIMO' | 'VENCIDO';
      if (daysLeft < 0) status = 'VENCIDO';
      else if (daysLeft <= 30) status = 'PRÓXIMO';
      else status = 'VIGENTE';

      return { ...f, expDate: dateStr, daysLeft, status, progress };
    });
  });

  timeline = computed<TimelineEvent[]>(() => {
    const wos = this.workOrders();
    const adjs = this.meterAdjustments();
    const costs = this.assetCostRecords();
    const events: TimelineEvent[] = [];

    for (const wo of wos) {
      events.push({
        id: wo.id,
        type: 'OT',
        date: wo.closedAt ?? wo.createdAt,
        title: `OT ${wo.correlative}`,
        subtitle: `${wo.maintenanceType} — ${wo.category.replace(/_/g, ' ')}`,
        icon: 'tool',
        color: wo.maintenanceType === 'PREVENTIVO' ? 'text-primary' : 'text-warning',
        meta: `${wo.initialMeter} → ${wo.finalMeter != null ? wo.finalMeter : '—'} ${this.meterUnit()}`,
      });
    }

    for (const adj of adjs) {
      events.push({
        id: adj.id,
        type: 'METER_ADJ',
        date: adj.date,
        title: 'Ajuste de Medidor',
        subtitle: adj.reason || 'Sin razón especificada',
        icon: this.meterIcon() === 'clock' ? 'clock' : 'gauge',
        color: 'text-secondary',
        meta: `${adj.oldValue} → ${adj.newValue} ${this.meterUnit()}`,
      });
    }

    for (const rec of costs) {
      const oc = rec.purchaseOrder?.correlative;
      const wr = rec.warehouseReceipt?.correlative;
      events.push({
        id: rec.id,
        type: 'PURCHASE',
        date: rec.recordedAt,
        title: oc ? `Compra externa (OC ${oc})` : 'Compra externa imputada',
        subtitle: wr
          ? `Recepción de bodega ${wr} — costo proporcional a lo recibido`
          : 'Recepción de bodega — costo proporcional a lo recibido',
        icon: 'purchase',
        color: 'text-emerald-400',
        meta: this.formatPurchaseCostMeta(rec),
      });
    }

    events.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return events;
  });

  tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'ficha', label: 'Información Base', icon: 'cpu' },
    { id: 'salud', label: 'Salud y Operación', icon: 'heart-pulse' },
    { id: 'ots', label: 'Órdenes de Trabajo', icon: 'wrench' },
    { id: 'consumos', label: 'Consumos', icon: 'droplet' },
    { id: 'medidores', label: 'Historial de Medidores', icon: 'gauge' },
    { id: 'docs', label: 'Documentación', icon: 'file-text' },
    { id: 'historial', label: 'Historial', icon: 'activity' },
  ];

  /** Etiqueta + token de color para el estado de una OT (espejo backend OtStatus). */
  otStatusMeta(status: string): { label: string; cls: string } {
    switch (status) {
      case 'OPEN':
        return {
          label: 'Abierta',
          cls: 'text-primary bg-primary/10 border-primary/20',
        };
      case 'IN_PROGRESS':
        return {
          label: 'En progreso',
          cls: 'text-warning bg-warning/10 border-warning/20',
        };
      case 'ON_HOLD':
        return {
          label: 'En espera',
          cls: 'text-muted bg-dark border-border',
        };
      case 'CLOSED':
        return {
          label: 'Cerrada',
          cls: 'text-success bg-success/10 border-success/20',
        };
      default:
        return { label: status, cls: 'text-muted bg-dark border-border' };
    }
  }

  private formatMeterSourceLabel(log: EquipmentMeterLog): string {
    switch (log.source) {
      case 'OT':
        return log.workOrderCorrelative
          ? `OT ${log.workOrderCorrelative}`
          : 'OT';
      case 'TELEMETRY':
        return 'Telemetría';
      case 'MANUAL':
        return 'Manual / ajuste';
      case 'AVAILABILITY_REPORT':
        return 'Reporte de disponibilidad';
      case 'FAULT_REPORT':
        return 'Reporte de falla';
      default:
        return String(log.source);
    }
  }

  constructor() {
    effect(
      () => {
        const id = this.equipmentId();
        const open = this.isOpen();
        if (id && open) {
          this.loadAnalytics(id);
          // Reinicia el estado de las pestañas transversales para el nuevo equipo.
          this.activeTab.set('ficha');
          this.resetCrossModuleState();
        } else {
          this.analytics.set(null);
          this.activeTab.set('ficha');
          this.resetCrossModuleState();
        }
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      if (!this.isOpen()) return;
      afterNextRender(
        () => {
          const el = this.detailDialog()?.nativeElement;
          if (el && !el.open) {
            el.showModal();
          }
        },
        { injector: this.injector },
      );
    });
  }

  private loadAnalytics(id: string): void {
    this.loading.set(true);
    this.fleetService.getEquipmentAnalytics(id).subscribe({
      next: (data) => {
        this.analytics.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  selectTab(tab: TabId): void {
    this.activeTab.set(tab);
    const id = this.equipmentId();
    if (!id) return;
    // Carga perezosa al abrir las pestañas transversales (M1/M2/M3 + OTs).
    if (tab === 'salud') this.loadHealth(id);
    if (tab === 'consumos') this.loadConsumos(id);
    if (tab === 'ots') this.loadOts(id);
  }

  /** Pestaña «Órdenes de Trabajo»: OTs del equipo en todos los estados (no solo cerradas). */
  private loadOts(id: string): void {
    if (this.otsLoadedFor === id) return;
    this.otsLoadedFor = id;
    this.otsLoading.set(true);

    this.workOrdersService
      .getWorkOrdersFiltered({ equipmentId: id, limit: 20 })
      .pipe(catchError(() => of(null)))
      .subscribe({
        next: (res) => {
          this.allOts.set((res?.data ?? []) as WorkOrder[]);
          this.otsLoading.set(false);
        },
        error: () => this.otsLoading.set(false),
      });
  }

  /** Abre el detalle de la OT sin cerrar el modal del equipo (contexto preservado). */
  openOtDetail(otId: string): void {
    this.selectedOtId.set(otId);
    this.showOtDetail.set(true);
  }

  closeOtDetail(): void {
    this.showOtDetail.set(false);
    this.selectedOtId.set(null);
  }

  /** Pestaña 2 «Salud y Operación»: última falla (M3) + último parte de disponibilidad (M2). */
  private loadHealth(id: string): void {
    if (this.healthLoadedFor === id) return;
    this.healthLoadedFor = id;
    this.healthLoading.set(true);

    forkJoin({
      fault: this.faultService
        .getReports({ equipmentId: id, pageSize: 1 })
        .pipe(catchError(() => of(null))),
      availability: this.availabilityService
        .getAll({ equipmentId: id, pageSize: 1 })
        .pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ fault, availability }) => {
        this.lastFault.set(fault?.data?.[0] ?? null);
        this.lastAvailability.set(availability?.data?.[0] ?? null);
        this.healthLoading.set(false);
      },
      error: () => this.healthLoading.set(false),
    });
  }

  /** Pestaña 3 «Consumos»: últimos 5 despachos de lubricantes (M1) del equipo. */
  private loadConsumos(id: string): void {
    if (this.consumosLoadedFor === id) return;
    this.consumosLoadedFor = id;
    this.consumosLoading.set(true);

    this.lubeService
      .getReports({ equipmentId: id, pageSize: 5 })
      .pipe(catchError(() => of(null)))
      .subscribe({
        next: (res) => {
          this.lubeReports.set(res?.data ?? []);
          this.consumosLoading.set(false);
        },
        error: () => this.consumosLoading.set(false),
      });
  }

  private resetCrossModuleState(): void {
    this.healthLoadedFor = null;
    this.consumosLoadedFor = null;
    this.lastFault.set(null);
    this.lastAvailability.set(null);
    this.lubeReports.set([]);
    this.healthLoading.set(false);
    this.consumosLoading.set(false);
    // OTs
    this.otsLoadedFor = null;
    this.allOts.set([]);
    this.otsLoading.set(false);
    this.showOtDetail.set(false);
    this.selectedOtId.set(null);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  getDocStatusClass(status: string): string {
    switch (status) {
      case 'VENCIDO':
        return 'text-error bg-error/10 border-error/20';
      case 'PRÓXIMO':
        return 'text-warning bg-warning/10 border-warning/20';
      case 'VIGENTE':
        return 'text-success bg-success/10 border-success/20';
      default:
        return 'text-muted bg-dark border-border';
    }
  }

  getProgressBarColor(status: string): string {
    switch (status) {
      case 'VENCIDO':
        return 'bg-error';
      case 'PRÓXIMO':
        return 'bg-warning';
      case 'VIGENTE':
        return 'bg-success';
      default:
        return 'bg-muted';
    }
  }

  formatNumber(value: number): string {
    return value.toLocaleString('es-CL');
  }

  private formatPurchaseCostMeta(rec: AssetCostRecord): string {
    const n = Number(rec.amount);
    if (!Number.isFinite(n)) return '';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(n);
  }
}
