import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-inventory-item-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './inventory-item-form.component.html',
})
export class InventoryItemFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryItemsService = inject(InventoryItemsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  itemId: string | null = null;
  mode: 'CREATING' | 'EDITING' = 'CREATING';
  itemForm: FormGroup;

  // Categorías comunes de sugerencia
  commonCategories = [
    'REPUESTO',
    'FLUIDO',
    'HERRAMIENTA',
    'EPP',
    'CONSUMIBLE',
    'NEUMÁTICO',
    'COMPONENTE MAYOR',
  ];

  constructor() {
    this.itemForm = this.fb.group({
      partNumber: ['', Validators.required],
      name: ['', Validators.required],
      description: [''],
      category: ['REPUESTO', Validators.required],
      unitOfMeasure: ['UN', Validators.required],
      brand: [''],
      isSerialized: [false],
    });
  }

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.itemId = params.get('id');
      if (this.itemId) {
        this.mode = 'EDITING';
        this.loadItem(this.itemId);
      }
    });
  }

  loadItem(id: string) {
    this.inventoryItemsService.getItem(id).subscribe({
      next: (item) => this.itemForm.patchValue(item),
      error: () => {
        this.notificationService.error('Artículo no encontrado');
        this.router.navigate(['/app/articulos']);
      },
    });
  }

  onSubmit() {
    if (this.itemForm.invalid) {
      this.itemForm.markAllAsTouched();
      return;
    }

    const payload = this.itemForm.value;

    if (this.mode === 'CREATING') {
      this.inventoryItemsService.createItem(payload).subscribe({
        next: () => {
          this.notificationService.success('Artículo creado exitosamente.');
          this.router.navigate(['/app/articulos']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al crear.',
          ),
      });
    } else if (this.itemId) {
      this.inventoryItemsService.updateItem(this.itemId, payload).subscribe({
        next: () => {
          this.notificationService.success(
            'Artículo actualizado exitosamente.',
          );
          this.router.navigate(['/app/articulos']);
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al actualizar.',
          ),
      });
    }
  }
}
