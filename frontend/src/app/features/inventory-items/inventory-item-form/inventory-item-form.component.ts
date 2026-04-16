import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { WorkOrderDetailModalComponent } from '../../work-orders/work-order-detail-modal/work-order-detail-modal.component';
import {
  InventoryItemsService,
  ItemCategory,
  ItemLedgerRow,
  InventoryItemAttachmentRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { environment } from '../../../../environments/environment';
import {
  UnitsOfMeasureService,
  UnitOfMeasureRow,
} from '../../../core/services/units-of-measure/units-of-measure.service';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

@Component({
  selector: 'app-inventory-item-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    WorkOrderDetailModalComponent,
    EntityLinkComponent,
  ],
  templateUrl: './inventory-item-form.component.html',
})
export class InventoryItemFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryItemsService = inject(InventoryItemsService);
  private uomService = inject(UnitsOfMeasureService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  itemId: string | null = null;
  mode: 'CREATING' | 'EDITING' = 'CREATING';
  itemForm: FormGroup;

  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);
  units = signal<UnitOfMeasureRow[]>([]);

  activeTab = signal<'ficha' | 'historial'>('ficha');
  ledgerRows = signal<ItemLedgerRow[]>([]);
  ledgerTotal = signal(0);
  ledgerPage = signal(1);
  readonly ledgerPageSize = 25;
  ledgerLoading = signal(false);

  adjustDetailOpen = signal(false);
  adjustDetailRow = signal<ItemLedgerRow | null>(null);

  ledgerOtModalOpen = signal(false);
  ledgerOtModalId = signal<string | null>(null);

  attachments = signal<InventoryItemAttachmentRow[]>([]);
  attachmentsLoading = signal(false);
  attachmentUploadBusy = signal(false);

  /** Payload escaneable (backend: INV:<uuid>). */
  itemQrCode = signal<string | null>(null);

  canManageAttachments = () =>
    this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);

  constructor() {
    this.itemForm = this.fb.group({
      inventoryCode: [''],
      partNumber: ['', Validators.required],
      name: ['', Validators.required],
      description: [''],
      familyId: ['', Validators.required],
      categoryId: ['', Validators.required],
      unitOfMeasureId: ['', Validators.required],
      brand: [''],
      isSerialized: [false],
    });
  }

  ngOnInit() {
    this.itemId = this.route.snapshot.paramMap.get('id');
    if (this.itemId) {
      this.mode = 'EDITING';
    }

    this.inventoryItemsService.getCategoryFamilies().subscribe({
      next: (rows) => this.families.set(rows),
      error: () => {},
    });

    this.uomService.list().subscribe({
      next: (rows) => {
        this.units.set(rows);
        if (
          this.mode === 'CREATING' &&
          !this.itemForm.get('unitOfMeasureId')?.value
        ) {
          const un = rows.find((u) => u.abbreviation === 'UN');
          if (un) {
            this.itemForm.patchValue({ unitOfMeasureId: un.id });
          } else if (rows[0]) {
            this.itemForm.patchValue({ unitOfMeasureId: rows[0].id });
          }
        }
      },
      error: () => {},
    });

    this.route.paramMap.subscribe((params) => {
      this.itemId = params.get('id');
      if (this.itemId) {
        this.mode = 'EDITING';
        this.loadItem(this.itemId);
      }
    });
  }

  setTab(tab: 'ficha' | 'historial') {
    this.activeTab.set(tab);
    if (tab === 'historial' && this.itemId) {
      this.loadLedger(1);
    }
  }

  loadLedger(page: number) {
    const id = this.itemId;
    if (!id) return;
    this.ledgerLoading.set(true);
    this.inventoryItemsService
      .getItemLedger(id, { page, pageSize: this.ledgerPageSize })
      .subscribe({
        next: (res) => {
          this.ledgerRows.set(res.data);
          this.ledgerTotal.set(res.total);
          this.ledgerPage.set(res.page);
          this.ledgerLoading.set(false);
        },
        error: () => {
          this.ledgerRows.set([]);
          this.ledgerTotal.set(0);
          this.ledgerLoading.set(false);
          this.notificationService.error('No se pudo cargar el historial de movimientos.');
        },
      });
  }

  ledgerTotalPages(): number {
    return Math.max(
      1,
      Math.ceil(this.ledgerTotal() / this.ledgerPageSize),
    );
  }

  prevLedgerPage() {
    if (this.ledgerPage() <= 1) return;
    this.loadLedger(this.ledgerPage() - 1);
  }

  nextLedgerPage() {
    if (this.ledgerPage() >= this.ledgerTotalPages()) return;
    this.loadLedger(this.ledgerPage() + 1);
  }

  attachmentPublicUrl(url: string): string {
    if (url.startsWith('http')) return url;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base + (url.startsWith('/') ? url : `/${url}`);
  }

  loadAttachments(itemId: string) {
    this.attachmentsLoading.set(true);
    this.inventoryItemsService.getAttachments(itemId).subscribe({
      next: (rows) => {
        this.attachments.set(rows);
        this.attachmentsLoading.set(false);
      },
      error: () => {
        this.attachments.set([]);
        this.attachmentsLoading.set(false);
      },
    });
  }

  onAttachmentFileChange(event: Event) {
    const id = this.itemId;
    if (!id || !this.canManageAttachments()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      this.notificationService.error('Solo se permiten archivos PDF.');
      return;
    }
    this.attachmentUploadBusy.set(true);
    this.inventoryItemsService.uploadAttachment(id, file).subscribe({
      next: (row) => {
        this.attachments.update((a) => [row, ...a]);
        this.attachmentUploadBusy.set(false);
        this.notificationService.success('Documento adjuntado.');
      },
      error: (err) => {
        this.attachmentUploadBusy.set(false);
        this.notificationService.error(
          err.error?.message || 'No se pudo subir el archivo.',
        );
      },
    });
  }

  removeAttachment(att: InventoryItemAttachmentRow) {
    const id = this.itemId;
    if (!id || !this.canManageAttachments()) return;
    if (!confirm(`¿Eliminar "${att.fileName}"?`)) return;
    this.inventoryItemsService.deleteAttachment(id, att.id).subscribe({
      next: () => {
        this.attachments.update((a) => a.filter((x) => x.id !== att.id));
        this.notificationService.success('Adjunto eliminado.');
      },
      error: () =>
        this.notificationService.error('No se pudo eliminar el adjunto.'),
    });
  }

  ledgerTypeLabel(type: string): string {
    const map: Record<string, string> = {
      IN: 'Entrada',
      OUT: 'Salida',
      ADJUST: 'Ajuste',
      RETURN: 'Devolución',
      PURCHASE_RECEIPT: 'Recepción compra',
      WORK_ORDER_ISSUE: 'Consumo OT',
      TRANSFER_OUT: 'Traslado salida',
      TRANSFER_IN: 'Traslado entrada',
    };
    return map[type] ?? type;
  }

  openAdjustDetail(row: ItemLedgerRow) {
    if (row.type !== 'ADJUST') return;
    this.adjustDetailRow.set(row);
    this.adjustDetailOpen.set(true);
  }

  closeAdjustDetail() {
    this.adjustDetailOpen.set(false);
    this.adjustDetailRow.set(null);
  }

  openLedgerOtModal(workOrderId: string) {
    this.ledgerOtModalId.set(workOrderId);
    this.ledgerOtModalOpen.set(true);
  }

  closeLedgerOtModal() {
    this.ledgerOtModalOpen.set(false);
    this.ledgerOtModalId.set(null);
  }

  async printItemLabel() {
    const payload =
      this.itemQrCode() ??
      String(this.itemForm.get('partNumber')?.value ?? '').trim();
    if (!payload) {
      this.notificationService.error('Sin código para etiqueta.');
      return;
    }
    const partNumber = String(this.itemForm.get('partNumber')?.value ?? '');
    const name = String(this.itemForm.get('name')?.value ?? '');
    try {
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const w = window.open('', '_blank', 'width=420,height=560');
      if (!w) {
        this.notificationService.error(
          'Permita ventanas emergentes para imprimir la etiqueta.',
        );
        return;
      }
      const esc = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;');
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiqueta ${esc(partNumber)}</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 16px; text-align: center; color: #111; }
          .pn { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 700; margin-top: 12px; }
          .nm { font-size: 11px; color: #444; margin-top: 6px; max-width: 320px; margin-left: auto; margin-right: auto; }
          img { display: block; margin: 0 auto; }
        </style></head><body>
        <img src="${dataUrl}" width="200" height="200" alt="QR" />
        <div class="pn">${esc(partNumber)}</div>
        <div class="nm">${esc(name)}</div>
        <p style="font-size:9px;color:#888;margin-top:12px">${esc(payload)}</p>
        </body></html>`);
      w.document.close();
      w.onload = () => {
        w.focus();
        w.print();
      };
    } catch {
      this.notificationService.error('No se pudo generar el código QR.');
    }
  }

  parseAdjustmentNotes(notes: string | null): { reason: string; comment: string } {
    if (!notes?.trim()) {
      return { reason: '', comment: '' };
    }
    const m = notes.match(/^Ajuste\s*\[([^\]]+)\]\s*:\s*([\s\S]*)$/);
    if (m) {
      return { reason: m[1].trim(), comment: m[2].trim() };
    }
    return { reason: 'Ajuste', comment: notes.trim() };
  }

  onFamilyChangeFromUi() {
    const familyId = String(this.itemForm.get('familyId')?.value ?? '');
    this.itemForm.patchValue({ categoryId: '' });
    this.subcategories.set([]);
    if (!familyId) return;
    this.inventoryItemsService.getCategoryChildren(familyId).subscribe({
      next: (rows) => this.subcategories.set(rows),
      error: () => this.subcategories.set([]),
    });
  }

  loadItem(id: string) {
    this.inventoryItemsService.getItem(id).subscribe({
      next: (item) => {
        this.itemQrCode.set((item as { qrCode?: string }).qrCode ?? null);
        const famId = item.itemCategory?.parentCategory?.id ?? '';
        const uomId =
          item.unitOfMeasure?.id ??
          (typeof item.unitOfMeasureId === 'string' ? item.unitOfMeasureId : '');
        const base = {
          inventoryCode: (item as { inventoryCode?: string | null }).inventoryCode ?? '',
          partNumber: item.partNumber,
          name: item.name,
          description: item.description,
          unitOfMeasureId: uomId,
          brand: item.brand,
          isSerialized: item.isSerialized,
        };
        if (famId) {
          this.inventoryItemsService.getCategoryChildren(famId).subscribe({
            next: (rows) => {
              this.subcategories.set(rows);
              this.itemForm.patchValue({
                ...base,
                familyId: famId,
                categoryId: item.categoryId,
              });
              this.loadAttachments(id);
            },
            error: () => {
              this.itemForm.patchValue({
                ...base,
                familyId: famId,
                categoryId: item.categoryId,
              });
              this.loadAttachments(id);
            },
          });
        } else {
          this.itemForm.patchValue({
            ...base,
            familyId: '',
            categoryId: item.categoryId ?? '',
          });
          this.loadAttachments(id);
        }
      },
      error: () => {
        this.notificationService.error('Artículo no encontrado');
        this.router.navigate(['/app/articulos']);
      },
    });
  }

  onSubmit() {
    if (this.itemForm.invalid) {
      this.itemForm.markAllAsTouched();
      return;
    }

    const raw = this.itemForm.value;
    const sku = String(raw.inventoryCode ?? '').trim();
    const payload: Record<string, unknown> = {
      partNumber: raw.partNumber,
      name: raw.name,
      description: raw.description,
      categoryId: raw.categoryId,
      unitOfMeasureId: raw.unitOfMeasureId,
      brand: raw.brand,
      isSerialized: raw.isSerialized,
    };
    if (sku) {
      payload['inventoryCode'] = sku;
    } else if (this.mode === 'EDITING') {
      payload['inventoryCode'] = '';
    }

    if (this.mode === 'CREATING') {
      this.inventoryItemsService.createItem(payload).subscribe({
        next: () => {
          this.notificationService.success('Artículo creado exitosamente.');
          this.router.navigate(['/app/articulos']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al crear.',
          ),
      });
    } else if (this.itemId) {
      this.inventoryItemsService.updateItem(this.itemId, payload).subscribe({
        next: () => {
          this.notificationService.success(
            'Artículo actualizado exitosamente.',
          );
          this.router.navigate(['/app/articulos']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al actualizar.',
          ),
      });
    }
  }
}
