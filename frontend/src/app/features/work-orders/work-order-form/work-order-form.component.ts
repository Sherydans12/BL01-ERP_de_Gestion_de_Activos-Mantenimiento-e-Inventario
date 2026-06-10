import {
  Component,
  DestroyRef,
  inject,
  signal,
  OnInit,
  computed,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormArray,
  FormControl,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import {
  WorkOrdersService,
  CreateWorkOrderExcelPayload,
  FluidCompartmentRowPayload,
  FluidCompartment,
  OtClassificationTag,
} from '../../../core/services/work-orders/work-orders.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  FaultReportsService,
  FaultReportRow,
  CRITICALITY_META,
  SYSTEM_LABELS,
} from '../../../core/services/fault-reports/fault-reports.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import {
  InventoryItemsService,
  ItemPickerRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { TenantService } from '../../../core/services/tenant/tenant.service';
import {
  FluidQuantityRowComponent,
  FluidQuantityValidation,
} from '../../../shared/components/fluid-quantity-row/fluid-quantity-row.component';
import { parseFluidQuantity, requiresLargeDispatchConfirmation } from '../../../shared/utils/fluid-dispatch-limits.util';
import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import {
  Equipment,
  EquipmentMeterSnapshot,
  MeterType,
} from '../../../core/models/types';
import { getMeterSourceLabel } from '../../../shared/utils/meter-source-label.util';
import { meterUnitLabel } from '../../../shared/utils/meter-reference-view.util';
import { MeterReferenceBannerComponent } from '../../../shared/components/meter-reference-banner/meter-reference-banner.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import {
  computePmProjection,
  pmIntervalSourceLabel,
  type PmIntervalSource,
} from '../../../core/utils/pm-interval';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import {
  CatalogService,
  type CatalogItem,
} from '../../../core/services/catalog/catalog.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { UsersService, type User } from '../../../core/services/users/users.service';
import {
  OT_KIND_OPTIONS,
  NO_PLAN_SUBTYPE_OPTIONS,
  buildClassificationTagsFromKind,
  inferOtKindFromTags,
  type OtKindOption,
  FLUID_COMPARTMENTS_ORDER,
  FLUID_COMPARTMENT_LABELS,
} from './work-order-form.constants';
import {
  HasAnyPermissionDirective,
  HasPermissionDirective,
} from '../../../shared/directives/has-permission.directive';
import {
  O,
  WORK_ORDER_FORM_EDIT_ANY,
} from '../../../core/constants/operations-permissions';

/** Umbrales alineados con `getMeterJumpLimit` en backend. */
const METER_JUMP_LIMIT_HOURS = 24;
const METER_JUMP_LIMIT_KM = 500;

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
    HasPermissionDirective,
    HasAnyPermissionDirective,
    MeterReferenceBannerComponent,
    ConfirmModalComponent,
    FluidQuantityRowComponent,
  ],
  templateUrl: './work-order-form.component.html',
  styleUrl: './work-order-form.component.scss',
})
export class WorkOrderFormComponent implements OnInit {
  protected readonly o = O;
  protected readonly workOrderFormEditAny = WORK_ORDER_FORM_EDIT_ANY;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private workOrdersService = inject(WorkOrdersService);
  private fleetService = inject(FleetService);
  private faultService = inject(FaultReportsService);
  private notificationService = inject(NotificationService);
  private warehousesService = inject(WarehousesService);
  private inventoryItemsService = inject(InventoryItemsService);
  private inventoryStockService = inject(InventoryStockService);
  private tenantService = inject(TenantService);
  private maintenanceKitsService = inject(MaintenanceKitsService);
  private equipmentMeterSnapshotService = inject(EquipmentMeterSnapshotService);
  readonly catalogService = inject(CatalogService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private readonly destroyRef = inject(DestroyRef);

  /** Diálogo nativo: `CatalogItem` categoría SYSTEM (catálogo global del tenant). */
  catalogSystemsDialog =
    viewChild<ElementRef<HTMLDialogElement>>('catalogSystemsDialog');
  closeOtDialog = viewChild<ElementRef<HTMLDialogElement>>('closeOtDialog');
  participantsDialog =
    viewChild<ElementRef<HTMLDialogElement>>('participantsDialog');
  supervisorDialog =
    viewChild<ElementRef<HTMLDialogElement>>('supervisorDialog');

  otId: string | null = null;
  mode: 'CREATING' | 'EDITING' | 'READONLY' = 'CREATING';
  currentStatus = '';

  tab = signal<'datos' | 'backlog' | 'legacy'>('datos');
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
  fluidLineValidations = signal<Record<number, FluidQuantityValidation>>({});

  blockNegativeStock = computed(
    () =>
      this.tenantService.currentTenant()?.operationalConfig
        ?.blockNegativeStock ?? false,
  );

  otKindOptions = OT_KIND_OPTIONS;
  noPlanSubtypeOptions = NO_PLAN_SUBTYPE_OPTIONS;

  readonly availabilityOptions: { v: 'SI' | 'NO'; l: string }[] = [
    { v: 'NO', l: 'Operativo' },
    { v: 'SI', l: 'Fuera de servicio' },
  ];

  assignableUsers = signal<User[]>([]);
  participantIds = signal<string[]>([]);

  pmSourceLabel(src: PmIntervalSource | undefined): string {
    return src ? pmIntervalSourceLabel(src) : '';
  }

  pickedSystems = signal<{ id: string; label: string }[]>([]);

  /** Sistemas `CatalogItem` SYSTEM activos aún no elegidos en esta OT. */
  availableCatalogSystemsForPick = computed(() => {
    const picked = new Set(this.pickedSystems().map((s) => s.id));
    return this.catalogService.systems().filter((sys) => !picked.has(sys.id));
  });

  /** Fuerza recomputación de validaciones de medidor al editar controles. */
  private meterFormTick = signal(0);

  showLargeJumpCloseModal = signal(false);

  protected readonly getMeterSourceLabel = getMeterSourceLabel;

  effectiveEquipmentCurrentMeter = computed(() => {
    const snap = this.meterSnapshot();
    if (snap) return snap.currentMeter;
    return this.selectedEquipment()?.currentMeter ?? null;
  });

  initialMeterContextHint = computed(() => {
    const lo = this.lastClosedOt();
    if (lo) {
      return `Referencia de cierre: OT ${lo.correlative}`;
    }
    const last = this.meterSnapshot()?.lastLog;
    if (last) {
      return `Vía: ${getMeterSourceLabel(last.source, {
        otCorrelative: last.otCorrelative,
      })}`;
    }
    return null;
  });

  detentionFinalMeterInvalid = computed(() => {
    this.meterFormTick();
    const fin = this.parseMeterFormValue('detentionFinalMeter');
    if (fin === null) return false;
    const ini = this.parseMeterFormValue('detentionInitialMeter');
    const cur = this.effectiveEquipmentCurrentMeter();
    if (ini !== null && fin < ini) return true;
    if (cur !== null && fin < cur) return true;
    return false;
  });

  detentionFinalNeedsJumpConfirm = computed(() => {
    this.meterFormTick();
    const fin = this.parseMeterFormValue('detentionFinalMeter');
    const cur = this.effectiveEquipmentCurrentMeter();
    if (fin === null || cur === null || fin <= cur) return false;
    const mt =
      this.meterSnapshot()?.meterType ??
      this.selectedEquipment()?.meterType ??
      MeterType.HOURS;
    const limit =
      mt === MeterType.KILOMETERS ? METER_JUMP_LIMIT_KM : METER_JUMP_LIMIT_HOURS;
    return fin - cur > limit;
  });

  largeJumpCloseModalMessage = computed(() => {
    const fin = this.parseMeterFormValue('detentionFinalMeter');
    const cur = this.effectiveEquipmentCurrentMeter();
    const mt =
      this.meterSnapshot()?.meterType ??
      this.selectedEquipment()?.meterType ??
      MeterType.HOURS;
    if (fin === null || cur === null) {
      return '¿Confirmas el medidor final antes de cerrar la OT?';
    }
    const delta = fin - cur;
    return (
      `El medidor final (${fin} ${meterUnitLabel(mt)}) supera en +${delta} ${meterUnitLabel(mt)} ` +
      `al medidor actual del equipo (${cur}). ¿Confirmas que es correcto antes de cerrar?`
    );
  });

  closeAllowed = computed(() => {
    const raw = this.otForm.get('detentionStartedAt')?.value;
    const hasDetentionStart =
      typeof raw === 'string' && raw.trim().length > 0;
    return hasDetentionStart && !this.detentionFinalMeterInvalid();
  });

  readonly isFormReadOnly = computed(() => {
    if (this.mode === 'CREATING') {
      return !this.authService.hasPermission(O.WORK_ORDER_CREATE);
    }
    if (this.mode === 'READONLY' || this.currentStatus === 'CLOSED') {
      return true;
    }
    return !this.authService.hasPermissionAny([...WORK_ORDER_FORM_EDIT_ANY]);
  });

  readonly canEditForm = computed(
    () => this.mode !== 'READONLY' && !this.isFormReadOnly(),
  );

  readonly showCloseOtButton = computed(
    () =>
      this.mode === 'EDITING' &&
      !!this.otId &&
      this.authService.hasPermission(O.WORK_ORDER_CLOSE),
  );

  readonly canCloseOt = computed(
    () =>
      this.showCloseOtButton() &&
      this.closeAllowed() &&
      this.allActiveFluidRowsValid(),
  );

  readonly canManageBacklog = computed(() =>
    this.authService.hasPermission(O.BACKLOG_MANAGE),
  );

  readonly canAssignPersonnel = computed(() =>
    this.authService.hasPermission(O.WORK_ORDER_ASSIGN),
  );

  /** Sin permiso de planificación/asignación: no editar OT en curso o en pausa. */
  formLockedForMechanic = computed(() => {
    if (
      this.currentStatus !== 'IN_PROGRESS' &&
      this.currentStatus !== 'ON_HOLD'
    ) {
      return false;
    }
    const auth = this.authService;
    if (
      auth.hasPermission(O.WORK_ORDER_UPDATE) ||
      auth.hasPermission(O.WORK_ORDER_ASSIGN)
    ) {
      return false;
    }
    const ot = this.otForm.getRawValue();
    const supervisorId = ot.shiftSupervisorUserId as string | null;
    return supervisorId !== auth.currentUser()?.id;
  });

  mechanicsForPick = computed(() =>
    this.assignableUsers().filter((u) => u.canExecuteOt !== false),
  );

  supervisorsForPick = computed(() =>
    this.assignableUsers().filter((u) => u.canSuperviseOt === true),
  );

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

  // Fallas de terreno (M3) en estado OPEN del equipo seleccionado, para avisar al planificador.
  openFaults = signal<FaultReportRow[]>([]);
  protected readonly criticalityMeta = CRITICALITY_META;
  protected readonly systemLabels = SYSTEM_LABELS;

  meterSnapshot = signal<EquipmentMeterSnapshot | null>(null);
  meterSnapshotLoading = signal(false);

  otForm: FormGroup;

  constructor() {
    /** Sin filas por defecto: el usuario agrega compartimientos solo si aplica. */
    const compartmentRows = this.fb.array([] as FormGroup[]);

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

      affectsAvailability: [
        '' as '' | 'SI' | 'NO',
        Validators.required,
      ],
      otKind: ['PROGRAMADA' as OtKindOption, Validators.required],
      noPlanSubtype: ['CORRECTIVO' as 'PREVENTIVO' | 'CORRECTIVO'],

      workLocation: ['TERRENO' as 'TALLER' | 'TERRENO'],
      personnelQuantity: [
        1,
        [Validators.required, Validators.min(1)],
      ],
      workShift: ['DIA' as 'DIA' | 'NOCHE'],

      initialRequestDescription: [''],
      symptomsText: ['', Validators.required],
      causeText: [''],
      workPerformedDescription: ['', Validators.required],

      techniciansNames: [''],
      responsibleMechanicName: ['', Validators.required],
      responsibleMechanicSignature: [''],
      shiftSupervisorName: [''],
      shiftSupervisorSignature: [''],
      shiftSupervisorUserId: [''],

      pmCycleNumber: [''],

      compartmentRows,
      parts: this.fb.array([] as FormGroup[]),
    });

    effect(() => {
      if (this.isFormReadOnly() || this.formLockedForMechanic()) {
        this.otForm.disable({ emitEvent: false });
      } else {
        this.otForm.enable({ emitEvent: false });
      }
    });
  }

  get compartmentRowsArray(): FormArray {
    return this.otForm.get('compartmentRows') as FormArray;
  }

  private buildFluidRowFormGroup(
    compartment: FluidCompartment = 'MOTOR',
  ): FormGroup {
    return this.fb.group({
      compartment: [compartment],
      fluidType: [''],
      liters: [''],
      action: ['RELLENO' as const],
      inventoryItemId: [''],
      linkedFluidItemName: [''],
      unitAbbr: ['LT'],
      allowsDecimals: [true],
      stockAvailable: [null as number | null],
      confirmedLargeDispatch: [false],
    });
  }

  addFluidCompartmentRow() {
    this.compartmentRowsArray.push(this.buildFluidRowFormGroup('OTROS'));
  }

  removeFluidCompartmentRow(index: number) {
    this.compartmentRowsArray.removeAt(index);
  }

  get partsArray(): FormArray {
    return this.otForm.get('parts') as FormArray;
  }

  /** Misma referencia para duplicar el `<select>` de bodega (Datos OT, fluidos y repuestos). */
  get warehouseIdControl(): FormControl<string | null> {
    return this.otForm.get('warehouseId') as FormControl<string | null>;
  }

  ngOnInit(): void {
    this.catalogService.loadCatalogs().subscribe({
      error: () => undefined,
    });

    this.usersService.getAssignableForOt().subscribe({
      next: (list) => this.assignableUsers.set(list),
      error: () => this.assignableUsers.set([]),
    });

    const cu = this.authService.currentUser();
    if (cu?.name) {
      queueMicrotask(() => {
        if (!this.otId) {
          this.otForm.patchValue({
            responsibleMechanicName: cu.name ?? '',
          });
        }
      });
    }

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
        this.loadOpenFaults(eq.id);
      } else {
        this.warehouses.set([]);
        this.lastClosedOt.set(null);
        this.meterSnapshot.set(null);
        this.openFaults.set([]);
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

    this.otForm
      .get('detentionInitialMeter')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.meterFormTick.update((n) => n + 1));
    this.otForm
      .get('detentionFinalMeter')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.meterFormTick.update((n) => n + 1));
  }

  private parseMeterFormValue(controlName: string): number | null {
    const raw = this.otForm.get(controlName)?.value;
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  detentionMeterInputNgClass(controlName: 'detentionInitialMeter' | 'detentionFinalMeter'): Record<string, boolean> {
    if (controlName !== 'detentionFinalMeter') {
      return {};
    }
    const invalid = this.detentionFinalMeterInvalid();
    const jump = this.detentionFinalNeedsJumpConfirm();
    return {
      'border-error text-error': invalid,
      'border-amber-500': jump && !invalid,
    };
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

  /** Fallas de terreno (M3) en estado OPEN del equipo: avisa al planificador qué reportes esperan OT. */
  private loadOpenFaults(equipmentId: string) {
    this.faultService
      .getReports({ equipmentId, status: 'OPEN', pageSize: 5 })
      .subscribe({
        next: (res) => this.openFaults.set(res.data ?? []),
        error: () => this.openFaults.set([]),
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
          tags = ['NO_PROGRAMADA', 'NP_CORRECTIVO'];
        } else if (!tags.length && ot.category === 'NO_PROGRAMADA_REACTIVA') {
          tags = ['NO_PROGRAMADA', 'NP_CORRECTIVO'];
        } else if (!tags.length && ot.category === 'NO_PROGRAMADA_PREVENTIVO') {
          tags = ['NO_PROGRAMADA', 'NP_PREVENTIVO'];
        }
        const inferred = inferOtKindFromTags(
          tags.length ? tags : ['PROGRAMADA'],
        );

        let aff = ot.affectsAvailability ?? '';
        if (aff === 'STP') aff = 'NO';

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
          affectsAvailability: aff,
          otKind: inferred.kind,
          noPlanSubtype: inferred.noPlanSubtype,
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
          shiftSupervisorUserId: ot.shiftSupervisorUserId || '',
          pmCycleNumber:
            ot.pmCycleNumber != null ? String(ot.pmCycleNumber) : '',
        });

        const sysRows = ((ot.systems ?? []) as any[])
          .map((s: any) => ({
            id: String(s.catalogItem?.id ?? s.catalogItemId ?? ''),
            label: s.catalogItem
              ? `${s.catalogItem.code ?? s.catalogItem.partNumber ?? ''} — ${s.catalogItem.name}`
              : 'Ítem catálogo',
          }))
          .filter((x: { id: string }) => x.id.length > 0);
        this.pickedSystems.set(sysRows);

        this.participantIds.set(
          Array.isArray(ot.participantUserIds)
            ? ot.participantUserIds.map(String)
            : [],
        );

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
                partNumber: [p.partNumber],
                description: [p.description],
                inventoryItemId: [
                  p.inventoryItemId || '',
                  Validators.required,
                ],
                linkedItemName: [
                  p.inventoryItem
                    ? `${p.inventoryItem.partNumber} — ${p.inventoryItem.name}`
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

        if (this.formLockedForMechanic()) {
          this.notificationService.warning(
            'OT en curso o en pausa: solo quien supervise la OT o tenga permiso de planificación puede modificar el formulario.',
          );
        }
      },
      error: () => {
        this.notificationService.error('OT no encontrada');
        this.router.navigate(['/app/ots']);
      },
    });
  }

  private patchFluidRows(rows: any[] | undefined) {
    this.compartmentRowsArray.clear();
    if (!rows?.length) {
      return;
    }
    for (const hit of rows) {
      const g = this.buildFluidRowFormGroup(hit.compartment as FluidCompartment);
      g.patchValue({
        fluidType: hit.fluidType || '',
        liters: hit.liters != null ? String(hit.liters) : '',
        action: hit.action || 'RELLENO',
        inventoryItemId: hit.inventoryItemId || '',
        linkedFluidItemName: hit.inventoryItem
          ? `${hit.inventoryItem.partNumber} — ${hit.inventoryItem.name}`
          : '',
        unitAbbr: hit.inventoryItem?.unitOfMeasure?.abbreviation ?? 'LT',
        allowsDecimals:
          hit.inventoryItem?.unitOfMeasure?.allowsDecimals ?? true,
      });
      this.compartmentRowsArray.push(g);
    }
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
      if (!linkedId) continue;
      const liters = Number(String(raw.liters).replace(',', '.'));
      if (Number.isNaN(liters) || liters <= 0) continue;
      const fluidLabel =
        raw.fluidType?.trim() ||
        (raw as { linkedFluidItemName?: string }).linkedFluidItemName?.trim() ||
        '—';
      out.push({
        compartment: raw.compartment,
        fluidType: fluidLabel,
        liters,
        action: raw.action,
        inventoryItemId: linkedId,
      });
    }
    return out;
  }

  /** Fila en blanco = sin ítem y sin litros válidos; mezcla parcial = error antes de guardar. */
  validateFluidCompartmentRows(): string | null {
    for (let i = 0; i < this.compartmentRowsArray.length; i++) {
      const raw = this.compartmentRowsArray.at(i).getRawValue() as {
        inventoryItemId?: string;
        liters?: string;
      };
      const id = raw.inventoryItemId?.trim() ?? '';
      const liters = Number(String(raw.liters ?? '').replace(',', '.'));
      const hasLiters = !Number.isNaN(liters) && liters > 0;
      if (!id && !hasLiters) continue;
      if (!id) {
        return `Fluidos por compartimiento (fila ${i + 1}): elija un ítem del catálogo de inventario.`;
      }
      if (!hasLiters) {
        return `Fluidos por compartimiento (fila ${i + 1}): indique cantidad consumida (> 0) en la unidad del artículo.`;
      }
    }
    return null;
  }

  allActiveFluidRowsValid(): boolean {
    const vals = this.fluidLineValidations();
    for (let i = 0; i < this.compartmentRowsArray.length; i++) {
      const raw = this.compartmentRowsArray.at(i).getRawValue() as {
        inventoryItemId?: string;
        liters?: string;
        allowsDecimals?: boolean;
      };
      const id = raw.inventoryItemId?.trim() ?? '';
      const allowsDecimals = raw.allowsDecimals ?? true;
      const liters = parseFluidQuantity(raw.liters, allowsDecimals);
      if (!id && liters <= 0) continue;
      if (id && liters > 0 && vals[i]?.valid !== true) return false;
    }
    return true;
  }

  fluidsNeedLargeConfirmAtClose(): boolean {
    for (const row of this.compartmentRowsArray.controls) {
      const raw = row.getRawValue() as {
        inventoryItemId?: string;
        liters?: string;
        unitAbbr?: string;
        allowsDecimals?: boolean;
      };
      if (!raw.inventoryItemId?.trim()) continue;
      const qty = parseFluidQuantity(
        raw.liters,
        raw.allowsDecimals ?? true,
      );
      if (
        requiresLargeDispatchConfirmation(
          qty,
          raw.unitAbbr ?? 'LT',
          raw.allowsDecimals ?? true,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  fluidsLargeConfirmOkAtClose(): boolean {
    for (let i = 0; i < this.compartmentRowsArray.length; i++) {
      const raw = this.compartmentRowsArray.at(i).getRawValue() as {
        inventoryItemId?: string;
        liters?: string;
        unitAbbr?: string;
        allowsDecimals?: boolean;
        confirmedLargeDispatch?: boolean;
      };
      if (!raw.inventoryItemId?.trim()) continue;
      const qty = parseFluidQuantity(
        raw.liters,
        raw.allowsDecimals ?? true,
      );
      if (
        requiresLargeDispatchConfirmation(
          qty,
          raw.unitAbbr ?? 'LT',
          raw.allowsDecimals ?? true,
        ) &&
        !raw.confirmedLargeDispatch
      ) {
        return false;
      }
    }
    return true;
  }

  onFluidLineValidation(index: number, validation: FluidQuantityValidation): void {
    this.fluidLineValidations.update((prev) => ({ ...prev, [index]: validation }));
  }

  onFluidLargeConfirm(index: number, confirmed: boolean): void {
    const g = this.compartmentRowsArray.at(index) as FormGroup;
    g.patchValue({ confirmedLargeDispatch: confirmed });
  }

  fluidLitersControl(row: AbstractControl): FormControl<string | number | null> {
    return row.get('liters') as FormControl<string | number | null>;
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
      affectsAvailability: v.affectsAvailability as 'SI' | 'NO',
      classificationTags: buildClassificationTagsFromKind(
        v.otKind as OtKindOption,
        v.noPlanSubtype as 'PREVENTIVO' | 'CORRECTIVO',
      ),
      workLocation: v.workLocation,
      personnelQuantity: Math.max(1, Math.trunc(Number(v.personnelQuantity ?? 1))),
      workShift: v.workShift,
      initialRequestDescription: v.initialRequestDescription?.trim() || undefined,
      systems: this.pickedSystems().map((s) => s.id),
      symptomsText: v.symptomsText?.trim() || undefined,
      causeText: v.causeText?.trim() || undefined,
      workPerformedDescription: v.workPerformedDescription?.trim() || '',
      techniciansNames:
        this.participantIds()
          .map(
            (pid) =>
              this.assignableUsers().find((u) => u.id === pid)?.name ?? '',
          )
          .filter(Boolean)
          .join(', ') ||
        v.techniciansNames?.trim() ||
        undefined,
      responsibleMechanicName: v.responsibleMechanicName?.trim() || '',
      responsibleMechanicSignature:
        v.responsibleMechanicSignature?.trim() || undefined,
      shiftSupervisorName: v.shiftSupervisorName?.trim() || undefined,
      shiftSupervisorSignature: v.shiftSupervisorSignature?.trim() || undefined,
      participantUserIds:
        this.participantIds().length > 0 ? this.participantIds() : undefined,
      shiftSupervisorUserId: v.shiftSupervisorUserId?.trim() || undefined,
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
    return rows
      .filter((p) => (p.inventoryItemId ?? '').toString().trim().length > 0)
      .map((p) => ({
        partNumber: (p.partNumber ?? '').trim(),
        description: (p.description ?? '').trim(),
        quantity: Number(p.quantity),
        inventoryItemId: String(p.inventoryItemId).trim(),
      }));
  }

  savePrimary() {
    const aff = this.otForm.get('affectsAvailability')?.value;
    if (aff !== 'SI' && aff !== 'NO') {
      this.notificationService.error(
        'Indique si el equipo queda operativo o fuera de servicio.',
      );
      this.otForm.get('affectsAvailability')?.markAsTouched();
      return;
    }
    if (this.pickedSystems().length === 0) {
      this.notificationService.error(
        'Seleccione al menos un sistema intervenido.',
      );
      return;
    }
    const fluidErr = this.validateFluidCompartmentRows();
    if (fluidErr) {
      this.notificationService.error(fluidErr);
      return;
    }
    if (!this.allActiveFluidRowsValid()) {
      this.notificationService.error(
        'Revise las cantidades de fluidos (stock, formato o confirmación de consumo inusual).',
      );
      return;
    }
    if (this.otForm.invalid || this.isFormReadOnly()) {
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
    const show = () => {
      const dlg = this.catalogSystemsDialog()?.nativeElement;
      if (!dlg) return;
      const n = this.catalogService.systems().length;
      if (n === 0) {
        this.notificationService.warning(
          'No hay sistemas disponibles en el catálogo de la empresa. Consulte con administración.',
        );
        return;
      }
      dlg.showModal();
    };

    if (!this.catalogService.getAllCatalogs()().length) {
      this.catalogService.loadCatalogs().subscribe({
        next: () => queueMicrotask(show),
        error: () =>
          this.notificationService.error(
            'No se pudo cargar el catálogo de sistemas.',
          ),
      });
    } else {
      queueMicrotask(show);
    }
  }

  closeCatalogSystemsDialog() {
    this.catalogSystemsDialog()?.nativeElement.close();
  }

  onCatalogSystemsDialogBackdrop(ev: MouseEvent) {
    if (ev.target === ev.currentTarget) {
      this.closeCatalogSystemsDialog();
    }
  }

  pickCatalogSystem(item: CatalogItem) {
    const id = item.id;
    if (this.pickedSystems().some((s) => s.id === id)) {
      this.closeCatalogSystemsDialog();
      return;
    }
    const label = `${item.code} — ${item.name}`;
    this.pickedSystems.update((list) => [...list, { id, label }]);
    this.closeCatalogSystemsDialog();
  }

  removePickedSystem(id: string) {
    this.pickedSystems.update((list) => list.filter((s) => s.id !== id));
  }

  openCloseOperationalDialog() {
    if (!this.otForm.get('detentionStartedAt')?.value?.toString().trim()) {
      this.notificationService.error(
        'Registre el inicio de detención (inicio del trabajo) antes de cerrar la OT.',
      );
      return;
    }
    if (this.detentionFinalMeterInvalid()) {
      this.notificationService.error(
        'El medidor final no puede ser menor al inicial de la OT ni al medidor actual del equipo.',
      );
      return;
    }
    if (!this.otId || this.isFormReadOnly()) return;
    if (this.detentionFinalNeedsJumpConfirm()) {
      this.showLargeJumpCloseModal.set(true);
      return;
    }
    this.closeOtDialog()?.nativeElement.showModal();
  }

  onLargeJumpCloseConfirmed() {
    this.showLargeJumpCloseModal.set(false);
    this.closeOtDialog()?.nativeElement.showModal();
  }

  onLargeJumpCloseCancelled() {
    this.showLargeJumpCloseModal.set(false);
  }

  closeCloseOperationalDialog() {
    this.closeOtDialog()?.nativeElement.close();
  }

  closeWorkOrderAfterOperationalAnswer(equipmentOperational: boolean) {
    this.closeCloseOperationalDialog();
    const wh = String(this.otForm.get('warehouseId')?.value ?? '').trim();
    const linked = this.partsForCloseCheck();
    if (linked.length > 0 && !wh) {
      this.notificationService.error(
        'Seleccione la bodega de consumo en Identificación (Datos OT) para descontar repuestos vinculados al cerrar.',
      );
      this.tab.set('datos');
      return;
    }
    if (!this.otId) return;
    if (this.detentionFinalMeterInvalid()) {
      this.notificationService.error(
        'Corrija el medidor final antes de cerrar la OT.',
      );
      return;
    }
    if (!this.allActiveFluidRowsValid()) {
      this.notificationService.error(
        'Revise las cantidades de fluidos antes de cerrar la OT.',
      );
      return;
    }
    if (
      this.fluidsNeedLargeConfirmAtClose() &&
      !this.fluidsLargeConfirmOkAtClose()
    ) {
      this.notificationService.error(
        'Confirme las cantidades inusuales de fluidos antes de cerrar la OT.',
      );
      return;
    }
    const confirmedLargeJump = this.detentionFinalNeedsJumpConfirm();
    const confirmedLargeFluidDispatch = this.fluidsNeedLargeConfirmAtClose();
    const payload = this.buildCreatePayload();
    this.workOrdersService
      .patchWorkOrder(this.otId, payload)
      .pipe(
        switchMap(() =>
          this.workOrdersService.updateStatus(
            this.otId!,
            'CLOSED',
            wh || undefined,
            equipmentOperational,
            confirmedLargeJump,
            confirmedLargeFluidDispatch === true,
          ),
        ),
      )
      .subscribe({
        next: () => {
          const equipmentId = String(
            this.otForm.get('equipmentId')?.value ?? '',
          ).trim();
          if (equipmentId) {
            this.fleetService.notifyEquipmentChanged(equipmentId);
          }
          this.notificationService.success('OT cerrada.');
          this.router.navigate(['/app/ots']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'No se pudo cerrar la OT',
          ),
      });
  }

  toggleParticipantUser(uid: string, checked: boolean) {
    this.participantIds.update((ids) => {
      const s = new Set(ids);
      if (checked) s.add(uid);
      else s.delete(uid);
      return [...s];
    });
  }

  participantChecked(uid: string): boolean {
    return this.participantIds().includes(uid);
  }

  openParticipantsModal() {
    if (this.assignableUsers().length === 0) {
      this.usersService.getAssignableForOt().subscribe({
        next: (list) => {
          this.assignableUsers.set(list);
          queueMicrotask(() =>
            this.participantsDialog()?.nativeElement.showModal(),
          );
        },
        error: () =>
          this.notificationService.error('No se pudo cargar el listado de usuarios.'),
      });
      return;
    }
    this.participantsDialog()?.nativeElement.showModal();
  }

  closeParticipantsModal() {
    this.participantsDialog()?.nativeElement.close();
  }

  openSupervisorModal() {
    if (this.assignableUsers().length === 0) {
      this.usersService.getAssignableForOt().subscribe({
        next: (list) => {
          this.assignableUsers.set(list);
          queueMicrotask(() =>
            this.supervisorDialog()?.nativeElement.showModal(),
          );
        },
        error: () =>
          this.notificationService.error('No se pudo cargar el listado de usuarios.'),
      });
      return;
    }
    this.supervisorDialog()?.nativeElement.showModal();
  }

  closeSupervisorModal() {
    this.supervisorDialog()?.nativeElement.close();
  }

  pickSupervisor(u: User) {
    this.otForm.patchValue({
      shiftSupervisorUserId: u.id,
      shiftSupervisorName: u.name,
    });
    this.closeSupervisorModal();
  }

  supervisorLabel(): string {
    const id = String(
      this.otForm.get('shiftSupervisorUserId')?.value ?? '',
    ).trim();
    if (!id) return '';
    const u = this.assignableUsers().find((x) => x.id === id);
    return u ? `${u.name}` : id;
  }

  participantDisplayName(uid: string): string {
    const u = this.assignableUsers().find((x) => x.id === uid);
    return u?.name ?? uid;
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

  /** Pestaña repuestos: solo ítems del inventario (picker «Buscar»). */
  addPartRow() {
    this.partsArray.push(
      this.fb.group({
        quantity: [1, [Validators.required, Validators.min(1)]],
        partNumber: [''],
        description: [''],
        inventoryItemId: ['', Validators.required],
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
        'Seleccione la bodega de consumo al inicio del formulario (sección Identificación, en «Datos OT»).',
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
      const pnOrSku =
        (row.partNumber ?? '').trim() ||
        (row.inventoryCode ?? '').trim() ||
        '';
      g.patchValue({
        partNumber: pnOrSku,
        description: row.name,
        inventoryItemId: row.id,
        linkedItemName: pnOrSku ? `${pnOrSku} — ${row.name}` : row.name,
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
        'Seleccione la bodega de consumo al inicio del formulario (sección Identificación, en «Datos OT»).',
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
      const pnOrSku =
        (row.partNumber ?? '').trim() ||
        (row.inventoryCode ?? '').trim() ||
        '';
      const label = (pnOrSku ? `${pnOrSku} — ${row.name}` : row.name).slice(
        0,
        200,
      );
      g.patchValue({
        fluidType: label,
        inventoryItemId: row.id,
        linkedFluidItemName: pnOrSku ? `${pnOrSku} — ${row.name}` : row.name,
        unitAbbr: row.unitOfMeasure?.abbreviation ?? 'LT',
        allowsDecimals: row.unitOfMeasure?.allowsDecimals ?? true,
        stockAvailable:
          row.stockAvailableQuantity ?? row.stockQuantity ?? null,
        confirmedLargeDispatch: false,
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

  /** Solo lectura: bodega elegida una vez al inicio (fluidos / repuestos / cierre). */
  consumptionWarehouseLabel(): string {
    const id = this.pickerWarehouseId();
    if (!id) return '— sin bodega —';
    const wh = this.warehouses().find((w: { id: string }) => w.id === id);
    if (wh) return `${wh.code} — ${wh.name}`;
    return id;
  }

  /**
   * Stock disponible (físico − reservado) del ítem en la bodega de consumo (Sprint 2.3).
   * `null` si no hay bodega seleccionada o el ítem no figura en el stock de esa bodega.
   */
  stockForItem(itemId: string | null | undefined): number | null {
    if (!itemId || !this.pickerWarehouseId()) return null;
    const row = this.warehouseStocks().find(
      (s: { itemId?: string }) => s.itemId === itemId,
    );
    if (!row) return null;
    const avail = (row as { availableQuantity?: number; quantity?: number })
      .availableQuantity;
    const qty =
      avail != null
        ? avail
        : ((row as { quantity?: number }).quantity ?? 0);
    return Number(qty) || 0;
  }

  /** True si la línea tiene ítem vinculado y la cantidad pedida supera el stock disponible. */
  partRowHasShortage(ctrl: AbstractControl): boolean {
    const itemId = ctrl.get('inventoryItemId')?.value as string | null;
    if (!itemId) return false;
    const available = this.stockForItem(itemId);
    if (available == null) return false;
    const requested = Number(ctrl.get('quantity')?.value) || 0;
    return requested > available;
  }

  /** True si alguna línea de repuesto vinculada no tiene stock suficiente en la bodega. */
  anyPartStockShortage(): boolean {
    return this.partsArray.controls.some((c) => this.partRowHasShortage(c));
  }

  applyKit(event: Event) {
    const el = event.target as HTMLSelectElement;
    const kitId = el.value;
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
          partNumber: [part.partNumber],
          description: [part.description],
          inventoryItemId: ['', Validators.required],
          linkedItemName: [''],
        }),
      );
    });
    type KitSearchHit = {
      part: { partNumber: string };
      results: { partNumber: string; id: string; name: string }[];
    };

    forkJoin(
      kit.parts.map((part: { partNumber: string; quantity: number; description: string }) =>
        this.inventoryItemsService.searchItems(part.partNumber).pipe(
          map((results) => ({
            part,
            results: results as { partNumber: string; id: string; name: string }[],
          })),
        ),
      ),
    ).subscribe({
      next: (hits) => {
        const rows = hits as KitSearchHit[];
        let unlinked = 0;
        rows.forEach((hit, index: number) => {
          const exact = hit.results.find(
            (r: { partNumber: string }) =>
              r.partNumber.toLowerCase() ===
              String(hit.part.partNumber).toLowerCase(),
          );
          const g = this.partsArray.at(index);
          if (exact && g) {
            g.patchValue({
              partNumber: exact.partNumber,
              description: exact.name,
              inventoryItemId: exact.id,
              linkedItemName: `${exact.partNumber} — ${exact.name}`,
            });
          } else {
            unlinked++;
          }
        });
        this.notificationService.success(`Kit ${kit.code} cargado.`);
        if (unlinked > 0) {
          this.notificationService.warning(
            `${unlinked} línea(s) del kit no tienen coincidencia exacta en inventario: use «Buscar» en cada una antes de guardar.`,
          );
        }
      },
      error: () =>
        this.notificationService.error(
          'No se pudo resolver el kit contra el inventario.',
        ),
    });
    el.value = '';
  }

}
