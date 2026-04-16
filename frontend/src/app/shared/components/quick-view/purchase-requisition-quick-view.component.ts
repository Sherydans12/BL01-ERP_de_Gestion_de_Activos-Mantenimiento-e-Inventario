import {
  Component,
  ElementRef,
  inject,
  OnDestroy,
  effect,
  viewChild,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PurchasesService, PurchaseRequisition } from '../../../core/services/purchases/purchases.service';
import { QuickViewService } from './quick-view.service';

@Component({
  selector: 'app-purchase-requisition-quick-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './purchase-requisition-quick-view.component.html',
  styles: [
    `
      dialog.app-quick-view-dialog {
        max-width: min(96vw, 42rem);
        width: 100%;
        border: none;
        padding: 0;
        background: transparent;
      }
      dialog.app-quick-view-dialog::backdrop {
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(4px);
      }
    `,
  ],
})
export class PurchaseRequisitionQuickViewComponent implements OnDestroy {
  private purchases = inject(PurchasesService);
  private qv = inject(QuickViewService);
  private platformId = inject(PLATFORM_ID);

  dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  loading = false;
  error: string | null = null;
  data: PurchaseRequisition | null = null;

  readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const st = this.qv.state();
      const el = this.dialogRef()?.nativeElement;
      if (st?.kind !== 'REQ' || !st.id) {
        if (el?.open) el.close();
        this.data = null;
        return;
      }
      queueMicrotask(() => {
        el?.showModal();
        this.load(st.id);
      });
    });
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.dialogRef()?.nativeElement?.close();
  }

  private load(id: string): void {
    this.loading = true;
    this.error = null;
    this.data = null;
    this.purchases.getRequisition(id).subscribe({
      next: (r) => {
        this.data = r;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo cargar el requerimiento.';
        this.loading = false;
      },
    });
  }

  close(): void {
    this.qv.close();
  }

  /** Sincroniza estado al cerrar con ESC o programáticamente. */
  onDialogClose(): void {
    if (this.qv.state()?.kind === 'REQ') {
      this.qv.close();
    }
  }

  backdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.qv.close();
  }

  statusClass(status: string): string {
    const m: Record<string, string> = {
      DRAFT: 'bg-gray-500/15 text-gray-300',
      SUBMITTED: 'bg-sky-500/15 text-sky-300',
      QUOTING: 'bg-indigo-500/15 text-indigo-300',
      PENDING_APPROVAL: 'bg-amber-500/15 text-amber-300',
      PARTIALLY_PURCHASED: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35',
      APPROVED: 'bg-emerald-500/15 text-emerald-300',
      REJECTED: 'bg-red-500/15 text-red-300',
      CANCELLED: 'bg-zinc-500/15 text-zinc-400',
    };
    return m[status] ?? 'bg-border/30 text-muted';
  }

  statusLabel(status: string): string {
    const m: Record<string, string> = {
      DRAFT: 'Borrador',
      SUBMITTED: 'Enviado',
      QUOTING: 'En cotización',
      PENDING_APPROVAL: 'Pendiente aprobación',
      PARTIALLY_PURCHASED: 'Compra parcial',
      APPROVED: 'Aprobado',
      REJECTED: 'Rechazado',
      CANCELLED: 'Anulado',
    };
    return m[status] ?? status;
  }
}
