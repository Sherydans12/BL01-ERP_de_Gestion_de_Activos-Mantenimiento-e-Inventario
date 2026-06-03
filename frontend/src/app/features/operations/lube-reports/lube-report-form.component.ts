import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { InventoryItemsService, ItemPickerRow, ItemCategory } from '../../../core/services/inventory-items/inventory-items.service';
import {
  LubeReportsService,
  CreateLubeReportPayload,
} from '../../../core/services/lube-reports/lube-reports.service';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { MeterReferenceBannerComponent } from '../../../shared/components/meter-reference-banner/meter-reference-banner.component';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import type { EquipmentMeterSnapshot } from '../../../core/models/types';
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
    RouterLink,
    GlobalItemPickerComponent,
    ConfirmModalComponent,
    HasPermissionDirective,
    MeterReferenceBannerComponent,
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
  private equipmentMeterSnapshotService = inject(EquipmentMeterSnapshotService);

  meterSnapshot = signal<EquipmentMeterSnapshot | null>(null);
  meterSnapshotLoading = signal(false);
  private lastSnapshotEquipmentId: string | null = null;

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

  pickerOpen         = signal(false);
  isSubmitting       = signal(false);
  isSubmittingAndKeep = signal(false);
  warehousLoading    = signal(true);
  equipLoading       = signal(false);

  // ── CanDeactivate: modal de confirmación de salida ────────────────────────
  leaveConfirmOpen   = signal(false);
  private leaveResult$ = new Subject<boolean>();

  /** Equipos filtrados por texto de búsqueda (computed para reactividad). */
  filteredEquipments = computed(() => {
    const q = this.equipSearch().toLowerCase().trim();
    if (!q) return this.equipments();
    return this.equipments().filter(
      (e) =>
        e.internalId?.toLowerCase().includes(q) ||
        e.brand?.toLowerCase().includes(q) ||
        e.model?.toLowerCase().includes(q) ||
        e.plate?.toLowerCase().includes(q),
    );
  });

  /** Medidor vigente del snapshot (SSOT); fallback al listado de flota. */
  effectiveCurrentMeter = computed<number | null>(() => {
    const snap = this.meterSnapshot();
    if (snap) return snap.currentMeter;
    const eq = this.equipments().find((e) => e.id === this.selectedEquipmentId());
    return eq?.currentMeter ?? null;
  });

  meterReadingInvalid = computed(() => {
    const reading = this.meterReading();
    const cur = this.effectiveCurrentMeter();
    if (reading === null || cur === null) return false;
    return reading < cur;
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

  /** Formulario listo para guardar (incluye regla de horómetro no regresivo). */
  canSubmit = computed(
    () => this.isFormValid() && !this.meterReadingInvalid(),
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
  onEquipmentChange(equipmentId: string): void {
    this.selectedEquipmentId.set(equipmentId);
    if (!equipmentId) {
      this.meterSnapshot.set(null);
      this.lastSnapshotEquipmentId = null;
      this.meterReading.set(null);
      return;
    }
    this.loadMeterSnapshot(equipmentId);
  }

  private loadMeterSnapshot(equipmentId: string): void {
    if (
      equipmentId === this.lastSnapshotEquipmentId &&
      this.meterSnapshot() !== null
    ) {
      return;
    }
    this.lastSnapshotEquipmentId = equipmentId;
    this.meterSnapshotLoading.set(true);
    this.equipmentMeterSnapshotService.getSnapshot(equipmentId).subscribe({
      next: (s) => {
        this.meterSnapshot.set(s);
        this.meterSnapshotLoading.set(false);
      },
      error: () => {
        this.meterSnapshot.set(null);
        this.meterSnapshotLoading.set(false);
      },
    });
  }

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

  /**
   * @param keepContext Si es `true`, tras el POST exitoso solo limpia equipo,
   * horómetro y cantidades de líneas — mantiene bodega y lubricantes para
   * despachar rápidamente al siguiente camión en la fila.
   */
  submit(keepContext = false): void {
    if (!this.canSubmit()) {
      if (this.meterReadingInvalid()) {
        this.notify.error(
          'El horómetro ingresado no puede ser menor al medidor actual del equipo.',
        );
      }
      return;
    }
    if (keepContext ? this.isSubmittingAndKeep() : this.isSubmitting()) return;

    const payload: CreateLubeReportPayload = {
      contractId: this.selectedContractId(),
      equipmentId: this.selectedEquipmentId(),
      warehouseId: this.selectedWarehouseId(),
      dispatchDate: this.dispatchDate(),
      meterReading: this.meterReading() ?? undefined,
      notes: this.notes().trim() || undefined,
      lines: this.lines().map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
    };

    if (keepContext) {
      this.isSubmittingAndKeep.set(true);
    } else {
      this.isSubmitting.set(true);
    }

    this.lubeService.createReport(payload).subscribe({
      next: (report) => {
        this.notify.success(`Despacho ${report.correlative} registrado con éxito.`);
        if (keepContext) {
          // Solo limpia equipo, horómetro y cantidades — mantiene bodega y lubricantes.
          this.onEquipmentChange('');
          this.equipSearch.set('');
          this.lines.update((prev) => prev.map((l) => ({ ...l, quantity: 1 })));
          this.isSubmittingAndKeep.set(false);
        } else {
          this.resetForm();
          this.isSubmitting.set(false);
        }
      },
      error: (err) => {
        const msg: string =
          err?.error?.message ?? 'Ocurrió un error al registrar el despacho.';
        this.notify.error(msg);
        this.isSubmitting.set(false);
        this.isSubmittingAndKeep.set(false);
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  resetForm(): void {
    this.selectedWarehouseId.set('');
    this.selectedContractId.set('');
    this.onEquipmentChange('');
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
    const plate = eq.plate ? ` — ${eq.plate}` : '';
    return `${eq.internalId ?? ''} ${eq.brand ?? ''} ${eq.model ?? ''}${plate}`.trim();
  });

  // ── CanDeactivate ─────────────────────────────────────────────────────────

  /** Llamado por el guard. Si hay líneas sin guardar, muestra el modal y devuelve Observable. */
  confirmLeaveIfDirty(): Observable<boolean> | boolean {
    if (this.lines().length === 0) return true;
    this.leaveConfirmOpen.set(true);
    // El modal emitirá en leaveResult$ al confirmar o cancelar.
    return this.leaveResult$.asObservable();
  }

  onLeaveConfirmed(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(true);
  }

  onLeaveCancelled(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(false);
  }
}
