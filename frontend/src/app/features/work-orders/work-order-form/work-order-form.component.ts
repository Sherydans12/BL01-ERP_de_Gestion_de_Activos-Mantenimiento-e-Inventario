import {
  Component,
  inject,
  signal,
  OnInit,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  FormControl,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog/catalog.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { Equipment, MeterType } from '../../../core/models/types';
import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  of,
} from 'rxjs';

@Component({
  selector: 'app-work-order-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './work-order-form.component.html',
})
export class WorkOrderFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private workOrdersService = inject(WorkOrdersService);
  private fleetService = inject(FleetService);
  private notificationService = inject(NotificationService);
  private maintenanceKitsService = inject(MaintenanceKitsService);
  private warehousesService = inject(WarehousesService);
  private inventoryItemsService = inject(InventoryItemsService);
  private inventoryStockService = inject(InventoryStockService);

  otId: string | null = null;
  mode: 'CREATING' | 'EDITING' | 'READONLY' = 'CREATING';
  currentStatus: string = '';

  fluidsCatalog = this.catalogService.fluids;
  systemsCatalog = this.catalogService.systems;
  allKits = signal<any[]>([]);
  pmKits = signal<any[]>([]);

  fleet = signal<Equipment[]>([]);
  selectedEquipmentMeterType = signal<MeterType>(MeterType.HOURS);

  // --- INTEGRACIÓN INVENTARIO ---
  warehouses = signal<any[]>([]);
  searchResults = signal<any[]>([]);
  activeSearchIndex = signal<number>(-1);
  warehouseStocks = signal<any[]>([]); // Stock de la bodega seleccionada para costeo

  // Costo total estimado basado en repuestos vinculados y stock de bodega
  estimatedCost = computed(() => {
    const stocks = this.warehouseStocks();
    if (!stocks.length) return 0;

    let total = 0;
    const partsCtrl = this.otForm?.get('parts') as FormArray;
    if (!partsCtrl) return 0;

    for (let i = 0; i < partsCtrl.length; i++) {
      const part = partsCtrl.at(i).value;
      if (part.inventoryItemId) {
        const stockRecord = stocks.find(
          (s: any) => s.itemId === part.inventoryItemId,
        );
        if (stockRecord?.unitCost) {
          total += stockRecord.unitCost * Number(part.quantity || 0);
        }
      }
    }
    return total;
  });

  get isReadonly(): boolean {
    return this.mode === 'READONLY';
  }

  // Debounce para búsqueda de ítems de inventario
  private searchSubject = new Subject<{ query: string; index: number }>();

  meterLabel = computed(() => {
    return this.selectedEquipmentMeterType() === MeterType.HOURS
      ? 'Horómetro'
      : 'Kilometraje';
  });

  otForm: FormGroup;

  constructor() {
    this.otForm = this.fb.group({
      equipmentId: ['', Validators.required],
      warehouseId: [''], // Opcional al crear, obligatorio al cerrar si hay parts vinculados
      type: ['NUEVA', Validators.required],
      category: ['PROGRAMADA', Validators.required],
      maintenanceType: ['PREVENTIVO', Validators.required],
      initialMeter: ['', [Validators.required, Validators.min(0)]],
      finalMeter: ['', [Validators.required, Validators.min(0)]],
      description: ['', Validators.required],
      responsible: ['', Validators.required],
      systems: this.fb.array([]),
      fluids: this.fb.array([]),
      tasks: this.fb.array([]),
      parts: this.fb.array([]),
      fluidSamples: this.fb.array([]),
    });
  }

  // --- GETTER PARA APD ---
  get fluidSamplesArray(): FormArray {
    return this.otForm.get('fluidSamples') as FormArray;
  }

  // --- MÉTODOS APD ---
  addFluidSampleRow() {
    this.fluidSamplesArray.push(
      this.fb.group({
        systemId: ['', Validators.required],
        bottleCode: ['', Validators.required],
      }),
    );
  }

  removeFluidSampleRow(index: number) {
    this.fluidSamplesArray.removeAt(index);
  }

  ngOnInit() {
    this.fleetService.getEquipments({ limit: 1000 }).subscribe({
      next: (res) => this.fleet.set(res.data),
      error: (err) => console.error('Error al cargar flota:', err),
    });
    // Cargar Kits de Mantenimiento
    this.maintenanceKitsService.getKits().subscribe({
      next: (kits) => {
        this.allKits.set(kits);
        this.pmKits.set(kits);
      },
      error: (err) => console.error('Error al cargar Kits PM', err),
    });

    this.buildSystemsCheckboxes();

    // Configurar debounce para búsqueda de ítems
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(
          (prev, curr) =>
            prev.query === curr.query && prev.index === curr.index,
        ),
        switchMap(({ query, index }) => {
          if (query.length < 2) {
            return of({ results: [] as any[], index });
          }
          return this.inventoryItemsService
            .searchItems(query)
            .pipe(switchMap((results) => of({ results, index })));
        }),
      )
      .subscribe(({ results, index }) => {
        this.searchResults.set(results);
        this.activeSearchIndex.set(index);
      });

    this.route.paramMap.subscribe((params) => {
      this.otId = params.get('id');
      if (this.otId) {
        this.mode = 'EDITING';
        this.loadWorkOrder(this.otId);
      } else {
        this.loadDefaultTasks();
      }
    });

    // LÓGICA REACTIVA 1: Al seleccionar un equipo → cargar bodegas del contrato
    this.otForm.get('equipmentId')?.valueChanges.subscribe((eqId) => {
      if (!eqId || this.mode === 'READONLY') return;

      const selectedEq = this.fleet().find((eq) => eq.id === eqId);

      if (selectedEq) {
        this.selectedEquipmentMeterType.set(selectedEq.meterType);

        // Determinar contractId del equipo
        const contractId =
          (selectedEq as any).contractId ||
          (selectedEq as any).subcontract?.contractId;

        if (contractId) {
          this.warehousesService.getWarehousesByContract(contractId).subscribe({
            next: (whs) => this.warehouses.set(whs),
            error: () => this.warehouses.set([]),
          });
        } else {
          this.warehouses.set([]);
        }

        // Resetear bodega al cambiar equipo
        this.otForm.patchValue({ warehouseId: '' });

        // Filtrado de Kits PM
        const compatibleKits = this.allKits().filter((kit) => {
          const isUniversal = !kit.equipmentBrand && !kit.equipmentModel;
          const matchBrand = kit.equipmentBrand === selectedEq.brand;
          const matchModel = kit.equipmentModel === selectedEq.model;
          return (
            isUniversal || (matchBrand && (!kit.equipmentModel || matchModel))
          );
        });

        this.pmKits.set(compatibleKits);

        if (this.partsArray.length > 0 && this.mode === 'CREATING') {
          this.notificationService.info(
            'Revisa los repuestos. El equipo ha cambiado.',
          );
        }

        if (this.mode === 'CREATING') {
          this.otForm.patchValue({
            initialMeter: selectedEq.currentMeter,
          });

          this.otForm
            .get('finalMeter')
            ?.setValidators([
              Validators.required,
              Validators.min(selectedEq.currentMeter),
            ]);
          this.otForm.get('finalMeter')?.updateValueAndValidity();
        }
      }
    });

    // LÓGICA REACTIVA 2: Al cambiar la categoría
    this.otForm.get('category')?.valueChanges.subscribe((category) => {
      if (this.mode === 'CREATING') {
        if (category === 'PROGRAMADA') {
          this.loadDefaultTasks();
        } else {
          this.tasksArray.clear();
          this.partsArray.clear();
        }
      }
    });

    // LÓGICA REACTIVA 3: Al cambiar la bodega → cargar costos para estimación
    this.otForm.get('warehouseId')?.valueChanges.subscribe((whId) => {
      if (whId && this.mode !== 'READONLY') {
        this.loadWarehouseCosts(whId);
      } else {
        this.warehouseStocks.set([]);
      }
    });
  }

  private loadWorkOrder(id: string) {
    this.workOrdersService.getWorkOrder(id).subscribe({
      next: (ot) => {
        this.currentStatus = ot.status;
        if (ot.status === 'CLOSED') {
          this.mode = 'READONLY';
        }

        if (ot.equipment) {
          this.selectedEquipmentMeterType.set(ot.equipment.meterType);

          // Cargar bodegas del contrato del equipo
          const contractId =
            ot.equipment.contract?.id || ot.equipment.subcontract?.contractId;
          if (contractId) {
            this.warehousesService
              .getWarehousesByContract(contractId)
              .subscribe({
                next: (whs) => this.warehouses.set(whs),
                error: () => this.warehouses.set([]),
              });
          }
        }

        this.otForm.patchValue({
          equipmentId: ot.equipmentId,
          warehouseId: ot.warehouseId || '',
          type: ot.type,
          category: ot.category,
          maintenanceType: ot.maintenanceType || 'PREVENTIVO',
          initialMeter: ot.initialMeter,
          finalMeter: ot.finalMeter,
          description: ot.description,
          responsible: ot.responsible || '',
        });

        // Marcar sistemas
        const catalogSystems = this.systemsCatalog();
        const existingSystemIds =
          ot.systems?.map((s: any) => s.catalogItemId) || [];
        const checkedArray = catalogSystems.map((cs) =>
          existingSystemIds.includes(cs.id),
        );

        checkedArray.forEach((isChecked, i) => {
          (this.otForm.get('systems') as FormArray).at(i).setValue(isChecked);
        });

        // Cargar fluidos
        if (ot.fluids && ot.fluids.length > 0) {
          ot.fluids.forEach((f: any) => {
            this.fluidsArray.push(
              this.fb.group({
                fluidId: [f.catalogItemId, Validators.required],
                liters: [f.liters, [Validators.required, Validators.min(0.1)]],
                action: [f.action, Validators.required],
              }),
            );
          });
        }

        // Cargar Tareas
        if (ot.tasks && ot.tasks.length > 0) {
          ot.tasks.forEach((t: any) => {
            this.tasksArray.push(
              this.fb.group({
                description: [t.description, Validators.required],
                isCompleted: [t.isCompleted],
                observation: [t.observation],
                measurement: [t.measurement],
              }),
            );
          });
        }

        // Cargar Repuestos (con inventoryItemId si existe)
        if (ot.parts && ot.parts.length > 0) {
          ot.parts.forEach((p: any) => {
            this.partsArray.push(
              this.fb.group({
                partNumber: [p.partNumber, Validators.required],
                description: [p.description, Validators.required],
                quantity: [
                  p.quantity,
                  [Validators.required, Validators.min(1)],
                ],
                inventoryItemId: [p.inventoryItemId || ''],
                linkedItemName: [
                  p.inventoryItem
                    ? `${p.inventoryItem.partNumber} - ${p.inventoryItem.name}`
                    : '',
                ],
              }),
            );
          });
        }

        if (this.mode === 'READONLY') {
          this.otForm.disable();
        }
      },
      error: (err) => {
        console.error('OT no encontrada:', err);
        this.notificationService.error('OT no encontrada');
        this.router.navigate(['/app/ots']);
      },
    });
  }

  // --- GETTERS FORM ARRAYS ---
  get fluidsArray(): FormArray {
    return this.otForm.get('fluids') as FormArray;
  }
  get systemsArray(): FormArray {
    return this.otForm.get('systems') as FormArray;
  }
  get tasksArray(): FormArray {
    return this.otForm.get('tasks') as FormArray;
  }
  get partsArray(): FormArray {
    return this.otForm.get('parts') as FormArray;
  }

  // --- SISTEMAS ---
  private buildSystemsCheckboxes() {
    const systemsControls = this.systemsCatalog().map(
      () => new FormControl(false),
    );
    this.otForm.setControl('systems', this.fb.array(systemsControls));
  }

  // --- FLUIDOS ---
  addFluidRow() {
    this.fluidsArray.push(
      this.fb.group({
        fluidId: ['', Validators.required],
        liters: ['', [Validators.required, Validators.min(0.1)]],
        action: ['RELLENO', Validators.required],
      }),
    );
  }
  removeFluidRow(index: number) {
    this.fluidsArray.removeAt(index);
  }

  // --- TAREAS TPM ---
  loadDefaultTasks() {
    const defaultTasks = [
      'REVISE NIVEL ACEITE DE MOTOR',
      'LIMPIE RESPIRADEROS DE MOTOR',
      'REVISE NIVEL DE REFRIGERANTE',
      'REVISE INDICADOR DE SERVICIO FILTRO AIRE',
      'DRENE AGUA Y SEDIMENTOS TANQUE COMBUSTIBLE',
    ];

    this.tasksArray.clear();
    defaultTasks.forEach((task) => {
      this.tasksArray.push(
        this.fb.group({
          description: [task, Validators.required],
          isCompleted: [false],
          observation: [''],
          measurement: [null],
        }),
      );
    });
  }

  addCustomTask() {
    this.tasksArray.push(
      this.fb.group({
        description: ['', Validators.required],
        isCompleted: [false],
        observation: [''],
        measurement: [null],
      }),
    );
  }

  removeCustomTask(index: number) {
    this.tasksArray.removeAt(index);
  }

  // --- REPUESTOS ---
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
  removePartRow(index: number) {
    this.partsArray.removeAt(index);
    if (this.activeSearchIndex() === index) {
      this.closeSearch();
    }
  }

  // --- AUTOCOMPLETE INVENTARIO ---
  onPartSearch(event: Event, index: number) {
    const query = (event.target as HTMLInputElement).value;
    if (query.length >= 2) {
      this.searchSubject.next({ query, index });
    } else {
      this.closeSearch();
    }
  }

  selectInventoryItem(item: any, index: number) {
    const partGroup = this.partsArray.at(index) as FormGroup;
    partGroup.patchValue({
      partNumber: item.partNumber,
      description: item.name,
      inventoryItemId: item.id,
      linkedItemName: `${item.partNumber} - ${item.name}`,
    });
    this.closeSearch();
  }

  unlinkInventoryItem(index: number) {
    const partGroup = this.partsArray.at(index) as FormGroup;
    partGroup.patchValue({
      inventoryItemId: '',
      linkedItemName: '',
    });
  }

  closeSearch() {
    this.searchResults.set([]);
    this.activeSearchIndex.set(-1);
  }

  // --- GUARDADO ---
  onSubmit() {
    // Si estamos editando y el usuario apretó el botón, en realidad quiere cerrar.
    if (this.mode === 'EDITING' && this.otId) {
      this.closeWorkOrder();
      return;
    }

    if (this.otForm.invalid || this.mode === 'READONLY') {
      this.otForm.markAllAsTouched();
      return;
    }

    const selectedSystemIds = this.otForm.value.systems
      .map((checked: boolean, i: number) =>
        checked ? this.systemsCatalog()[i].id : null,
      )
      .filter((v: string | null) => v !== null);

    const formValues = this.otForm.getRawValue();

    const finalPayload = {
      ...formValues,
      initialMeter: Number(formValues.initialMeter),
      finalMeter: Number(formValues.finalMeter),
      systems: selectedSystemIds,
      fluidSamples: formValues.fluidSamples,
      warehouseId: formValues.warehouseId || undefined,
      parts: formValues.parts.map((p: any) => ({
        partNumber: p.partNumber,
        description: p.description,
        quantity: Number(p.quantity),
        inventoryItemId: p.inventoryItemId || undefined,
      })),
    };

    if (this.mode === 'EDITING' && this.otId) {
      this.notificationService.warning(
        'La edición completa aún no está implementada en el backend.',
      );
    } else {
      this.workOrdersService.createOT(finalPayload).subscribe({
        next: () => {
          this.notificationService.success(
            'Orden de Trabajo creada exitosamente.',
          );
          this.router.navigate(['/app/ots']);
        },
        error: (err) => {
          console.error('Error al crear OT:', err);
          this.notificationService.error(
            err.error?.message || 'Error al crear la OT',
          );
        },
      });
    }
  }

  closeWorkOrder() {
    if (this.otForm.invalid) {
      this.otForm.markAllAsTouched();
      this.notificationService.error(
        'Complete todos los campos obligatorios antes de cerrar.',
      );
      return;
    }

    const currentValues = this.otForm.getRawValue();

    // 1. Verificar bodega si hay repuestos vinculados
    const linkedParts = currentValues.parts.filter(
      (p: any) => p.inventoryItemId,
    );
    if (linkedParts.length > 0 && !currentValues.warehouseId) {
      this.notificationService.error(
        'Debe seleccionar una Bodega de Origen para descontar el stock.',
      );
      return;
    }

    // 2. Ejecutar el cierre
    this.workOrdersService
      .updateStatus(this.otId!, 'CLOSED', currentValues.warehouseId)
      .subscribe({
        next: () => {
          this.notificationService.success(
            'OT Cerrada. Stock descontado y Kárdex actualizado.',
          );
          this.router.navigate(['/app/ots']);
        },
        error: (err) => {
          console.error('Error al cerrar OT:', err);
          this.notificationService.error(
            err.error?.message || 'Error al cerrar la OT.',
          );
        },
      });
  }

  // --- APLICACIÓN DE KITS CON AUTO-LINK DE INVENTARIO ---
  applyKit(event: Event) {
    const kitId = (event.target as HTMLSelectElement).value;
    if (!kitId) return;

    const selectedKit = this.pmKits().find((k) => k.id === kitId);
    if (!selectedKit) return;

    this.partsArray.clear();

    if (selectedKit.parts && selectedKit.parts.length > 0) {
      let autoLinkedCount = 0;

      selectedKit.parts.forEach((part: any) => {
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

      // Auto-link: buscar cada partNumber en el catálogo de inventario
      selectedKit.parts.forEach((part: any, index: number) => {
        this.inventoryItemsService.searchItems(part.partNumber).subscribe({
          next: (results: any[]) => {
            const exactMatch = results.find(
              (r: any) =>
                r.partNumber.toLowerCase() === part.partNumber.toLowerCase(),
            );
            if (exactMatch) {
              const partGroup = this.partsArray.at(index);
              if (partGroup) {
                partGroup.patchValue({
                  inventoryItemId: exactMatch.id,
                  linkedItemName: `${exactMatch.partNumber} - ${exactMatch.name}`,
                });
                autoLinkedCount++;
              }
            }
          },
          error: () => {
            /* Silenciar errores de auto-link individual */
          },
        });
      });

      this.notificationService.success(
        `Kit ${selectedKit.code} cargado: ${selectedKit.parts.length} repuestos añadidos.`,
      );
    } else {
      this.notificationService.warning(
        `El Kit ${selectedKit.code} no tiene repuestos configurados.`,
      );
    }

    const currentDesc = this.otForm.get('description')?.value;
    if (!currentDesc) {
      this.otForm.patchValue({
        description: `Aplicación de ${selectedKit.name}`,
      });
    }
  }

  // --- CARGA DE COSTOS AL CAMBIAR BODEGA ---
  loadWarehouseCosts(warehouseId: string) {
    if (!warehouseId) {
      this.warehouseStocks.set([]);
      return;
    }
    this.inventoryStockService.getStockByWarehouse(warehouseId).subscribe({
      next: (stocks) => this.warehouseStocks.set(stocks),
      error: () => this.warehouseStocks.set([]),
    });
  }

  // --- HELPERS PARA LA VISTA DE STOCK ---
  getAvailableStock(itemId: string | null | undefined): number {
    if (!itemId) return 0;
    const stock = this.warehouseStocks().find((s) => s.itemId === itemId);
    return stock ? stock.quantity : 0;
  }

  hasEnoughStock(index: number): boolean {
    const partGroup = this.partsArray.at(index);
    const reqQty = Number(partGroup.get('quantity')?.value || 0);
    const itemId = partGroup.get('inventoryItemId')?.value;
    if (!itemId) return false;
    return this.getAvailableStock(itemId) >= reqQty;
  }
}
