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
  WarehouseReceipt,
} from '../../../core/services/purchases/purchases.service';
import { QuickViewService } from './quick-view.service';
import { EntityLinkComponent } from '../entity-link/entity-link.component';

@Component({
  selector: 'app-warehouse-receipt-quick-view',
  standalone: true,
  imports: [CommonModule, EntityLinkComponent],
  templateUrl: './warehouse-receipt-quick-view.component.html',
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
export class WarehouseReceiptQuickViewComponent implements OnDestroy {
  private purchases = inject(PurchasesService);
  private qv = inject(QuickViewService);
  private platformId = inject(PLATFORM_ID);

  dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  loading = false;
  error: string | null = null;
  data: WarehouseReceipt | null = null;

  readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);

  readonly statusLabels: Record<string, string> = {
    PENDING: 'Pendiente',
    PARTIAL: 'Parcial',
    COMPLETED: 'Completada',
  };

  readonly statusClass: Record<string, string> = {
    PENDING: 'bg-amber-500/15 text-amber-300',
    PARTIAL: 'bg-sky-500/15 text-sky-300',
    COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  };

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const st = this.qv.state();
      const el = this.dialogRef()?.nativeElement;
      if (st?.kind !== 'WR' || !st.id) {
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
    this.purchases.getReceipt(id).subscribe({
      next: (r) => {
        this.data = r;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo cargar la recepción.';
        this.loading = false;
      },
    });
  }

  close(): void {
    this.qv.close();
  }

  onDialogClose(): void {
    if (this.qv.state()?.kind === 'WR') {
      this.qv.close();
    }
  }

  backdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.qv.close();
  }
}
