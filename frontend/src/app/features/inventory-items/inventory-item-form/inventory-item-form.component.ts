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

  /** Creación: mientras llega la vista previa del correlativo desde el API. */
  nextSkuLoading = signal(false);

  canManageAttachments = () =>
    this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);

  constructor() {
    this.itemForm = this.fb.group({
      inventoryCode: [{ value: '', disabled: true }],
      partNumber: [''],
      name: ['', Validators.required],
      description: [''],
      compatibilityInfo: [''],
      familyId: ['', Validators.required],
      categoryId: ['', Validators.required],
      unitOfMeasureId: ['', Validators.required],
      brand: [''],
      isSerialized: [false],
      isInventory: [true],
      isAsset: [false],
      isConsumable: [true],
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
      const id = params.get('id');
      this.itemId = id;
      if (id) {
        this.mode = 'EDITING';
        this.loadItem(id);
      } else {
        this.mode = 'CREATING';
        this.loadNextSkuPreview();
      }
    });
  }

  private loadNextSkuPreview() {
    this.nextSkuLoading.set(true);
    this.inventoryItemsService.getNextInventorySkuPreview().subscribe({
      next: (r) => {
        this.itemForm.patchValue({ inventoryCode: r.inventoryCode });
        this.nextSkuLoading.set(false);
      },
      error: () => {
        this.nextSkuLoading.set(false);
      },
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
      WORK_ORDER_RETURN: 'Devolución a bodega (OT)',
      TRANSFER_OUT: 'Transferencia (salida)',
      TRANSFER_IN: 'Transferencia (ingreso)',
    };
    return map[type] ?? type;
  }

  /**
   * Cantidad con signo para lectura de kardex (salidas/consumos negativos).
   */
  ledgerSignedQty(row: ItemLedgerRow): number {
    const q = Number(row.quantity);
    switch (row.type) {
      case 'TRANSFER_OUT':
      case 'OUT':
      case 'WORK_ORDER_ISSUE':
        return -Math.abs(q);
      case 'TRANSFER_IN':
      case 'IN':
      case 'PURCHASE_RECEIPT':
      case 'RETURN':
      case 'WORK_ORDER_RETURN':
        return Math.abs(q);
      default:
        return q;
    }
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

  printItemLabel() {
    const id = this.itemId;
    if (!id) {
      this.notificationService.error('Guarde el artículo antes de imprimir la etiqueta.');
      return;
    }
    this.inventoryItemsService.getItemLabelPdf(id).subscribe({
      next: (blob) => {
        if (!blob?.size) {
          this.notificationService.error('No se pudo generar la etiqueta.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if (!w) {
          URL.revokeObjectURL(url);
          this.notificationService.error(
            'Permita ventanas emergentes para imprimir la etiqueta.',
          );
          return;
        }
        const revokeLater = () => URL.revokeObjectURL(url);
        w.addEventListener('beforeunload', revokeLater);
        setTimeout(() => {
          try {
            w.focus();
            w.print();
          } catch {
            /* el visor PDF puede manejar la impresión manualmente */
          }
        }, 400);
        setTimeout(revokeLater, 120_000);
      },
      error: () => {
        this.notificationService.error('No se pudo generar la etiqueta PDF.');
      },
    });
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
          partNumber: item.partNumber ?? '',
          name: item.name,
          description: item.description,
          compatibilityInfo:
            (item as { compatibilityInfo?: string | null }).compatibilityInfo ??
            '',
          unitOfMeasureId: uomId,
          brand: item.brand,
          isSerialized: item.isSerialized,
          isInventory: (item as any).isInventory ?? true,
          isAsset: (item as any).isAsset ?? false,
          isConsumable: (item as any).isConsumable ?? true,
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

    const raw = this.itemForm.getRawValue();
    const pn = String(raw.partNumber ?? '').trim();
    const payload: Record<string, unknown> = {
      partNumber: pn || null,
      name: raw.name,
      description: raw.description,
      compatibilityInfo: String(raw.compatibilityInfo ?? '').trim() || null,
      categoryId: raw.categoryId,
      unitOfMeasureId: raw.unitOfMeasureId,
      brand: raw.brand,
      isSerialized: raw.isSerialized,
      isInventory: raw.isInventory ?? true,
      isAsset: raw.isAsset ?? false,
      isConsumable: raw.isConsumable ?? true,
    };

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
