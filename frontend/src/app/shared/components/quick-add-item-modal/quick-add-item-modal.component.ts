import {
  Component,
  EventEmitter,
  Output,
  Input,
  signal,
  inject,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  InventoryItemsService,
  ItemCategory,
  QuickCreateItemResult,
  QuickCreateItemPayload,
} from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import {
  UnitsOfMeasureService,
  UnitOfMeasureRow,
} from '../../../core/services/units-of-measure/units-of-measure.service';

@Component({
  selector: 'app-quick-add-item-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './quick-add-item-modal.component.html',
})
export class QuickAddItemModalComponent implements OnInit, OnChanges {
  @Input() open = false;
  @Input() warehouseId: string | null = null;
  /**
   * `false` (uso desde `GlobalItemPicker`): overlay `position: fixed` al viewport — obligatorio
   * cuando hay **varios** `<dialog>` nativos en cascada (p. ej. operación de bodega + catálogo).
   * `true`: overlay `absolute` al ancestro posicionado; solo en escenarios sin ese apilamiento.
   * Guía: `docs/agentes/ui-quickadd-global-picker-dialogos-nativos.md`.
   */
  @Input() overlayInsideDialog = false;
  @Output() closed = new EventEmitter<void>();
  @Output() itemCreated = new EventEmitter<QuickCreateItemResult>();

  private itemsService = inject(InventoryItemsService);
  private notify = inject(NotificationService);
  private uomService = inject(UnitsOfMeasureService);

  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);
  units = signal<UnitOfMeasureRow[]>([]);
  isSaving = signal(false);

  /** Vista previa del próximo IN#### (GET; no reserva correlativo). */
  previewSku = signal('');
  previewSkuLoading = signal(false);

  name = '';
  partNumber = '';
  description = '';
  brand = '';
  compatibilityInfo = '';
  isSerialized = false;
  familyId = '';
  /** ID de la subcategoría (se envía como categoryId al API). */
  subcategoryId = '';
  unitOfMeasureId = '';

  ngOnInit() {
    this.loadFamilies();
    this.loadUnits();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open']?.currentValue === true) {
      this.loadFamilies();
      this.loadUnits();
      this.loadSkuPreview();
    }
  }

  private loadSkuPreview() {
    this.previewSkuLoading.set(true);
    this.previewSku.set('');
    this.itemsService.getNextInventorySkuPreview().subscribe({
      next: (r) => {
        this.previewSku.set(r.inventoryCode);
        this.previewSkuLoading.set(false);
      },
      error: () => {
        this.previewSkuLoading.set(false);
      },
    });
  }

  private loadFamilies() {
    this.itemsService.getCategoryFamilies().subscribe({
      next: (rows) => this.families.set(rows),
      error: () => {},
    });
  }

  private loadUnits() {
    this.uomService.list().subscribe({
      next: (rows) => {
        this.units.set(rows);
        if (!this.unitOfMeasureId && rows.length) {
          const un = rows.find((u) => u.abbreviation === 'UN');
          this.unitOfMeasureId = (un ?? rows[0]).id;
        }
      },
      error: () => this.units.set([]),
    });
  }

  onFamilyChange(_id: string) {
    this.subcategoryId = '';
    this.subcategories.set([]);
    if (!this.familyId) return;
    this.itemsService.getCategoryChildren(this.familyId).subscribe({
      next: (rows) => this.subcategories.set(rows),
      error: () => this.subcategories.set([]),
    });
  }

  close() {
    this.resetForm();
    this.closed.emit();
  }

  save() {
    if (!this.name.trim()) {
      this.notify.error('El nombre del artículo es obligatorio');
      return;
    }
    if (!this.familyId || !this.subcategoryId) {
      this.notify.error('Seleccione familia y subcategoría');
      return;
    }
    if (!this.unitOfMeasureId) {
      this.notify.error('Seleccione la unidad de medida');
      return;
    }

    this.isSaving.set(true);
    const payload: QuickCreateItemPayload = {
      name: this.name.trim(),
      categoryId: this.subcategoryId,
      unitOfMeasureId: this.unitOfMeasureId,
      warehouseId: this.warehouseId?.trim() || undefined,
    };
    const pn = this.partNumber.trim();
    if (pn) payload.partNumber = pn;
    const desc = this.description.trim();
    if (desc) payload.description = desc;
    const br = this.brand.trim();
    if (br) payload.brand = br;
    const compat = this.compatibilityInfo.trim();
    if (compat) payload.compatibilityInfo = compat;
    if (this.isSerialized) payload.isSerialized = true;

    this.itemsService
      .quickCreateItem(payload)
      .subscribe({
        next: (item) => {
          const ref =
            (item.inventoryCode && String(item.inventoryCode).trim()) ||
            (item.partNumber && String(item.partNumber).trim()) ||
            item.name;
          this.notify.success(`Artículo "${item.name}" creado (${ref})`);
          this.itemCreated.emit(item);
          this.isSaving.set(false);
          this.resetForm();
          this.closed.emit();
        },
        error: (err) => {
          this.notify.error(err.error?.message || 'Error al crear artículo');
          this.isSaving.set(false);
        },
      });
  }

  private resetForm() {
    this.name = '';
    this.previewSku.set('');
    this.partNumber = '';
    this.description = '';
    this.brand = '';
    this.compatibilityInfo = '';
    this.isSerialized = false;
    this.familyId = '';
    this.subcategoryId = '';
    this.subcategories.set([]);
    const rows = this.units();
    const un = rows.find((u) => u.abbreviation === 'UN');
    this.unitOfMeasureId = un ? un.id : rows[0]?.id ?? '';
  }
}
