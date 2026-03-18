import { Component, inject, signal, OnInit } from '@angular/core';
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

  otId: string | null = null;
  mode: 'CREATING' | 'EDITING' | 'READONLY' = 'CREATING';
  currentStatus: string = '';

  // Exponemos catálogos globales
  fluidsCatalog = this.catalogService.fluids;
  systemsCatalog = this.catalogService.systems; // <-- Este Signal alimenta los checkboxes

  // Catálogo de flota real
  fleet = signal<any[]>([]);

  otForm: FormGroup;

  constructor() {
    // Inicializamos el formulario en el constructor
    this.otForm = this.fb.group({
      equipmentId: ['', Validators.required],
      type: ['NUEVA', Validators.required],
      category: ['PROGRAMADA', Validators.required],
      maintenanceType: ['PREVENTIVO', Validators.required],
      initialHorometer: ['', [Validators.required, Validators.min(0)]],
      finalHorometer: ['', [Validators.required, Validators.min(0)]],
      description: ['', Validators.required],
      systems: this.fb.array([]), // <-- Nuevo FormArray para los Checkboxes
      fluids: this.fb.array([]),
    });
  }

  ngOnInit() {
    this.fleetService.getEquipments({ limit: 1000 }).subscribe({
      next: (res) => this.fleet.set(res.data),
      error: (err) => console.error('Error al cargar flota:', err),
    });

    this.buildSystemsCheckboxes();

    // Verificamos si estamos editando
    this.route.paramMap.subscribe((params) => {
      this.otId = params.get('id');
      if (this.otId) {
        this.mode = 'EDITING';
        this.loadWorkOrder(this.otId);
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

        this.otForm.patchValue({
          equipmentId: ot.equipmentId,
          type: ot.type,
          category: ot.category,
          maintenanceType: ot.maintenanceType || 'PREVENTIVO',
          initialHorometer: ot.initialHorometer,
          finalHorometer: ot.finalHorometer,
          description: ot.description,
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
            const fluidGroup = this.fb.group({
              fluidId: [f.catalogItemId, Validators.required],
              liters: [f.liters, [Validators.required, Validators.min(0.1)]],
              action: [f.action, Validators.required],
            });
            this.fluidsArray.push(fluidGroup);
          });
        }

        if (this.mode === 'READONLY') {
          this.otForm.disable(); // Bloquea todos los inputs
        }
      },
      error: (err) => {
        console.error('OT no encontrada:', err);
        this.router.navigate(['/app/ots']);
      },
    });
  }

  // Atajos para el HTML
  get fluidsArray(): FormArray {
    return this.otForm.get('fluids') as FormArray;
  }

  get systemsArray(): FormArray {
    return this.otForm.get('systems') as FormArray;
  }

  // --- LÓGICA DE SISTEMAS (CHECKBOXES) ---
  private buildSystemsCheckboxes() {
    // Creamos un FormControl booleano (false por defecto) por cada sistema en el catálogo
    const systemsControls = this.systemsCatalog().map(
      () => new FormControl(false),
    );
    this.otForm.setControl('systems', this.fb.array(systemsControls));
  }

  // --- LÓGICA DE FLUIDOS ---
  addFluidRow() {
    const fluidGroup = this.fb.group({
      fluidId: ['', Validators.required],
      liters: ['', [Validators.required, Validators.min(0.1)]],
      action: ['RELLENO', Validators.required],
    });
    this.fluidsArray.push(fluidGroup);
  }

  removeFluidRow(index: number) {
    this.fluidsArray.removeAt(index);
  }

  // --- GUARDADO ---
  onSubmit() {
    if (this.otForm.invalid || this.mode === 'READONLY') {
      this.otForm.markAllAsTouched();
      return;
    }

    const selectedSystemIds = this.otForm.value.systems
      .map((checked: boolean, i: number) =>
        checked ? this.systemsCatalog()[i].id : null,
      )
      .filter((v: string | null) => v !== null);

    const finalPayload = {
      ...this.otForm.value,
      systems: selectedSystemIds,
    };

    if (this.mode === 'EDITING' && this.otId) {
      // Si tuviéramos un endpoint de Update, se llamaría aquí.
      // Por ahora el sistema asume que la OT no se edita en profundidad, solo se cambia de estado.
      // Así que podríamos implementar un update o dejarlo como "Solo creamos".
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
        error: (err) => console.error('Error al crear OT:', err),
      });
    }
  }
}
