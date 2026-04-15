import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { MeterType } from '../../../core/models/types';

@Component({
  selector: 'app-work-order-detail-modal',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  templateUrl: './work-order-detail-modal.component.html',
  styles: [
    `
      :host dialog.work-order-detail-dialog {
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
export class WorkOrderDetailModalComponent {
  private injector = inject(Injector);
  private workOrdersService = inject(WorkOrdersService);

  detailDialog = viewChild<ElementRef<HTMLDialogElement>>('detailDialog');

  workOrderId = input<string | null>(null);
  isOpen = input<boolean>(false);
  close = output<void>();

  loading = signal(false);
  ot = signal<any | null>(null);

  MeterType = MeterType;

  constructor() {
    effect(
      () => {
        const id = this.workOrderId();
        const open = this.isOpen();
        if (id && open) {
          this.loadOt(id);
        } else {
          this.ot.set(null);
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

  private loadOt(id: string): void {
    this.loading.set(true);
    this.workOrdersService.getWorkOrder(id).subscribe({
      next: (data) => {
        this.ot.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.ot.set(null);
        this.loading.set(false);
      },
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.emitClose();
    }
  }

  emitClose(): void {
    const el = this.detailDialog()?.nativeElement;
    if (el?.open) el.close();
    this.close.emit();
  }

  categoryLabel(c: string): string {
    const map: Record<string, string> = {
      PROGRAMADA: 'Programadas',
      NO_PROGRAMADA_CORRECTIVA: 'No programada correctiva',
      NO_PROGRAMADA_REACTIVA: 'No programada reactiva',
    };
    return map[c] || c?.replace(/_/g, ' ') || '—';
  }

  statusLabel(s: string): string {
    const map: Record<string, string> = {
      OPEN: 'Abierta',
      IN_PROGRESS: 'En progreso',
      ON_HOLD: 'En espera',
      CLOSED: 'Cerrada',
    };
    return map[s] || s || '—';
  }

  statusBadgeClass(s: string): string {
    switch (s) {
      case 'CLOSED':
        return 'border-success/30 bg-success/10 text-success';
      case 'IN_PROGRESS':
        return 'border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF]';
      case 'ON_HOLD':
        return 'border-warning/30 bg-warning/10 text-warning';
      default:
        return 'border-border bg-dark text-muted';
    }
  }

  meterUnit(eq: any): string {
    return eq?.meterType === MeterType.KILOMETERS ? 'Km' : 'Hrs';
  }
}
