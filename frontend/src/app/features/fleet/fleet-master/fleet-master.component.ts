import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog/catalog.service';

interface Equipment {
  id: string;
  internalId: string;
  plate: string;
  type: string;
  brand: string;
  model: string;
  techReviewExp: string | null;
  circPermitExp: string | null;
}

@Component({
  selector: 'app-fleet-master',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule], // <-- Agregado ReactiveFormsModule
  templateUrl: './fleet-master.component.html',
})
export class FleetMasterComponent {
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);

  // Exponemos los catálogos a la vista HTML como Signals
  equipmentTypes = this.catalogService.equipmentTypes;
  brands = this.catalogService.brands;

  // Datos mock
  fleet: Equipment[] = [
    {
      id: '1',
      internalId: 'EC-3005',
      plate: 'VCJW-21',
      type: 'CAMIONETA',
      brand: 'TOYOTA',
      model: 'HILUX DCAB MT 4X4 2.4',
      techReviewExp: '2026-04-03',
      circPermitExp: '2026-03-31',
    },
    {
      id: '2',
      internalId: 'EC-2995',
      plate: 'S/P',
      type: 'BULLDOZER',
      brand: 'CAT',
      model: 'D8',
      techReviewExp: null,
      circPermitExp: null,
    },
    {
      id: '3',
      internalId: 'EC-3045',
      plate: 'VDXK-62',
      type: 'CAMION ALJIBE',
      brand: 'FOTON',
      model: 'AUMAN 3546',
      techReviewExp: '2026-06-30',
      circPermitExp: '2026-09-30',
    },
    {
      id: '4',
      internalId: 'EC-3002',
      plate: 'VCJW-27',
      type: 'CAMIONETA COMB.',
      brand: 'TOYOTA',
      model: 'HILUX',
      techReviewExp: '2025-10-15',
      circPermitExp: '2026-03-31',
    },
  ];

  // Estado del Modal
  showModal = false;

  // Formulario Reactivo
  equipmentForm: FormGroup = this.fb.group({
    internalId: ['', [Validators.required]],
    plate: [''], // Opcional (Bulldozers no tienen patente de calle)
    type: ['', [Validators.required]],
    brand: ['', [Validators.required]],
    model: ['', [Validators.required]],
    techReviewExp: [''],
    circPermitExp: [''],
  });

  // Evalúa el estado del documento
  getDocStatus(expirationDate: string | null): {
    label: string;
    cssClass: string;
  } {
    if (!expirationDate)
      return { label: 'N/A', cssClass: 'text-gray-500 bg-dark border-border' };

    const exp = new Date(expirationDate);
    const today = new Date();
    const diffTime = exp.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0)
      return {
        label: 'VENCIDO',
        cssClass: 'text-error bg-error/10 border-error/20',
      };
    if (diffDays <= 30)
      return {
        label: 'PRÓXIMO',
        cssClass: 'text-warning bg-warning/10 border-warning/20',
      };
    return {
      label: 'VIGENTE',
      cssClass: 'text-success bg-success/10 border-success/20',
    };
  }

  // Acciones del Modal
  openModal() {
    this.equipmentForm.reset();
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }

  onSubmit() {
    if (this.equipmentForm.invalid) return;

    // Simulamos guardado en BD creando un ID aleatorio y mapeando el form
    const newEq: Equipment = {
      id: crypto.randomUUID(),
      ...this.equipmentForm.value,
    };

    // Lo agregamos al inicio del array para verlo inmediatamente
    this.fleet = [newEq, ...this.fleet];
    this.closeModal();
  }
}
