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
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  Equipment,
  EquipmentAnalytics,
  MeterType,
} from '../../../core/models/types';

type TabId = 'ficha' | 'docs' | 'historial';

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
  type: 'OT' | 'METER_ADJ';
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
  imports: [CommonModule, DatePipe],
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

  detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  equipmentId = input<string | null>(null);
  isOpen = input<boolean>(false);
  close = output<void>();

  activeTab = signal<TabId>('ficha');
  loading = signal(false);
  analytics = signal<EquipmentAnalytics | null>(null);

  equipment = computed(() => this.analytics()?.equipment ?? null);
  workOrders = computed(() => this.analytics()?.workOrders ?? []);
  meterAdjustments = computed(() => this.analytics()?.meterAdjustments ?? []);

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
    if (!eq) return { label: 'Sin datos', color: 'text-muted', bgColor: 'bg-dark' };
    const legal = this.legalStatus();
    if (legal.label === 'VENCIDO') {
      return { label: 'NO OPERATIVO', color: 'text-error', bgColor: 'bg-error/10' };
    }
    return { label: 'OPERATIVO', color: 'text-success', bgColor: 'bg-success/10' };
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
        meta: `${wo.initialMeter} → ${wo.finalMeter} ${this.meterUnit()}`,
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

    events.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return events;
  });

  tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'ficha', label: 'Ficha Técnica', icon: 'cpu' },
    { id: 'docs', label: 'Documentación', icon: 'file-text' },
    { id: 'historial', label: 'Historial', icon: 'activity' },
  ];

  constructor() {
    effect(
      () => {
        const id = this.equipmentId();
        const open = this.isOpen();
        if (id && open) {
          this.loadAnalytics(id);
        } else {
          this.analytics.set(null);
          this.activeTab.set('ficha');
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
}
