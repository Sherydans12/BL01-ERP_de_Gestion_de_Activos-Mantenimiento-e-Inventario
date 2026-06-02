import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { InventoryItemsService, ItemPickerRow, ItemCategory } from '../../../core/services/inventory-items/inventory-items.service';
import {
  LubeReportsService,
  CreateLubeReportPayload,
} from '../../../core/services/lube-reports/lube-reports.service';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { O } from '../../../core/constants/operations-permissions';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

interface DraftLine {
  itemId: string;
  name: string;
  partNumber: string | null;
  inventoryCode: string | null;
  unitAbbr: string;
  allowsDecimals: boolean;
  /** Saldo disponible en bodega al momento de agregar el ítem. */
  stockAvailable: number | null;
  quantity: number;
}

@Component({
  selector: 'app-lube-report-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    GlobalItemPickerComponent,
    HasPermissionDirective,
  ],
  templateUrl: './lube-report-form.component.html',
})
export class LubeReportFormComponent implements OnInit {
  protected readonly O = O;

  private lubeService    = inject(LubeReportsService);
  private warehousesService = inject(WarehousesService);
  private fleetService   = inject(FleetService);
  private itemsService   = inject(InventoryItemsService);
  private notify         = inject(NotificationService);

  // ── Catálogos ────────────────────────────────────────────────────────────
  warehouses  = signal<any[]>([]);
  equipments  = signal<any[]>([]);
  equipSearch = signal('');

  /** ID de la familia "Lubricante" (o la primera subcategoría que coincida). */
  lubeFamilyId = signal<string | null>(null);

  // ── Estado del formulario ─────────────────────────────────────────────────
  selectedWarehouseId = signal<string>('');
  selectedContractId  = signal<string>('');
  selectedEquipmentId = signal<string>('');
  dispatchDate        = signal<string>(this.todayIso());
  meterReading        = signal<number | null>(null);
  notes               = signal<string>('');
  lines               = signal<DraftLine[]>([]);

  pickerOpen      = signal(false);
  isSubmitting    = signal(false);
  warehousLoading = signal(true);
  equipLoading    = signal(false);

  /** Equipos filtrados por texto de búsqueda (computed para reactividad). */
  filteredEquipments = computed(() => {
    const q = this.equipSearch().toLowerCase().trim();
    if (!q) return this.equipments();
    return this.equipments().filter(
      (e) =>
        e.internalId?.toLowerCase().includes(q) ||
        e.name?.toLowerCase().includes(q) ||
        e.licensePlate?.toLowerCase().includes(q),
    );
  });

  /** Habilita el picker solo cuando hay bodega seleccionada. */
  canAddItems = computed(() => !!this.selectedWarehouseId());

  /** El formulario está listo para enviar. */
  isFormValid = computed(
    () =>
      !!this.selectedWarehouseId() &&
      !!this.selectedEquipmentId() &&
      !!this.dispatchDate() &&
      this.lines().length > 0 &&
      this.lines().every((l) => l.quantity > 0),
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadWarehouses();
    this.loadEquipments();
    this.resolveLubeFamily();
  }

  private loadWarehouses(): void {
    this.warehousLoading.set(true);
    this.warehousesService.getWarehouses().subscribe({
      next: (data) => {
        this.warehouses.set(data);
        this.warehousLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar las bodegas.');
        this.warehousLoading.set(false);
      },
    });
  }

  private loadEquipments(): void {
    this.equipLoading.set(true);
    this.fleetService.getEquipments({ limit: 200 }).subscribe({
      next: (res) => {
        this.equipments.set(res.data);
        this.equipLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar los equipos.');
        this.equipLoading.set(false);
      },
    });
  }

  /** Busca la familia de categorías cuyo nombre contenga "lubric", "aceite" o "grasa". */
  private resolveLubeFamily(): void {
    this.itemsService.getCategoryFamilies().subscribe({
      next: (families: ItemCategory[]) => {
        const TERMS = ['lubric', 'aceite', 'grasa'];
        const match = families.find((f) =>
          TERMS.some((t) => f.name.toLowerCase().includes(t)),
        );
        this.lubeFamilyId.set(match?.id ?? null);
      },
      error: () => {
        // No bloquea el flujo: el picker abrirá sin familia bloqueada.
      },
    });
  }

  // ── Handlers de form ─────────────────────────────────────────────────────
  onWarehouseChange(warehouseId: string): void {
    const wh = this.warehouses().find((w) => w.id === warehouseId);
    this.selectedWarehouseId.set(warehouseId);
    this.selectedContractId.set(wh?.contractId ?? '');
    // Vacía las líneas al cambiar bodega (el stock cambia).
    this.lines.set([]);
  }

  onItemPicked(row: ItemPickerRow): void {
    const existing = this.lines().find((l) => l.itemId === row.id);
    if (existing) {
      // Incrementa cantidad si el ítem ya estaba en la lista.
      this.lines.update((prev) =>
        prev.map((l) =>
          l.itemId === row.id
            ? { ...l, quantity: +(l.quantity + 1).toFixed(4) }
            : l,
        ),
      );
      this.pickerOpen.set(false);
      return;
    }
    const newLine: DraftLine = {
      itemId: row.id,
      name: row.name,
      partNumber: row.partNumber,
      inventoryCode: row.inventoryCode ?? null,
      unitAbbr: row.unitOfMeasure.abbreviation,
      allowsDecimals: row.unitOfMeasure.allowsDecimals ?? false,
      stockAvailable: row.stockQuantity,
      quantity: 1,
    };
    this.lines.update((prev) => [...prev, newLine]);
    this.pickerOpen.set(false);
  }

  removeLine(itemId: string): void {
    this.lines.update((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  updateQty(itemId: string, raw: string): void {
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) return;
    this.lines.update((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, quantity: val } : l)),
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  submit(): void {
    if (!this.isFormValid() || this.isSubmitting()) return;

    const payload: CreateLubeReportPayload = {
      contractId: this.selectedContractId(),
      equipmentId: this.selectedEquipmentId(),
      warehouseId: this.selectedWarehouseId(),
      dispatchDate: this.dispatchDate(),
      meterReading: this.meterReading() ?? undefined,
      notes: this.notes().trim() || undefined,
      lines: this.lines().map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
    };

    this.isSubmitting.set(true);
    this.lubeService.createReport(payload).subscribe({
      next: (report) => {
        this.notify.success(`Despacho ${report.correlative} registrado con éxito.`);
        this.resetForm();
        this.isSubmitting.set(false);
      },
      error: (err) => {
        const msg: string =
          err?.error?.message ?? 'Ocurrió un error al registrar el despacho.';
        this.notify.error(msg);
        this.isSubmitting.set(false);
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  resetForm(): void {
    this.selectedWarehouseId.set('');
    this.selectedContractId.set('');
    this.selectedEquipmentId.set('');
    this.dispatchDate.set(this.todayIso());
    this.meterReading.set(null);
    this.notes.set('');
    this.lines.set([]);
    this.equipSearch.set('');
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Devuelve la placa / ID interno del equipo seleccionado para mostrar en el formulario. */
  selectedEquipmentLabel = computed(() => {
    const eq = this.equipments().find((e) => e.id === this.selectedEquipmentId());
    if (!eq) return '';
    const plate = eq.licensePlate ? ` — ${eq.licensePlate}` : '';
    return `${eq.internalId ?? ''} ${eq.name ?? ''}${plate}`.trim();
  });
}
