import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  InventoryItemsService,
  ItemPickerRow,
  ItemCategory,
} from '../../../core/services/inventory-items/inventory-items.service';
import {
  LubeReportsService,
  CreateLubeReportPayload,
} from '../../../core/services/lube-reports/lube-reports.service';
import { TenantService } from '../../../core/services/tenant/tenant.service';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { MeterReferenceBannerComponent } from '../../../shared/components/meter-reference-banner/meter-reference-banner.component';
import {
  FluidQuantityRowComponent,
  FluidQuantityValidation,
} from '../../../shared/components/fluid-quantity-row/fluid-quantity-row.component';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import type { EquipmentMeterSnapshot } from '../../../core/models/types';
import { parseFluidQuantity } from '../../../shared/utils/fluid-dispatch-limits.util';
import { O } from '../../../core/constants/operations-permissions';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

interface DraftLine {
  itemId: string;
  name: string;
  partNumber: string | null;
  inventoryCode: string | null;
  unitAbbr: string;
  allowsDecimals: boolean;
  stockAvailable: number | null;
  quantityControl: FormControl<string | number | null>;
  confirmedLargeDispatch: boolean;
}

@Component({
  selector: 'app-lube-report-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    GlobalItemPickerComponent,
    ConfirmModalComponent,
    HasPermissionDirective,
    MeterReferenceBannerComponent,
    FluidQuantityRowComponent,
  ],
  templateUrl: './lube-report-form.component.html',
})
export class LubeReportFormComponent implements OnInit {
  protected readonly O = O;

  private lubeService = inject(LubeReportsService);
  private warehousesService = inject(WarehousesService);
  private fleetService = inject(FleetService);
  private itemsService = inject(InventoryItemsService);
  private notify = inject(NotificationService);
  private tenantService = inject(TenantService);
  private equipmentMeterSnapshotService = inject(EquipmentMeterSnapshotService);

  meterSnapshot = signal<EquipmentMeterSnapshot | null>(null);
  meterSnapshotLoading = signal(false);
  private lastSnapshotEquipmentId: string | null = null;

  warehouses = signal<any[]>([]);
  equipments = signal<any[]>([]);
  equipSearch = signal('');
  lubeFamilyId = signal<string | null>(null);

  selectedWarehouseId = signal<string>('');
  selectedContractId = signal<string>('');
  selectedEquipmentId = signal<string>('');
  dispatchDate = signal<string>(this.todayIso());
  meterReading = signal<number | null>(null);
  notes = signal<string>('');
  lines = signal<DraftLine[]>([]);
  lineValidations = signal<Record<string, FluidQuantityValidation>>({});

  pickerOpen = signal(false);
  isSubmitting = signal(false);
  isSubmittingAndKeep = signal(false);
  warehousLoading = signal(true);
  equipLoading = signal(false);

  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  blockNegativeStock = computed(
    () =>
      this.tenantService.currentTenant()?.operationalConfig
        ?.blockNegativeStock ?? false,
  );

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

  effectiveCurrentMeter = computed<number | null>(() => {
    const snap = this.meterSnapshot();
    if (snap) return snap.currentMeter;
    const eq = this.equipments().find(
      (e) => e.id === this.selectedEquipmentId(),
    );
    return eq?.currentMeter ?? null;
  });

  meterReadingInvalid = computed(() => {
    const reading = this.meterReading();
    const cur = this.effectiveCurrentMeter();
    if (reading === null || cur === null) return false;
    return reading < cur;
  });

  canAddItems = computed(() => !!this.selectedWarehouseId());

  allLinesValid = computed(() => {
    const vals = this.lineValidations();
    const rows = this.lines();
    if (rows.length === 0) return false;
    return rows.every((l) => vals[l.itemId]?.valid === true);
  });

  isFormValid = computed(
    () =>
      !!this.selectedWarehouseId() &&
      !!this.selectedEquipmentId() &&
      !!this.dispatchDate() &&
      this.lines().length > 0 &&
      this.allLinesValid(),
  );

  canSubmit = computed(
    () => this.isFormValid() && !this.meterReadingInvalid(),
  );

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

  private resolveLubeFamily(): void {
    this.itemsService.getCategoryFamilies().subscribe({
      next: (families: ItemCategory[]) => {
        const TERMS = ['lubric', 'aceite', 'grasa'];
        const match = families.find((f) =>
          TERMS.some((t) => f.name.toLowerCase().includes(t)),
        );
        this.lubeFamilyId.set(match?.id ?? null);
      },
      error: () => {},
    });
  }

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
    this.lines.set([]);
    this.lineValidations.set({});
  }

  private resolveAvailableStock(row: ItemPickerRow): number | null {
    const fromPicker =
      row.stockAvailableQuantity ?? row.stockQuantity ?? null;
    return fromPicker != null && Number.isFinite(Number(fromPicker))
      ? Number(fromPicker)
      : null;
  }

  onItemPicked(row: ItemPickerRow): void {
    const existing = this.lines().find((l) => l.itemId === row.id);
    if (existing) {
      const allowsDecimals = existing.allowsDecimals;
      const cur = parseFluidQuantity(
        existing.quantityControl.value,
        allowsDecimals,
      );
      const next = allowsDecimals
        ? +(cur + 1).toFixed(3)
        : Math.floor(cur) + 1;
      existing.quantityControl.setValue(String(next));
      this.pickerOpen.set(false);
      return;
    }

    const allowsDecimals = row.unitOfMeasure.allowsDecimals ?? false;
    const newLine: DraftLine = {
      itemId: row.id,
      name: row.name,
      partNumber: row.partNumber,
      inventoryCode: row.inventoryCode ?? null,
      unitAbbr: row.unitOfMeasure.abbreviation,
      allowsDecimals,
      stockAvailable: this.resolveAvailableStock(row),
      quantityControl: new FormControl<string>('1'),
      confirmedLargeDispatch: false,
    };
    this.lines.update((prev) => [...prev, newLine]);
    this.pickerOpen.set(false);
  }

  removeLine(itemId: string): void {
    this.lines.update((prev) => prev.filter((l) => l.itemId !== itemId));
    this.lineValidations.update((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  onLineValidation(itemId: string, validation: FluidQuantityValidation): void {
    this.lineValidations.update((prev) => ({ ...prev, [itemId]: validation }));
  }

  onLineLargeConfirm(itemId: string, confirmed: boolean): void {
    this.lines.update((prev) =>
      prev.map((l) =>
        l.itemId === itemId ? { ...l, confirmedLargeDispatch: confirmed } : l,
      ),
    );
  }

  submit(keepContext = false): void {
    if (!this.canSubmit()) {
      if (this.meterReadingInvalid()) {
        this.notify.error(
          'El horómetro ingresado no puede ser menor al medidor actual del equipo.',
        );
      } else {
        this.notify.error(
          'Revise las cantidades de lubricante (stock, formato o confirmación de consumo inusual).',
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
      lines: this.lines().map((l) => ({
        itemId: l.itemId,
        quantity: parseFluidQuantity(
          l.quantityControl.value,
          l.allowsDecimals,
        ),
        confirmedLargeDispatch: l.confirmedLargeDispatch || undefined,
      })),
    };

    if (keepContext) {
      this.isSubmittingAndKeep.set(true);
    } else {
      this.isSubmitting.set(true);
    }

    this.lubeService.createReport(payload).subscribe({
      next: (report) => {
        this.notify.success(
          `Despacho ${report.correlative} registrado con éxito.`,
        );
        if (keepContext) {
          this.onEquipmentChange('');
          this.equipSearch.set('');
          this.lines.update((prev) =>
            prev.map((l) => {
              l.quantityControl.setValue('1');
              return { ...l, confirmedLargeDispatch: false };
            }),
          );
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

  resetForm(): void {
    this.selectedWarehouseId.set('');
    this.selectedContractId.set('');
    this.onEquipmentChange('');
    this.dispatchDate.set(this.todayIso());
    this.meterReading.set(null);
    this.notes.set('');
    this.lines.set([]);
    this.lineValidations.set({});
    this.equipSearch.set('');
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  selectedEquipmentLabel = computed(() => {
    const eq = this.equipments().find(
      (e) => e.id === this.selectedEquipmentId(),
    );
    if (!eq) return '';
    const plate = eq.plate ? ` — ${eq.plate}` : '';
    return `${eq.internalId ?? ''} ${eq.brand ?? ''} ${eq.model ?? ''}${plate}`.trim();
  });

  confirmLeaveIfDirty(): Observable<boolean> | boolean {
    if (this.lines().length === 0) return true;
    this.leaveConfirmOpen.set(true);
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
