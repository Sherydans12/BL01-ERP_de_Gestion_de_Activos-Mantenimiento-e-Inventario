import {
  Component,
  signal,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PurchasesService } from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import {
  InventoryItemsService,
  ItemPickerRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { GLOBAL_ITEM_PICKER_CATALOG } from '../../../shared/components/global-item-picker/global-item-picker.catalog';
import { Contract, Equipment } from '../../../core/models/types';
import {
  HasAnyPermissionDirective,
  HasPermissionDirective,
} from '../../../shared/directives/has-permission.directive';
import { P, REQUISITION_EDIT_ANY } from '../../../core/constants/purchases-permissions';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

export type RequisitionFormItemRow = {
  id?: string;
  inventoryItemId?: string | null;
  inventoryItemName?: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  estimatedCost: number | null;
  partNumber: string;
  itemNotes: string;
};

@Component({
  selector: 'app-requisition-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    GlobalItemPickerComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective,
  ],
  templateUrl: './requisition-form.component.html',
})
export class RequisitionFormComponent implements OnInit {
  protected readonly p = P;
  protected readonly requisitionEditPerms = [...REQUISITION_EDIT_ANY];

  private platformId = inject(PLATFORM_ID);
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private contractsService = inject(ContractsService);
  private fleetService = inject(FleetService);
  private workOrdersService = inject(WorkOrdersService);
  private inventoryItemsService = inject(InventoryItemsService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /** Misma configuración base que control de stock (`GLOBAL_ITEM_PICKER_CATALOG`). */
  readonly itemPickerCatalog = GLOBAL_ITEM_PICKER_CATALOG;

  readonly UOM_PRESETS = [
    { value: 'UN', label: 'UN - Unidad' },
    { value: 'KG', label: 'KG - Kilogramo' },
    { value: 'L', label: 'L - Litro' },
    { value: 'M', label: 'M - Metro' },
    { value: 'M2', label: 'M\u00B2 - Metro cuadrado' },
    { value: 'M3', label: 'M\u00B3 - Metro c\u00FAbico' },
    { value: 'GL', label: 'GL - Global' },
    { value: 'SET', label: 'SET - Conjunto' },
    { value: 'HR', label: 'HR - Hora' },
    { value: 'DIA', label: 'D\u00CDA - D\u00EDa' },
  ];

  /** Presente solo en ruta `.../requerimientos/:id/edit` */
  editId = signal<string | null>(null);

  isSaving = signal(false);
  isLoadingContracts = signal(true);
  isLoadingRequisition = signal(false);
  isLoadingEquipments = signal(false);
  isLoadingWorkOrders = signal(false);
  /** Solo al resolver equipo vía GET /work-orders/:id si la OT no estaba en la página cargada. */
  isFetchingOtDetail = signal(false);
  contracts = signal<Contract[]>([]);
  selectedContractId = signal('');
  selectedSubcontractId = signal('');
  /** Vínculo opcional a OT / equipo (mismo contrato que el requerimiento). */
  selectedWorkOrderId = signal('');
  selectedEquipmentId = signal('');
  equipments = signal<Equipment[]>([]);
  workOrders = signal<
    Array<{
      id: string;
      correlative: string;
      description: string;
      equipmentId: string;
    }>
  >([]);
  description = signal('');
  justification = signal('');
  priority = signal<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  items = signal<RequisitionFormItemRow[]>([
    {
      description: '',
      quantity: 1,
      unitOfMeasure: 'UN',
      estimatedCost: null,
      partNumber: '',
      itemNotes: '',
    },
  ]);

  showItemPicker = signal(false);
  pickerRowIndex = signal<number | null>(null);

  isEditMode = computed(() => !!this.editId());

  readonly isFormReadOnly = computed(() =>
    this.isEditMode()
      ? !this.authService.hasPermissionAny([...REQUISITION_EDIT_ANY])
      : !this.authService.hasPermission(P.REQUISITION_CREATE),
  );

  pageLoading = computed(
    () => this.isLoadingContracts() || this.isLoadingRequisition(),
  );

  availableSubcontracts = computed(() => {
    const cid = this.selectedContractId();
    if (!cid) return [];
    const contract = this.contracts().find((c) => c.id === cid);
    return contract?.subcontracts?.filter((s) => s.isActive) || [];
  });

  /** Con OT elegida, el equipo se infiere de la OT y no debe editarse a mano. */
  equipmentLocked = computed(() => !!this.selectedWorkOrderId().trim());

  ngOnInit() {
    this.editId.set(this.route.snapshot.paramMap.get('id'));

    this.contractsService.findAll().subscribe({
      next: (all) => {
        const user = this.authService.currentUser();
        let list = all;
        if (user) {
          const seeAll =
            user.role === 'SUPER_ADMIN' ||
            user.role === 'ADMIN' ||
            user.allowedContracts?.includes('ALL');
          if (!seeAll) {
            list = all.filter((c) => user.allowedContracts?.includes(c.id));
          }
        }
        list = list.filter(
          (c) =>
            c.isActive !== false &&
            c.id !== 'none' &&
            c.id !== 'err',
        );
        this.contracts.set(list);

        const cid = this.authService.currentContractId();
        if (
          cid &&
          cid !== 'ALL' &&
          isUuid(cid) &&
          list.some((c) => c.id === cid)
        ) {
          this.selectedContractId.set(cid);
        } else if (list.length === 1) {
          this.selectedContractId.set(list[0].id);
        }

        this.isLoadingContracts.set(false);

        const eid = this.editId();
        if (eid) {
          this.loadRequisitionForEdit(eid);
        } else {
          this.applySupplyPrefillFromSession();
          const sel = this.selectedContractId();
          if (sel && isUuid(sel)) {
            this.loadAssetsForContract(sel);
          }
        }
      },
      error: () => {
        this.notify.error('Error al cargar contratos');
        this.isLoadingContracts.set(false);
      },
    });
  }

  /** Prefill desde Centro de abastecimiento (sessionStorage, una sola lectura). */
  private applySupplyPrefillFromSession() {
    if (!isPlatformBrowser(this.platformId)) return;
    const raw = sessionStorage.getItem('requisitionSupplyPrefill');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as RequisitionFormItemRow[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.items.set(parsed);
        this.description.set(
          'Requerimiento masivo generado desde el Centro de alertas de abastecimiento (sugerencia mínimo + cobertura ~30 días según consumo).',
        );
      }
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem('requisitionSupplyPrefill');
  }

  private loadRequisitionForEdit(id: string) {
    this.isLoadingRequisition.set(true);
    this.purchasesService.getRequisition(id).subscribe({
      next: (req) => {
        if (
          req.status !== 'DRAFT' &&
          req.status !== 'QUOTING' &&
          req.status !== 'PENDING_APPROVAL'
        ) {
          this.notify.warning(
            'Solo se pueden editar requerimientos en borrador, en cotización o pendientes de generar OC',
          );
          this.router.navigate(['/app/compras/requerimientos', id]);
          this.isLoadingRequisition.set(false);
          return;
        }

        const u = this.authService.currentUser();
        if (!u) {
          this.router.navigate(['/auth/login']);
          return;
        }

        if (req.status === 'DRAFT') {
          const ok =
            req.requestedById === u.id ||
            u.role === 'ADMIN' ||
            u.role === 'SUPER_ADMIN';
          if (!ok) {
            this.notify.error('No tiene permiso para editar este requerimiento');
            this.router.navigate(['/app/compras/requerimientos', id]);
            this.isLoadingRequisition.set(false);
            return;
          }
        } else {
          const ok = this.authService.hasPermission(
            P.REQUISITION_UPDATE_PURCHASING,
          );
          if (!ok) {
            this.notify.error(
              'Solo compras puede editar en cotización o antes de generar la orden de compra',
            );
            this.router.navigate(['/app/compras/requerimientos', id]);
            this.isLoadingRequisition.set(false);
            return;
          }
        }

        this.description.set(req.description);
        this.justification.set(req.justification || '');
        const pr = req.priority;
        this.priority.set(
          pr === 'LOW' || pr === 'HIGH' || pr === 'MEDIUM' ? pr : 'MEDIUM',
        );
        this.selectedContractId.set(req.contractId);
        this.selectedSubcontractId.set(req.subcontractId || '');
        this.loadAssetsForContract(req.contractId, () => {
          this.selectedWorkOrderId.set(req.workOrderId || '');
          this.selectedEquipmentId.set(req.equipmentId || '');
          this.items.set(
            req.items.map((i: any) => ({
              id: i.id,
              inventoryItemId: i.inventoryItemId || null,
              inventoryItemName: i.inventoryItem?.name || undefined,
              description: i.description,
              quantity: i.quantity,
              unitOfMeasure: i.unitOfMeasure,
              estimatedCost: i.estimatedCost ?? null,
              partNumber: i.partNumber?.trim() || '',
              itemNotes: i.itemNotes?.trim() || '',
            })),
          );
          this.isLoadingRequisition.set(false);
        });
      },
      error: () => {
        this.notify.error('Error al cargar requerimiento');
        this.isLoadingRequisition.set(false);
        this.router.navigate(['/app/compras/requerimientos']);
      },
    });
  }

  onContractChange(value: string) {
    this.selectedContractId.set(value);
    this.selectedSubcontractId.set('');
    this.selectedWorkOrderId.set('');
    this.selectedEquipmentId.set('');
    this.loadAssetsForContract(value);
  }

  private loadAssetsForContract(contractId: string, after?: () => void) {
    if (!contractId || !isUuid(contractId)) {
      this.equipments.set([]);
      this.workOrders.set([]);
      after?.();
      return;
    }
    this.isLoadingEquipments.set(true);
    this.isLoadingWorkOrders.set(true);
    forkJoin({
      eq: this.fleetService.getEquipments(
        { page: 1, limit: 500 },
        { contractId },
      ),
      wo: this.workOrdersService.getWorkOrdersForContract(contractId, {
        page: 1,
        limit: 300,
      }),
    }).subscribe({
      next: ({ eq, wo }) => {
        this.equipments.set(eq.data);
        this.workOrders.set(
          wo.data.map((w: any) => ({
            id: w.id as string,
            correlative: w.correlative as string,
            description: String(w.description ?? ''),
            equipmentId: w.equipmentId as string,
          })),
        );
        this.isLoadingEquipments.set(false);
        this.isLoadingWorkOrders.set(false);
        after?.();
      },
      error: () => {
        this.equipments.set([]);
        this.workOrders.set([]);
        this.isLoadingEquipments.set(false);
        this.isLoadingWorkOrders.set(false);
        this.notify.error(
          'Error al cargar equipos u órdenes de trabajo para el contrato',
        );
        after?.();
      },
    });
  }

  onWorkOrderChange(value: string) {
    const v = (value || '').trim();
    this.selectedWorkOrderId.set(v);
    if (!v) {
      this.selectedEquipmentId.set('');
      return;
    }
    const wo = this.workOrders().find((w) => w.id === v);
    if (wo?.equipmentId) {
      this.selectedEquipmentId.set(wo.equipmentId);
      return;
    }
    this.isFetchingOtDetail.set(true);
    this.workOrdersService.getWorkOrder(v).subscribe({
      next: (raw: { equipmentId?: string }) => {
        if (raw?.equipmentId) {
          this.selectedEquipmentId.set(raw.equipmentId);
        }
        this.isFetchingOtDetail.set(false);
      },
      error: () => {
        this.notify.error('No se pudo obtener la orden de trabajo');
        this.isFetchingOtDetail.set(false);
      },
    });
  }

  onEquipmentChange(value: string) {
    if (this.equipmentLocked()) {
      return;
    }
    this.selectedEquipmentId.set((value || '').trim());
  }

  equipmentLabel(e: Equipment): string {
    const label = [e.brand, e.model].filter(Boolean).join(' ').trim();
    return label ? `${e.internalId} — ${label}` : e.internalId;
  }

  workOrderLabel(wo: {
    correlative: string;
    description: string;
  }): string {
    const d = wo.description?.trim();
    const short =
      d && d.length > 48 ? `${d.slice(0, 45)}…` : d;
    return short ? `${wo.correlative} — ${short}` : wo.correlative;
  }

  private assetPayload(): {
    workOrderId: string | null;
    equipmentId: string | null;
  } {
    const wo = this.selectedWorkOrderId().trim();
    const eq = this.selectedEquipmentId().trim();
    return {
      workOrderId: wo || null,
      equipmentId: eq || null,
    };
  }

  cancel() {
    const eid = this.editId();
    if (eid) {
      this.router.navigate(['/app/compras/requerimientos', eid]);
    } else {
      this.resetForm();
      this.router.navigate(['/app/compras/requerimientos']);
    }
  }

  private resetForm() {
    this.description.set('');
    this.justification.set('');
    this.selectedSubcontractId.set('');
    this.selectedWorkOrderId.set('');
    this.selectedEquipmentId.set('');
    this.items.set([
      {
        description: '',
        quantity: 1,
        unitOfMeasure: 'UN',
        estimatedCost: null,
        partNumber: '',
        itemNotes: '',
      },
    ]);
    const list = this.contracts();
    const cid = this.authService.currentContractId();
    if (cid && cid !== 'ALL' && isUuid(cid) && list.some((c) => c.id === cid)) {
      this.selectedContractId.set(cid);
    } else if (list.length === 1) {
      this.selectedContractId.set(list[0].id);
    } else {
      this.selectedContractId.set('');
    }
    const sel = this.selectedContractId();
    if (sel && isUuid(sel)) {
      this.loadAssetsForContract(sel);
    } else {
      this.equipments.set([]);
      this.workOrders.set([]);
    }
  }

  openRowPicker(index: number) {
    if (this.isFormReadOnly()) return;
    this.pickerRowIndex.set(index);
    this.showItemPicker.set(true);
  }

  /** Campos de línea editables solo con artículo del catálogo vinculado. */
  isRowCatalogLinked(row: RequisitionFormItemRow): boolean {
    return isUuid(row.inventoryItemId ?? undefined);
  }

  onPickerClosed() {
    this.showItemPicker.set(false);
    this.pickerRowIndex.set(null);
  }

  onPickerItem(row: ItemPickerRow) {
    const idx = this.pickerRowIndex();
    if (idx !== null) {
      this.selectInventoryItem(idx, row);
    }
    this.showItemPicker.set(false);
    this.pickerRowIndex.set(null);
  }

  selectInventoryItem(index: number, item: ItemPickerRow) {
    this.items.update((items) =>
      items.map((row, i) =>
        i === index
          ? {
              ...row,
              inventoryItemId: item.id,
              inventoryItemName: item.name,
              description:
                (item.description && item.description.trim()) || item.name,
              partNumber: item.partNumber?.trim() || '',
              unitOfMeasure:
                item.unitOfMeasure?.abbreviation ?? row.unitOfMeasure,
              itemNotes: item.compatibilityInfo?.trim() || '',
              estimatedCost: null,
            }
          : row,
      ),
    );
  }

  addItem() {
    if (this.isFormReadOnly()) return;
    this.items.update((items) => [
      ...items,
      {
        description: '',
        quantity: 1,
        unitOfMeasure: 'UN',
        estimatedCost: null,
        partNumber: '',
        itemNotes: '',
      },
    ]);
  }

  removeItem(index: number) {
    if (this.isFormReadOnly()) return;
    this.items.update((items) => items.filter((_, i) => i !== index));
  }

  onItemQuantityChange(index: number, raw: string | number) {
    const parsed =
      typeof raw === 'number'
        ? raw
        : parseFloat(String(raw ?? '').trim().replace(',', '.'));
    const prev = this.items()[index]?.quantity ?? 1;
    const qty = Number.isFinite(parsed) ? parsed : prev;
    this.items.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, quantity: qty } : row)),
    );
  }

  private mapItemsPayload(): Array<{
    id?: string;
    inventoryItemId?: string | null;
    description: string;
    quantity: number;
    unitOfMeasure: string;
    estimatedCost: number | null;
    partNumber?: string;
    itemNotes?: string;
  }> {
    return this.items().map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      inventoryItemId: i.inventoryItemId || null,
      description: i.description,
      quantity: i.quantity,
      unitOfMeasure: i.unitOfMeasure,
      estimatedCost: i.estimatedCost,
      partNumber: i.partNumber?.trim() || undefined,
      itemNotes: i.itemNotes?.trim() || undefined,
    }));
  }

  save() {
    if (this.isFormReadOnly()) return;
    if (!this.description()) {
      this.notify.error('La descripci\u00F3n es obligatoria');
      return;
    }
    if (this.items().some((i) => !i.description)) {
      this.notify.error('Todos los \u00EDtems deben tener descripci\u00F3n');
      return;
    }
    const missingCatalog = this.items().findIndex(
      (i) => !isUuid(i.inventoryItemId ?? undefined),
    );
    if (missingCatalog !== -1) {
      this.notify.error(
        `L\u00EDnea ${missingCatalog + 1}: debe vincular un art\u00EDculo del cat\u00E1logo maestro (buscar existente o «+ Nuevo art\u00EDculo» en el selector).`,
      );
      return;
    }

    const badQty = this.items().findIndex(
      (i) => !Number.isFinite(i.quantity) || i.quantity <= 0,
    );
    if (badQty !== -1) {
      this.notify.error(
        `L\u00EDnea ${badQty + 1}: la cantidad solicitada debe ser un n\u00FAmero mayor a cero.`,
      );
      return;
    }

    const contractId = this.selectedContractId();
    if (!contractId || !isUuid(contractId)) {
      this.notify.error('Seleccione un contrato para el requerimiento');
      return;
    }

    const eid = this.editId();
    this.isSaving.set(true);

    if (eid) {
      this.purchasesService
        .updateRequisition(eid, {
          description: this.description(),
          justification: this.justification() || undefined,
          priority: this.priority(),
          items: this.mapItemsPayload(),
          ...this.assetPayload(),
        })
        .subscribe({
          next: () => {
            this.notify.success('Requerimiento actualizado');
            this.isSaving.set(false);
            this.router.navigate(['/app/compras/requerimientos', eid]);
          },
          error: (err: unknown) => {
            const msg =
              err &&
              typeof err === 'object' &&
              'error' in err &&
              (err as { error?: { message?: string } }).error?.message;
            this.notify.error(
              typeof msg === 'string' ? msg : 'Error al guardar cambios',
            );
            this.isSaving.set(false);
          },
        });
      return;
    }

    this.purchasesService
      .createRequisition({
        contractId,
        subcontractId: this.selectedSubcontractId() || undefined,
        description: this.description(),
        justification: this.justification(),
        priority: this.priority(),
        items: this.mapItemsPayload(),
        ...this.assetPayload(),
      })
      .subscribe({
        next: (req) => {
          this.notify.success(`Requerimiento ${req.correlative} creado`);
          this.isSaving.set(false);
          this.router.navigate(['/app/compras/requerimientos', req.id]);
        },
        error: (err: unknown) => {
          const msg =
            err &&
            typeof err === 'object' &&
            'error' in err &&
            (err as { error?: { message?: string } }).error?.message;
          this.notify.error(
            typeof msg === 'string' ? msg : 'Error al crear requerimiento',
          );
          this.isSaving.set(false);
        },
      });
  }
}
