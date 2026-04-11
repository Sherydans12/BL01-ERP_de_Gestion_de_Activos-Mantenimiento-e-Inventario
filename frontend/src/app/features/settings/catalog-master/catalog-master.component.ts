import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  CatalogService,
  CatalogCategory,
  CatalogItem,
} from '../../../core/services/catalog/catalog.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-catalog-master',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ConfirmModalComponent],
  templateUrl: './catalog-master.component.html',
})
export class CatalogMasterComponent {
  private injector = inject(Injector);
  private catalogService = inject(CatalogService);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);

  activeCategory = signal<CatalogCategory>('EQUIPMENT_TYPE');

  // Modals state
  showModal = signal(false);
  catalogDialog = viewChild<ElementRef<HTMLDialogElement>>('catalogDialog');
  isEditMode = signal(false);
  currentEditId = signal<string | null>(null);

  showConfirmModal = signal(false);
  pendingDeleteId = signal<string | null>(null);

  categoryPrefixes: Record<CatalogCategory, string> = {
    EQUIPMENT_TYPE: 'TEQ-',
    BRAND: 'BRD-',
    SYSTEM: 'SYS-',
    FLUID: 'FLD-',
    FUEL_TYPE: 'FLT-',
    DRIVE_TYPE: 'DRV-',
    OWNERSHIP: 'OWN-',
  };

  categoryNames: Record<CatalogCategory, string> = {
    EQUIPMENT_TYPE: 'Tipos de Equipo',
    BRAND: 'Marcas de Flota',
    SYSTEM: 'Sistemas Intervenidos',
    FLUID: 'Fluidos y Aceites',
    FUEL_TYPE: 'Tipos de Combustible',
    DRIVE_TYPE: 'Tipos de Tracción',
    OWNERSHIP: 'Tipo de Propiedad',
  };

  categoryList: { id: CatalogCategory; name: string }[] = [
    { id: 'EQUIPMENT_TYPE', name: this.categoryNames.EQUIPMENT_TYPE },
    { id: 'BRAND', name: this.categoryNames.BRAND },
    { id: 'SYSTEM', name: this.categoryNames.SYSTEM },
    { id: 'FLUID', name: this.categoryNames.FLUID },
    { id: 'FUEL_TYPE', name: this.categoryNames.FUEL_TYPE },
    { id: 'DRIVE_TYPE', name: this.categoryNames.DRIVE_TYPE },
    { id: 'OWNERSHIP', name: this.categoryNames.OWNERSHIP },
  ];

  catalogForm = this.fb.group({
    code: ['', Validators.required],
    name: ['', Validators.required],
    category: ['' as CatalogCategory, Validators.required],
    isActive: [true],
  });

  activeItems = computed(() => {
    return this.catalogService
      .getAllCatalogs()()
      .filter((item) => item.category === this.activeCategory());
  });

  setCategory(category: CatalogCategory) {
    this.activeCategory.set(category);
  }

  // --- Auto-generation logic ---
  private calculateNextCode(): string {
    const prefix = this.categoryPrefixes[this.activeCategory()];
    const currentItems = this.activeItems();

    let maxNumber = 0;
    const regex = new RegExp(`^${prefix}(\\d{3})$`);

    for (const item of currentItems) {
      const match = item.code.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    const nextNumber = maxNumber + 1;
    return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
  }

  openModal() {
    this.isEditMode.set(false);
    this.currentEditId.set(null);
    this.catalogForm.reset({
      code: this.calculateNextCode(),
      name: '',
      category: this.activeCategory(),
      isActive: true,
    });
    this.showModal.set(true);
    this.openCatalogDialogDom();
  }

  private openCatalogDialogDom(): void {
    afterNextRender(
      () => {
        const el = this.catalogDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  editItem(item: CatalogItem) {
    this.isEditMode.set(true);
    this.currentEditId.set(item.id);
    this.catalogForm.reset({
      code: item.code,
      name: item.name,
      category: item.category,
      isActive: item.isActive,
    });
    this.showModal.set(true);
    this.openCatalogDialogDom();
  }

  closeModal() {
    const el = this.catalogDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.resetCatalogModal();
    }
  }

  onCatalogDialogClose() {
    this.resetCatalogModal();
  }

  private resetCatalogModal() {
    this.showModal.set(false);
    this.isEditMode.set(false);
    this.currentEditId.set(null);
  }

  submitForm() {
    if (this.catalogForm.invalid) return;

    const data = this.catalogForm.getRawValue() as Omit<CatalogItem, 'id'>;

    if (this.isEditMode()) {
      const id = this.currentEditId();
      if (!id) return;
      this.catalogService.updateItem(id, data).subscribe({
        next: () => {
          this.closeModal();
          this.notificationService.success('Ítem actualizado exitosamente.');
        },
        error: (err) => console.error('Error al actualizar ítem:', err),
      });
    } else {
      this.catalogService.createItem(data).subscribe({
        next: () => {
          this.closeModal();
          this.notificationService.success('Ítem creado exitosamente.');
        },
        error: (err) => console.error('Error al crear ítem:', err),
      });
    }
  }

  // --- Toggle Active ---
  toggleActive(item: CatalogItem) {
    this.catalogService
      .updateItem(item.id, { isActive: !item.isActive })
      .subscribe({
        next: () => {
          this.notificationService.success(
            `Ítem ${item.isActive ? 'desactivado' : 'activado'} exitosamente.`,
          );
        },
        error: (err) => console.error('Error al cambiar estado:', err),
      });
  }

  // --- Deletion via Confirm Modal ---
  requestDelete(id: string) {
    this.pendingDeleteId.set(id);
    this.showConfirmModal.set(true);
  }

  confirmDelete() {
    const id = this.pendingDeleteId();
    if (!id) return;

    this.catalogService.deleteItem(id).subscribe({
      next: () => {
        this.notificationService.success('Ítem eliminado exitosamente.');
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Error al eliminar ítem:', err);
        this.cancelDelete();
      },
    });
  }

  cancelDelete() {
    this.showConfirmModal.set(false);
    this.pendingDeleteId.set(null);
  }
}
