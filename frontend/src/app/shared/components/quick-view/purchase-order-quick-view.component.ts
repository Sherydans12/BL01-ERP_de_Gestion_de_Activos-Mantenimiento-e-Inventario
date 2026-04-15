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
import {
  PurchasesService,
  PurchaseOrder,
} from '../../../core/services/purchases/purchases.service';
import { QuickViewService } from './quick-view.service';
import { FinancialClpPipe } from '../../pipes/financial-clp.pipe';

@Component({
  selector: 'app-purchase-order-quick-view',
  standalone: true,
  imports: [CommonModule, FinancialClpPipe],
  templateUrl: './purchase-order-quick-view.component.html',
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
export class PurchaseOrderQuickViewComponent implements OnDestroy {
  private purchases = inject(PurchasesService);
  private qv = inject(QuickViewService);
  private platformId = inject(PLATFORM_ID);

  dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  loading = false;
  error: string | null = null;
  data: PurchaseOrder | null = null;

  readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  readonly statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente',
    PARTIALLY_APPROVED: 'Parcial',
    APPROVED: 'Aprobada',
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada (hist.)',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recibida',
    CLOSED: 'Cerrada',
    CANCELLED: 'Cancelada',
  };

  readonly statusClass: Record<string, string> = {
    DRAFT: 'bg-gray-500/15 text-gray-300',
    PENDING_APPROVAL: 'bg-amber-500/15 text-amber-300',
    PARTIALLY_APPROVED: 'bg-yellow-500/15 text-yellow-300',
    APPROVED: 'bg-emerald-500/15 text-emerald-300',
    SENT: 'bg-sky-500/15 text-sky-300',
    ORDERED: 'bg-sky-500/15 text-sky-300',
    SENT_TO_SUPPLIER: 'bg-sky-500/15 text-sky-300',
    PARTIALLY_RECEIVED: 'bg-violet-500/15 text-violet-300',
    RECEIVED: 'bg-emerald-500/15 text-emerald-300',
    CLOSED: 'bg-zinc-500/15 text-zinc-400',
    CANCELLED: 'bg-red-500/15 text-red-300',
  };

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const st = this.qv.state();
      const el = this.dialogRef()?.nativeElement;
      if (st?.kind !== 'PO' || !st.id) {
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
    this.purchases.getOrder(id).subscribe({
      next: (r) => {
        this.data = r;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo cargar la orden de compra.';
        this.loading = false;
      },
    });
  }

  close(): void {
    this.qv.close();
  }

  onDialogClose(): void {
    if (this.qv.state()?.kind === 'PO') {
      this.qv.close();
    }
  }

  backdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.qv.close();
  }

  vendorName(o: PurchaseOrder): string {
    return o.quotation?.vendor?.name ?? '—';
  }
}
