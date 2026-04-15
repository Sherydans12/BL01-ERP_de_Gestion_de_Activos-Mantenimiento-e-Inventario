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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  PurchasesService,
  PurchaseInvoice,
} from '../../../core/services/purchases/purchases.service';
import { QuickViewService } from './quick-view.service';
import { FinancialClpPipe } from '../../pipes/financial-clp.pipe';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-purchase-invoice-quick-view',
  standalone: true,
  imports: [CommonModule, FinancialClpPipe],
  templateUrl: './purchase-invoice-quick-view.component.html',
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
export class PurchaseInvoiceQuickViewComponent implements OnDestroy {
  private purchases = inject(PurchasesService);
  private qv = inject(QuickViewService);
  private sanitizer = inject(DomSanitizer);
  private platformId = inject(PLATFORM_ID);

  dialogRef = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  loading = false;
  error: string | null = null;
  data: PurchaseInvoice | null = null;
  safePdfSrc: SafeResourceUrl | null = null;

  readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  readonly statusLabels: Record<string, string> = {
    PENDING: 'Pendiente conciliación',
    MATCHED: 'Conciliada',
    DISCREPANCY: 'Discrepancia',
    PAID: 'Pagada',
  };

  readonly statusClass: Record<string, string> = {
    PENDING: 'bg-amber-500/15 text-amber-300',
    MATCHED: 'bg-emerald-500/15 text-emerald-300',
    DISCREPANCY: 'bg-red-500/15 text-red-300',
    PAID: 'bg-sky-500/15 text-sky-300',
  };

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const st = this.qv.state();
      const el = this.dialogRef()?.nativeElement;
      if (st?.kind !== 'INV' || !st.id) {
        if (el?.open) el.close();
        this.data = null;
        this.safePdfSrc = null;
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
    this.safePdfSrc = null;
    this.purchases.getPurchaseInvoice(id).subscribe({
      next: (r) => {
        this.data = r;
        const h = this.pdfHref(r);
        this.safePdfSrc = h
          ? this.sanitizer.bypassSecurityTrustResourceUrl(h)
          : null;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo cargar la factura.';
        this.loading = false;
      },
    });
  }

  close(): void {
    this.qv.close();
  }

  onDialogClose(): void {
    if (this.qv.state()?.kind === 'INV') {
      this.qv.close();
    }
  }

  backdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.qv.close();
  }

  /** Enlace absoluto al PDF almacenado en el servidor. */
  pdfHref(inv: PurchaseInvoice): string | null {
    const u = inv.pdfUrl?.trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    const origin = environment.apiUrl.replace(/\/api\/?$/, '');
    return u.startsWith('/') ? `${origin}${u}` : `${origin}/${u}`;
  }

  amountNum(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isNaN(n) ? null : n;
  }
}
