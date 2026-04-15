import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { SkeletonRowComponent } from '../../../shared/components/skeleton-row/skeleton-row.component';

export interface PendingRegularizationRowDto {
  itemStockId: string;
  quantity: number;
  unitCost: number | null;
  physicalShortageQty: number;
  debtValue: number;
  shelfLocation: string | null;
  bin: { id: string; code: string } | null;
  item: {
    id: string;
    partNumber: string;
    name: string;
    unitOfMeasure?: { abbreviation: string };
    itemCategory?: {
      id: string;
      name: string;
      parentCategory?: { id: string; name: string } | null;
    };
  };
}

@Component({
  selector: 'app-pending-regularization-modal',
  standalone: true,
  imports: [CommonModule, RouterModule, SkeletonRowComponent],
  templateUrl: './pending-regularization-modal.component.html',
  styles: [
    `
      dialog.app-pending-reg-dialog {
        max-width: min(96vw, 56rem);
        width: 100%;
        border: none;
        padding: 0;
        background: transparent;
      }
      dialog.app-pending-reg-dialog::backdrop {
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(4px);
      }
    `,
  ],
})
export class PendingRegularizationModalComponent implements OnChanges {
  private stockService = inject(InventoryStockService);

  @ViewChild('regDialog') regDialog!: ElementRef<HTMLDialogElement>;

  @Input() open = false;
  @Input() warehouseId: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() openAdjust = new EventEmitter<PendingRegularizationRowDto>();

  loading = signal(false);
  rows = signal<PendingRegularizationRowDto[]>([]);
  /** Recepciones abiertas contra OC solo en APPROVED (no enviada): dato inconsistente. */
  receiptsOnApprovedOrdersOnlyCount = signal(0);
  total = signal(0);
  page = signal(1);
  readonly pageSize = 25;
  warehouseLabel = signal<string>('');

  readonly skeletonRows = Array.from({ length: 6 }, (_, i) => i);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && !this.open) {
      this.loading.set(false);
      this.receiptsOnApprovedOrdersOnlyCount.set(0);
      setTimeout(() => this.regDialog?.nativeElement?.close(), 0);
      return;
    }
    if (!this.open || !this.warehouseId?.trim()) return;

    if (changes['open']?.currentValue || changes['warehouseId']) {
      this.page.set(1);
    }

    setTimeout(() => {
      const el = this.regDialog?.nativeElement;
      if (el && !el.open) {
        el.showModal();
      }
      this.fetch();
    }, 0);
  }

  fetch() {
    const wid = this.warehouseId?.trim();
    if (!wid) return;
    this.loading.set(true);
    this.stockService
      .getPendingRegularizationPage(wid, {
        page: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.total);
          const w = res.warehouse;
          this.warehouseLabel.set(
            w ? `${w.code} — ${w.name}` : wid,
          );
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.receiptsOnApprovedOrdersOnlyCount.set(0);
          this.loading.set(false);
        },
      });
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.pageSize));
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.fetch();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.fetch();
  }

  familyLabel(row: PendingRegularizationRowDto): string {
    const ic = row.item?.itemCategory;
    if (!ic) return '—';
    if (ic.parentCategory?.name) {
      return `${ic.parentCategory.name} › ${ic.name}`;
    }
    return ic.name;
  }

  locationLabel(row: PendingRegularizationRowDto): string {
    const parts: string[] = [];
    if (row.bin?.code) parts.push(`Rack/Bin ${row.bin.code}`);
    if (row.shelfLocation?.trim()) parts.push(row.shelfLocation.trim());
    return parts.length ? parts.join(' · ') : '—';
  }

  onClose() {
    this.closed.emit();
  }

  backdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.closeDialog();
    }
  }

  closeDialog() {
    const el = this.regDialog?.nativeElement;
    if (el?.open) el.close();
    this.onClose();
  }

  emitAdjust(row: PendingRegularizationRowDto) {
    this.openAdjust.emit(row);
    this.closeDialog();
  }
}
