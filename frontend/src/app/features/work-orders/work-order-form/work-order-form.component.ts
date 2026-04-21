import {
  Component,
  inject,
  signal,
  OnInit,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  FormControl,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import {
  WorkOrdersService,
  CreateWorkOrderExcelPayload,
  FluidCompartmentRowPayload,
  FluidCompartment,
  OtClassificationTag,
} from '../../../core/services/work-orders/work-orders.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import {
  InventoryItemsService,
  ItemPickerRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import {
  Equipment,
  EquipmentMeterSnapshot,
  MeterType,
} from '../../../core/models/types';
import {
  computePmProjection,
  pmIntervalSourceLabel,
  type PmIntervalSource,
} from '../../../core/utils/pm-interval';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import {
  CLASSIFICATION_OPTIONS,
  FLUID_COMPARTMENTS_ORDER,
  FLUID_COMPARTMENT_LABELS,
} from './work-order-form.constants';

function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

@Component({
  selector: 'app-work-order-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    GlobalItemPickerComponent,
  ],
  templateUrl: './work-order-form.component.html',
  styleUrl: './work-order-form.component.scss',
})
export class WorkOrderFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private workOrdersService = inject(WorkOrdersService);
  private fleetService = inject(FleetService);
  private notificationService = inject(NotificationService);
  private warehousesService = inject(WarehousesService);
  private inventoryItemsService = inject(InventoryItemsService);
  private inventoryStockService = inject(InventoryStockService);
  private maintenanceKitsService = inject(MaintenanceKitsService);
  private equipmentMeterSnapshotService = inject(EquipmentMeterSnapshotService);

  otId: string | null = null;
  mode: 'CREATING' | 'EDITING' | 'READONLY' = 'CREATING';
  currentStatus = '';

  tab = signal<'datos' | 'backlog' | 'legacy'>('datos');
  legacyOpen = signal(false);
  pmPanelOpen = signal(false);

  fleet = signal<Equipment[]>([]);
  warehouses = signal<any[]>([]);
  warehouseStocks = signal<any[]>([]);
  allKits = signal<any[]>([]);
  pmKits = signal<any[]>([]);

  backlogItems = signal<
    {
      id: string;
      description: string;
      status: 'PENDING' | 'DONE';
      createdAt?: string;
    }[]
  >([]);
  newBacklogText = signal('');

  showPartPicker = signal(false);
  partPickerIndex = signal(-1);
  showFluidPicker = signal(false);
  fluidPickerRowIndex = signal(-1);

  classificationOptions = CLASSIFICATION_OPTIONS;

  readonly availabilityOptions: { v: 'SI' | 'NO' | 'STP'; l: string }[] = [
    { v: 'SI', l: 'Sí' },
    { v: 'NO', l: 'No' },
    { v: 'STP', l: 'STP' },
  ];

  pmSourceLabel(src: PmIntervalSource | undefined): string {
    return src ? pmIntervalSourceLabel(src) : '';
  }

  /** Familia catálogo «Sistemas» para filtrar selección de sistemas intervenidos. */
  systemsCatalogFamilyId = signal<string | null>(null);

  pickedSystems = signal<{ id: string; label: string }[]>([]);
  showSystemPicker = signal(false);

  closeAllowed = computed(() => {
    const raw = this.otForm.get('detentionStartedAt')?.value;
    return typeof raw === 'string' && raw.trim().length > 0;
  });

  fluidCompartmentOrder = FLUID_COMPARTMENTS_ORDER;

  meterLabel = computed(() =>
    this.selectedEquipment()?.meterType === MeterType.KILOMETERS
      ? 'Kilometraje'
      : 'Horómetro',
  );

  selectedEquipment = signal<Equipment | null>(null);

  pmPreview = computed(() =>
    computePmProjection(this.selectedEquipment()),
  );

  lastClosedOt = signal<{ id: string; correlative: string } | null>(null);

  meterSnapshot = signal<EquipmentMeterSnapshot | null>(null);
  meterSnapshotLoading = signal(false);

  meterSourceBadge = computed(() => {
    const snap = this.meterSnapshot();
    const last = snap?.lastLog;
    if (!last) return 'Sin registro en bitácora';
    if (last.source === 'OT') {
      return last.otCorrelative
        ? `Desde OT-${last.otCorrelative}`
        : 'Desde OT';
    }
    if (last.source === 'TELEMETRY') return 'Telemetría';
    return 'Manual / maestro';
  });

  otForm: FormGroup;

  constructor() {
    const compartmentRows = this.fb.array(
      FLUID_COMPARTMENTS_ORDER.map((compartment) =>
        this.fb.group({
          compartment: [{ value: compartment, disabled: true }],
          fluidType: [''],
          liters: [''],
          action: ['RELLENO' as const],
          inventoryItemId: [''],
          linkedFluidItemName: [''],
        }),
      ),
    );

    const classificationTagsCtrl = this.fb.nonNullable.control<
      OtClassificationTag[]
    >([]);

    this.otForm = this.fb.group({
      equipmentId: ['', Validators.required],
      warehouseId: [''],

      detentionStartedAt: [''],
      detentionEndedAt: [''],
      detentionInitialMeter: ['', Validators.required],
      detentionFinalMeter: [''],

      mechanicAttentionStartedAt: ['', Validators.required],
      mechanicAttentionEndedAt: ['', Validators.required],

      clientAttributedStart: [''],
      clientAttributedEnd: [''],
      clientAttributedReason: [''],

      affectsAvailability: ['SI' as 'SI' | 'NO' | 'STP'],
      classificationTags: classificationTagsCtrl,

      workLocation: ['TERRENO' as 'TALLER' | 'TERRENO'],
      personnelQuantity: [
        1,
        [Validators.required, Validators.min(1)],
      ],
      workShift: ['DIA' as 'DIA' | 'NOCHE'],

      initialRequestDescription: [''],
      symptomsText: [''],
      causeText: [''],
      workPerformedDescription: ['', Validators.required],

      techniciansNames: [''],
      responsibleMechanicName: ['', Validators.required],
      responsibleMechanicSignature: [''],
      shiftSupervisorName: [''],
      shiftSupervisorSignature: [''],

      pmCycleNumber: [''],

      compartmentRows,
      parts: this.fb.array([] as FormGroup[]),
    });
  }

  get compartmentRowsArray(): FormArray {
    return this.otForm.get('compartmentRows') as FormArray;
  }

  get partsArray(): FormArray {
    return this.otForm.get('parts') as FormArray;
  }

  /** Misma referencia para poder duplicar el `<select>` de bodega (Datos OT + Legacy). */
  get warehouseIdControl(): FormControl<string | null> {
    return this.otForm.get('warehouseId') as FormControl<string | null>;
  }

  ngOnInit(): void {
    /** Familia «Sistemas» del maestro de categorías (`/app/catalogos`); el backend la crea si falta (bootstrap + primer GET familias). */
    this.inventoryItemsService.getCategoryFamilies().subscribe({
      next: (cats) => {
        const hit =
          cats.find((c) => /^sistemas$/i.test(String(c.name).trim())) ??
          cats.find((c) => /sistema/i.test(String(c.name)));
        this.systemsCatalogFamilyId.set(hit?.id ?? null);
      },
      error: () => this.systemsCatalogFamilyId.set(null),
    });

    this.fleetService.getEquipments({ limit: 1000 }).subscribe({
      next: (res) => this.fleet.set(res.data),
      error: () => undefined,
    });

    this.maintenanceKitsService.getKits().subscribe({
      next: (kits) => {
        this.allKits.set(kits);
        this.pmKits.set(kits);
      },
      error: () => undefined,
    });

    this.route.paramMap.subscribe((params) => {
      this.otId = params.get('id');
      if (this.otId) {
        this.mode = 'EDITING';
        this.loadWorkOrder(this.otId);
      }
    });

    this.otForm.get('equipmentId')?.valueChanges.subscribe((eqId) => {
      if (!eqId || this.mode === 'READONLY') return;
      const eq = this.fleet().find((e) => e.id === eqId) ?? null;
      this.selectedEquipment.set(eq);
      if (eq) {
        this.selectedEquipmentMeterHook(eq);
        this.loadWarehousesForEquipment(eq);
        this.filterKits(eq);
        this.loadLastClosedOt(eq.id);
        this.loadMeterSnapshot(eq.id);
      } else {
        this.warehouses.set([]);
        this.lastClosedOt.set(null);
        this.meterSnapshot.set(null);
      }
    });

    this.otForm.get('warehouseId')?.valueChanges.subscribe((whId) => {
      if (whId && this.mode !== 'READONLY') {
        this.inventoryStockService.getStockByWarehouse(whId).subscribe({
          next: (s) => this.warehouseStocks.set(s),
          error: () => this.warehouseStocks.set([]),
        });
      } else {
        this.warehouseStocks.set([]);
      }
    });
  }

  private selectedEquipmentMeterHook(eq: Equipment) {
    const ini = eq.currentMeter ?? eq.initialMeter ?? 0;
    if (this.mode === 'CREATING') {
      this.otForm.patchValue(
        {
          detentionInitialMeter: ini,
          detentionFinalMeter: '',
        },
        { emitEvent: false },
      );
    }
  }

  private loadWarehousesForEquipment(eq: Equipment) {
    const contractId = eq.contractId || (eq as any).subcontract?.contractId;
    if (contractId) {
      this.warehousesService.getWarehousesByContract(contractId).subscribe({
        next: (whs) => this.warehouses.set(whs),
        error: () => this.warehouses.set([]),
      });
    } else {
      this.warehouses.set([]);
    }
  }

  private filterKits(eq: Equipment) {
    const compatible = this.allKits().filter((kit) => {
      const isUniversal = !kit.equipmentBrand && !kit.equipmentModel;
      const matchBrand = kit.equipmentBrand === eq.brand;
      const matchModel = kit.equipmentModel === eq.model;
      return (
        isUniversal || (matchBrand && (!kit.equipmentModel || matchModel))
      );
    });
    this.pmKits.set(compatible);
  }

  private loadMeterSnapshot(equipmentId: string) {
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

  private loadLastClosedOt(equipmentId: string) {
    this.workOrdersService
      .getWorkOrdersFiltered({
        equipmentId,
        status: 'CLOSED',
        limit: 1,
      })
      .subscribe({
        next: (res) => {
          const row = res.data?.[0];
          if (row?.id && row?.correlative) {
            this.lastClosedOt.set({ id: row.id, correlative: row.correlative });
          } else {
            this.lastClosedOt.set(null);
          }
        },
        error: () => this.lastClosedOt.set(null),
      });
  }

  private loadWorkOrder(id: string) {
    this.workOrdersService.getWorkOrder(id).subscribe({
      next: (ot: any) => {
        this.currentStatus = ot.status;
        if (ot.status === 'CLOSED') this.mode = 'READONLY';

        if (ot.equipment) {
          this.selectedEquipment.set(ot.equipment);
          this.loadWarehousesForEquipment(ot.equipment);
          this.loadMeterSnapshot(ot.equipment.id);
        }

        let tags = (ot.classificationTags ?? []) as OtClassificationTag[];
        if (!tags.length && ot.category === 'PROGRAMADA') {
          tags = ['PROGRAMADA'];
        } else if (!tags.length && ot.category === 'NO_PROGRAMADA_CORRECTIVA') {
          tags = ['NO_PROGRAMADA'];
        } else if (!tags.length && ot.category === 'NO_PROGRAMADA_REACTIVA') {
          tags = ['NO_PROGRAMADA'];
        }
        this.otForm.patchValue({
          equipmentId: ot.equipmentId,
          warehouseId: ot.warehouseId || '',
          detentionStartedAt: ot.detentionStartedAt
            ? isoToDatetimeLocalValue(ot.detentionStartedAt)
            : '',
          detentionEndedAt: ot.detentionEndedAt
            ? isoToDatetimeLocalValue(ot.detentionEndedAt)
            : '',
          detentionInitialMeter: ot.detentionInitialMeter ?? ot.initialMeter,
          detentionFinalMeter:
            ot.detentionFinalMeter ??
            ot.finalMeter ??
            '',
          mechanicAttentionStartedAt: ot.mechanicAttentionStartedAt
            ? isoToDatetimeLocalValue(ot.mechanicAttentionStartedAt)
            : '',
          mechanicAttentionEndedAt: ot.mechanicAttentionEndedAt
            ? isoToDatetimeLocalValue(ot.mechanicAttentionEndedAt)
            : '',
          clientAttributedStart: ot.clientAttributedStart
            ? isoToDatetimeLocalValue(ot.clientAttributedStart)
            : '',
          clientAttributedEnd: ot.clientAttributedEnd
            ? isoToDatetimeLocalValue(ot.clientAttributedEnd)
            : '',
          clientAttributedReason: ot.clientAttributedReason || '',
          affectsAvailability: ot.affectsAvailability || 'SI',
          classificationTags: tags,
          workLocation: ot.workLocation || 'TERRENO',
          personnelQuantity: Math.max(1, Number(ot.personnelQuantity ?? 1)),
          workShift: ot.workShift || 'DIA',
          initialRequestDescription: ot.initialRequestDescription || '',
          symptomsText: ot.symptomsText || '',
          causeText: ot.causeText || '',
          workPerformedDescription:
            ot.workPerformedDescription || ot.description || '',
          techniciansNames: ot.techniciansNames || '',
          responsibleMechanicName:
            ot.responsibleMechanicName || ot.responsible || '',
          responsibleMechanicSignature: ot.responsibleMechanicSignature || '',
          shiftSupervisorName: ot.shiftSupervisorName || '',
          shiftSupervisorSignature: ot.shiftSupervisorSignature || '',
          pmCycleNumber:
            ot.pmCycleNumber != null ? String(ot.pmCycleNumber) : '',
        });

        const sysRows = ((ot.systems ?? []) as any[])
          .map((s: any) => ({
            id: String(s.catalogItem?.id ?? s.catalogItemId ?? ''),
            label: s.catalogItem
              ? `${s.catalogItem.partNumber} — ${s.catalogItem.name}`
              : 'Ítem catálogo',
          }))
          .filter((x: { id: string }) => x.id.length > 0);
        this.pickedSystems.set(sysRows);

        this.patchFluidRows(ot.fluidCompartments);

        this.partsArray.clear();
        if (ot.parts?.length) {
          for (const p of ot.parts) {
            this.partsArray.push(
              this.fb.group({
                quantity: [
                  p.quantity,
                  [Validators.required, Validators.min(1)],
                ],
                partNumber: [p.partNumber, Validators.required],
                description: [p.description, Validators.required],
                inventoryItemId: [p.inventoryItemId || ''],
                linkedItemName: [
                  p.inventoryItem
                    ? `${p.inventoryItem.partNumber} - ${p.inventoryItem.name}`
                    : '',
                ],
              }),
            );
          }
        }

        this.backlogItems.set(
          (ot.backlogItems ?? []).map((b: any) => ({
            id: b.id,
            description: b.description,
            status: b.status,
            createdAt: b.createdAt,
          })),
        );

        if (this.mode === 'READONLY') this.otForm.disable();
      },
      error: () => {
        this.notificationService.error('OT no encontrada');
        this.router.navigate(['/app/ots']);
      },
    });
  }

  private patchFluidRows(rows: any[] | undefined) {
    if (!rows?.length) return;
    const byComp = new Map(rows.map((r) => [r.compartment, r]));
    this.compartmentRowsArray.controls.forEach((ctrl) => {
      const comp = ctrl.get('compartment')?.value as FluidCompartment;
      const hit = byComp.get(comp);
      if (hit) {
        ctrl.patchValue({
          fluidType: hit.fluidType || '',
          liters: hit.liters != null ? String(hit.liters) : '',
          action: hit.action || 'RELLENO',
          inventoryItemId: hit.inventoryItemId || '',
          linkedFluidItemName: hit.inventoryItem
            ? `${hit.inventoryItem.partNumber} — ${hit.inventoryItem.name}`
            : '',
        });
      }
    });
  }

  toggleClassification(tag: OtClassificationTag, checked: boolean) {
    const ctrl = this.otForm.get('classificationTags') as FormControl<
      OtClassificationTag[]
    >;
    const cur = new Set(ctrl.value ?? []);
    if (checked) cur.add(tag);
    else cur.delete(tag);
    ctrl.setValue([...cur]);
    ctrl.markAsTouched();
  }

  isTagChecked(tag: OtClassificationTag): boolean {
    const v = this.otForm.get('classificationTags')?.value as
      | OtClassificationTag[]
      | undefined;
    return (v ?? []).includes(tag);
  }

  fluidLabelForRow(val: unknown): string {
    const c = val as FluidCompartment;
    return FLUID_COMPARTMENT_LABELS[c] ?? String(val);
  }

  collectFluidPayload(): FluidCompartmentRowPayload[] {
    const out: FluidCompartmentRowPayload[] = [];
    for (const row of this.compartmentRowsArray.controls) {
      const raw = row.getRawValue() as {
        compartment: FluidCompartment;
        fluidType: string;
        liters: string;
        action: 'RELLENO' | 'CAMBIO';
        inventoryItemId?: string;
      };
      const linkedId = raw.inventoryItemId?.trim();
      const fluidLabel = raw.fluidType?.trim();
      if (!fluidLabel && !linkedId) continue;
      const liters = Number(String(raw.liters).replace(',', '.'));
      if (Number.isNaN(liters) || liters < 0) continue;
      const payload: FluidCompartmentRowPayload = {
        compartment: raw.compartment,
        fluidType: fluidLabel || '—',
        liters,
        action: raw.action,
      };
      if (linkedId) payload.inventoryItemId = linkedId;
      out.push(payload);
    }
    return out;
  }

  buildCreatePayload(): CreateWorkOrderExcelPayload {
    const v = this.otForm.getRawValue() as any;
    const ini = Number(v.detentionInitialMeter);
    const finRaw = v.detentionFinalMeter;
    let detentionFinalMeter: number | undefined;
    if (
      finRaw !== '' &&
      finRaw !== null &&
      finRaw !== undefined &&
      `${finRaw}`.trim() !== ''
    ) {
      const n = Number(finRaw);
      if (!Number.isNaN(n)) detentionFinalMeter = n;
    }
    const pmCycle = String(v.pmCycleNumber ?? '').trim();

    return {
      equipmentId: v.equipmentId,
      warehouseId: v.warehouseId || undefined,
      detentionStartedAt: v.detentionStartedAt
        ? new Date(v.detentionStartedAt).toISOString()
        : undefined,
      detentionEndedAt: v.detentionEndedAt
        ? new Date(v.detentionEndedAt).toISOString()
        : undefined,
      detentionInitialMeter: ini,
      detentionFinalMeter,
      mechanicAttentionStartedAt: v.mechanicAttentionStartedAt
        ? new Date(v.mechanicAttentionStartedAt).toISOString()
        : undefined,
      mechanicAttentionEndedAt: v.mechanicAttentionEndedAt
        ? new Date(v.mechanicAttentionEndedAt).toISOString()
        : undefined,
      clientAttributedStart: v.clientAttributedStart
        ? new Date(v.clientAttributedStart).toISOString()
        : undefined,
      clientAttributedEnd: v.clientAttributedEnd
        ? new Date(v.clientAttributedEnd).toISOString()
        : undefined,
      clientAttributedReason: v.clientAttributedReason?.trim() || undefined,
      affectsAvailability: v.affectsAvailability,
      classificationTags: v.classificationTags,
      workLocation: v.workLocation,
      personnelQuantity: Math.max(1, Math.trunc(Number(v.personnelQuantity ?? 1))),
      workShift: v.workShift,
      initialRequestDescription: v.initialRequestDescription?.trim() || undefined,
      systems: this.pickedSystems().map((s) => s.id),
      symptomsText: v.symptomsText?.trim() || undefined,
      causeText: v.causeText?.trim() || undefined,
      workPerformedDescription: v.workPerformedDescription?.trim() || '',
      techniciansNames: v.techniciansNames?.trim() || undefined,
      responsibleMechanicName: v.responsibleMechanicName?.trim() || '',
      responsibleMechanicSignature:
        v.responsibleMechanicSignature?.trim() || undefined,
      shiftSupervisorName: v.shiftSupervisorName?.trim() || undefined,
      shiftSupervisorSignature: v.shiftSupervisorSignature?.trim() || undefined,
      pmCycleNumber: pmCycle ? Math.min(4, Math.max(1, parseInt(pmCycle, 10))) : null,
      fluidCompartments: this.collectFluidPayload(),
      parts: this.collectPartsPayload(),
    };
  }

  private partsForCloseCheck() {
    return this.collectPartsPayload().filter((p) => p.inventoryItemId);
  }

  private collectPartsPayload(): NonNullable<
    CreateWorkOrderExcelPayload['parts']
  > {
    const rows = this.partsArray.getRawValue() as {
      partNumber: string;
      description: string;
      quantity: number;
      inventoryItemId?: string;
    }[];
    return rows.map((p) => ({
      partNumber: p.partNumber,
      description: p.description,
      quantity: Number(p.quantity),
      inventoryItemId: p.inventoryItemId || undefined,
    }));
  }

  savePrimary() {
    const tags = (this.otForm.get('classificationTags')?.value ??
      []) as OtClassificationTag[];
    if (tags.length === 0) {
      this.notificationService.error(
        'Seleccione al menos un tipo de OT (clasificación).',
      );
      return;
    }
    if (this.otForm.invalid || this.mode === 'READONLY') {
      this.otForm.markAllAsTouched();
      return;
    }
    const payload = this.buildCreatePayload();
    if (this.mode === 'CREATING') {
      this.workOrdersService.createOT(payload).subscribe({
        next: (created: any) => {
          this.notificationService.success('OT registrada.');
          const id = created?.id;
          if (id) this.router.navigate(['/app/ots', id]);
          else this.router.navigate(['/app/ots']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'No se pudo crear la OT',
          ),
      });
    } else if (this.otId) {
      this.workOrdersService.patchWorkOrder(this.otId, payload).subscribe({
        next: () =>
          this.notificationService.success('Cambios guardados.'),
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'No se pudo guardar',
          ),
      });
    }
  }

  openSystemPicker() {
    if (!this.systemsCatalogFamilyId()) {
      this.notificationService.error(
        'No hay familia de catálogo «Sistemas». Revise la jerarquía en catálogos.',
      );
      return;
    }
    this.showSystemPicker.set(true);
  }

  onSystemPickerClosed() {
    this.showSystemPicker.set(false);
  }

  onSystemPicked(row: ItemPickerRow) {
    const id = row.id;
    const label = `${row.partNumber} — ${row.name}`;
    if (this.pickedSystems().some((s) => s.id === id)) {
      this.onSystemPickerClosed();
      return;
    }
    this.pickedSystems.update((list) => [...list, { id, label }]);
    this.onSystemPickerClosed();
  }

  removePickedSystem(id: string) {
    this.pickedSystems.update((list) => list.filter((s) => s.id !== id));
  }

  closeWorkOrder() {
    if (!this.closeAllowed()) {
      this.notificationService.error(
        'Registre el inicio de detención (inicio del trabajo) antes de cerrar la OT.',
      );
      return;
    }
    if (this.otForm.invalid || !this.otId || this.mode === 'READONLY') {
      this.otForm.markAllAsTouched();
      return;
    }
    const wh = String(this.otForm.get('warehouseId')?.value ?? '').trim();
    const linked = this.partsForCloseCheck();
    if (linked.length > 0 && !wh) {
      this.notificationService.error(
        'Seleccione bodega de origen (Datos OT o pestaña Legacy) para descontar repuestos vinculados.',
      );
      this.tab.set('datos');
      return;
    }
    this.workOrdersService.updateStatus(this.otId, 'CLOSED', wh || undefined).subscribe({
      next: () => {
        this.notificationService.success('OT cerrada.');
        this.router.navigate(['/app/ots']);
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'No se pudo cerrar la OT',
        ),
    });
  }

  addBacklogRow() {
    const text = this.newBacklogText().trim();
    if (!text || !this.otId) return;
    this.workOrdersService.addBacklogItem(this.otId, text).subscribe({
      next: (item: any) => {
        this.backlogItems.update((rows) => [
          ...rows,
          {
            id: item.id,
            description: item.description,
            status: item.status,
            createdAt: item.createdAt,
          },
        ]);
        this.newBacklogText.set('');
        this.notificationService.success('Backlog agregado.');
      },
      error: () =>
        this.notificationService.error('No se pudo agregar el backlog'),
    });
  }

  toggleBacklogStatus(row: { id: string; status: 'PENDING' | 'DONE' }) {
    if (!this.otId) return;
    const next = row.status === 'DONE' ? 'PENDING' : 'DONE';
    this.workOrdersService
      .patchBacklogItem(this.otId, row.id, next)
      .subscribe({
        next: () => {
          this.backlogItems.update((list) =>
            list.map((r) =>
              r.id === row.id ? { ...r, status: next } : r,
            ),
          );
        },
        error: () =>
          this.notificationService.error('No se pudo actualizar el backlog'),
      });
  }

  /** Legacy — inventario */
  addPartRow() {
    this.partsArray.push(
      this.fb.group({
        quantity: [1, [Validators.required, Validators.min(1)]],
        partNumber: ['', Validators.required],
        description: ['', Validators.required],
        inventoryItemId: [''],
        linkedItemName: [''],
      }),
    );
  }

  removePartRow(i: number) {
    this.partsArray.removeAt(i);
  }

  openPartPicker(i: number) {
    if (!this.selectedEquipment()) {
      this.notificationService.error(
        'Seleccione el equipo en «Identificación» para cargar las bodegas del contrato.',
      );
      this.tab.set('datos');
      return;
    }
    if (this.warehouses().length === 0) {
      this.notificationService.error(
        'No hay bodegas disponibles para el contrato de este equipo. Revise la asignación del activo o contacte al administrador.',
      );
      this.tab.set('legacy');
      return;
    }
    if (!this.pickerWarehouseId()) {
      this.notificationService.error(
        'Seleccione bodega de origen en el bloque «Bodega (catálogo)» debajo de Datos OT o en la pestaña Legacy.',
      );
      this.tab.set('datos');
      return;
    }
    this.partPickerIndex.set(i);
    this.showPartPicker.set(true);
  }

  onPartPickerClosed() {
    this.showPartPicker.set(false);
    this.partPickerIndex.set(-1);
  }

  onPartPicked(row: ItemPickerRow) {
    const i = this.partPickerIndex();
    if (i >= 0) {
      const g = this.partsArray.at(i) as FormGroup;
      g.patchValue({
        partNumber: row.partNumber,
        description: row.name,
        inventoryItemId: row.id,
        linkedItemName: `${row.partNumber} - ${row.name}`,
      });
    }
    this.onPartPickerClosed();
  }

  openFluidPicker(rowIndex: number) {
    if (!this.selectedEquipment()) {
      this.notificationService.error(
        'Seleccione el equipo en «Identificación» para cargar las bodegas del contrato.',
      );
      this.tab.set('datos');
      return;
    }
    if (this.warehouses().length === 0) {
      this.notificationService.error(
        'No hay bodegas disponibles para el contrato de este equipo. Revise la asignación del activo o contacte al administrador.',
      );
      this.tab.set('legacy');
      return;
    }
    if (!this.pickerWarehouseId()) {
      this.notificationService.error(
        'Seleccione bodega de origen en el bloque «Bodega (catálogo)» debajo de Datos OT o en la pestaña Legacy.',
      );
      this.tab.set('datos');
      return;
    }
    this.fluidPickerRowIndex.set(rowIndex);
    this.showFluidPicker.set(true);
  }

  onFluidPickerClosed() {
    this.showFluidPicker.set(false);
    this.fluidPickerRowIndex.set(-1);
  }

  onFluidPicked(row: ItemPickerRow) {
    const i = this.fluidPickerRowIndex();
    if (i >= 0) {
      const g = this.compartmentRowsArray.at(i) as FormGroup;
      const curType = String(g.get('fluidType')?.value ?? '').trim();
      g.patchValue({
        fluidType: curType || row.name,
        inventoryItemId: row.id,
        linkedFluidItemName: `${row.partNumber} — ${row.name}`,
      });
    }
    this.onFluidPickerClosed();
  }

  promoteBacklog(row: { id: string; status: string }, mode: 'TO_TASK' | 'TO_NEW_OT') {
    if (!this.otId || row.status !== 'PENDING') return;
    this.workOrdersService
      .promoteBacklogItem(this.otId, row.id, mode)
      .subscribe({
        next: (res) => {
          if (mode === 'TO_NEW_OT') {
            this.notificationService.success(
              'Nueva OT generada desde el backlog.',
            );
            if (res?.newWorkOrderId) {
              this.router.navigate(['/app/ots', res.newWorkOrderId]);
            } else {
              this.router.navigate(['/app/ots']);
            }
          } else {
            this.notificationService.success(
              'Ítem promovido a tarea en esta OT.',
            );
          }
          this.backlogItems.update((list) =>
            list.map((r) =>
              r.id === row.id ? { ...r, status: 'DONE' as const } : r,
            ),
          );
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'No se pudo promover el backlog',
          ),
      });
  }

  pickerWarehouseId(): string | null {
    const v = this.otForm.get('warehouseId')?.value;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  applyKit(event: Event) {
    const kitId = (event.target as HTMLSelectElement).value;
    if (!kitId) return;
    const kit = this.pmKits().find((k) => k.id === kitId);
    if (!kit?.parts?.length) {
      this.notificationService.warning('El kit no tiene repuestos.');
      return;
    }
    this.partsArray.clear();
    kit.parts.forEach((part: any) => {
      this.partsArray.push(
        this.fb.group({
          quantity: [part.quantity, [Validators.required, Validators.min(1)]],
          partNumber: [part.partNumber, Validators.required],
          description: [part.description, Validators.required],
          inventoryItemId: [''],
          linkedItemName: [''],
        }),
      );
    });
    kit.parts.forEach((part: any, index: number) => {
      this.inventoryItemsService.searchItems(part.partNumber).subscribe({
        next: (results: any[]) => {
          const exact = results.find(
            (r) =>
              r.partNumber.toLowerCase() === part.partNumber.toLowerCase(),
          );
          if (exact) {
            const g = this.partsArray.at(index);
            g?.patchValue({
              inventoryItemId: exact.id,
              linkedItemName: `${exact.partNumber} - ${exact.name}`,
            });
          }
        },
        error: () => undefined,
      });
    });
    this.notificationService.success(`Kit ${kit.code} cargado.`);
  }

}
