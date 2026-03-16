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
import { RouterLink, Router } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog/catalog.service';

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

  // Exponemos catálogos globales
  fluidsCatalog = this.catalogService.fluids;
  systemsCatalog = this.catalogService.systems; // <-- Este Signal alimenta los checkboxes

  // Mock de la flota
  fleet = signal([
    { id: '1', internalId: 'EC-3005', type: 'CAMIONETA' },
    { id: '2', internalId: 'EC-2995', type: 'BULLDOZER' },
  ]);

  otForm: FormGroup;

  constructor() {
    // Inicializamos el formulario en el constructor
    this.otForm = this.fb.group({
      equipmentId: ['', Validators.required],
      type: ['NUEVA', Validators.required],
      category: ['PROGRAMADA', Validators.required],
      initialHorometer: ['', [Validators.required, Validators.min(0)]],
      finalHorometer: ['', [Validators.required, Validators.min(0)]],
      description: ['', Validators.required],
      systems: this.fb.array([]), // <-- Nuevo FormArray para los Checkboxes
      fluids: this.fb.array([]),
    });
  }

  ngOnInit() {
    // Construimos los checkboxes dinámicamente cuando el componente carga
    this.buildSystemsCheckboxes();
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
    if (this.otForm.invalid) {
      this.otForm.markAllAsTouched();
      return;
    }

    // Mapeo Crítico: Traducir el array de true/false a los IDs reales de los sistemas seleccionados
    const selectedSystemIds = this.otForm.value.systems
      .map((checked: boolean, i: number) =>
        checked ? this.systemsCatalog()[i].id : null,
      )
      .filter((v: string | null) => v !== null);

    const finalPayload = {
      ...this.otForm.value,
      systems: selectedSystemIds, // Reemplazamos el array de booleanos por los IDs
    };

    console.log('Payload Final de la OT:', finalPayload);
    alert(
      'OT Guardada con éxito. Revisa la consola para ver el JSON estructurado.',
    );
    this.router.navigate(['/app/ots']);
  }
}
