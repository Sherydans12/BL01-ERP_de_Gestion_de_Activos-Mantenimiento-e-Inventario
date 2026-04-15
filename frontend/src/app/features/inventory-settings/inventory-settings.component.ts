import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  InventoryItemsService,
  ItemCategory,
} from '../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../core/services/notification/notification.service';
import {
  UnitsOfMeasureService,
  UnitOfMeasureRow,
} from '../../core/services/units-of-measure/units-of-measure.service';

@Component({
  selector: 'app-inventory-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './inventory-settings.component.html',
})
export class InventorySettingsComponent implements OnInit {
  private items = inject(InventoryItemsService);
  private notify = inject(NotificationService);
  private uomApi = inject(UnitsOfMeasureService);

  /** Pestaña activa: categorías o unidades de medida. */
  activeTab = signal<'categories' | 'uom'>('categories');

  isLoading = signal(true);
  /** Solo familias; las subcategorías se cargan al expandir (escalable). */
  categoryFamilies = signal<ItemCategory[]>([]);
  childrenByFamily = signal<Record<string, ItemCategory[]>>({});
  loadingChildrenId = signal<string | null>(null);

  uomLoading = signal(false);
  uoms = signal<UnitOfMeasureRow[]>([]);
  showUomModal = signal(false);
  editingUomId = signal<string | null>(null);
  uomName = '';
  uomAbbrev = '';

  showFamilyModal = signal(false);
  editingFamilyId = signal<string | null>(null);
  familyName = '';
  familyDescription = '';

  showSubModal = signal(false);
  subParentFamilyId = signal<string | null>(null);
  editingSubId = signal<string | null>(null);
  subName = '';
  subDescription = '';

  ngOnInit() {
    this.loadFamiliesOnly();
    this.loadUoms();
  }

  setTab(tab: 'categories' | 'uom') {
    this.activeTab.set(tab);
    if (tab === 'uom') {
      this.loadUoms();
    }
  }

  loadUoms() {
    this.uomLoading.set(true);
    this.uomApi.list().subscribe({
      next: (rows) => {
        this.uoms.set(rows);
        this.uomLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar las unidades de medida');
        this.uomLoading.set(false);
      },
    });
  }

  openNewUom() {
    this.editingUomId.set(null);
    this.uomName = '';
    this.uomAbbrev = '';
    this.showUomModal.set(true);
  }

  editUom(u: UnitOfMeasureRow) {
    this.editingUomId.set(u.id);
    this.uomName = u.name;
    this.uomAbbrev = u.abbreviation;
    this.showUomModal.set(true);
  }

  closeUomModal() {
    this.showUomModal.set(false);
  }

  saveUom() {
    const name = this.uomName.trim();
    const abbreviation = this.uomAbbrev.trim().toUpperCase();
    if (!name || !abbreviation) {
      this.notify.error('Nombre y abreviatura son obligatorios');
      return;
    }
    const id = this.editingUomId();
    if (id) {
      this.uomApi.update(id, { name, abbreviation }).subscribe({
        next: () => {
          this.notify.success('Unidad actualizada');
          this.closeUomModal();
          this.loadUoms();
        },
        error: (err) =>
          this.notify.error(err?.error?.message || 'Error al guardar'),
      });
      return;
    }
    this.uomApi.create({ name, abbreviation }).subscribe({
      next: () => {
        this.notify.success('Unidad creada');
        this.closeUomModal();
        this.loadUoms();
      },
      error: (err) =>
        this.notify.error(err?.error?.message || 'Error al crear'),
    });
  }

  deleteUom(u: UnitOfMeasureRow) {
    if (!confirm(`¿Eliminar la unidad "${u.name}" (${u.abbreviation})?`)) {
      return;
    }
    this.uomApi.remove(u.id).subscribe({
      next: () => {
        this.notify.success('Unidad eliminada');
        this.loadUoms();
      },
      error: (err) =>
        this.notify.error(err?.error?.message || 'No se puede eliminar'),
    });
  }

  loadFamiliesOnly() {
    this.isLoading.set(true);
    this.items.getCategoryFamilies().subscribe({
      next: (rows) => {
        const list = [...rows].sort((a, b) =>
          a.name.localeCompare(b.name, 'es'),
        );
        this.categoryFamilies.set(list);
        this.childrenByFamily.set({});
        this.isLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar las familias');
        this.isLoading.set(false);
      },
    });
  }

  onFamilyAccordionToggle(ev: Event, family: ItemCategory) {
    const el = ev.target as HTMLDetailsElement;
    if (!el.open) {
      return;
    }
    this.ensureChildrenLoaded(family.id);
  }

  ensureChildrenLoaded(familyId: string) {
    if (this.childrenByFamily()[familyId]) {
      return;
    }
    this.loadingChildrenId.set(familyId);
    this.items.getCategoryChildren(familyId).subscribe({
      next: (rows) => {
        this.childrenByFamily.update((m) => ({
          ...m,
          [familyId]: rows,
        }));
        this.loadingChildrenId.set(null);
      },
      error: () => {
        this.loadingChildrenId.set(null);
      },
    });
  }

  private refreshFamilyChildren(familyId: string) {
    this.childrenByFamily.update((m) => {
      const next = { ...m };
      delete next[familyId];
      return next;
    });
    this.ensureChildrenLoaded(familyId);
  }

  openNewFamily() {
    this.editingFamilyId.set(null);
    this.familyName = '';
    this.familyDescription = '';
    this.showFamilyModal.set(true);
  }

  editFamily(f: ItemCategory) {
    this.editingFamilyId.set(f.id);
    this.familyName = f.name;
    this.familyDescription = f.description ?? '';
    this.showFamilyModal.set(true);
  }

  closeFamilyModal() {
    this.showFamilyModal.set(false);
  }

  saveFamily() {
    const name = this.familyName.trim();
    if (!name) {
      this.notify.error('El nombre de la familia es obligatorio');
      return;
    }
    const desc = this.familyDescription.trim() || null;
    const id = this.editingFamilyId();
    if (id) {
      this.items.updateCategory(id, { name, description: desc }).subscribe({
        next: () => {
          this.notify.success('Familia actualizada');
          this.closeFamilyModal();
          this.loadFamiliesOnly();
        },
        error: (err) =>
          this.notify.error(err?.error?.message || 'Error al guardar'),
      });
      return;
    }
    this.items
      .createCategory({ name, description: desc, parentCategoryId: null })
      .subscribe({
        next: () => {
          this.notify.success('Familia creada');
          this.closeFamilyModal();
          this.loadFamiliesOnly();
        },
        error: (err) =>
          this.notify.error(err?.error?.message || 'Error al crear'),
      });
  }

  deleteFamily(f: ItemCategory) {
    const n = f._count?.childCategories ?? 0;
    if (n > 0) {
      this.notify.error(
        'Elimine primero las subcategorías de esta familia.',
      );
      return;
    }
    if (!confirm(`¿Eliminar la familia "${f.name}"?`)) {
      return;
    }
    this.items.deleteCategory(f.id).subscribe({
      next: () => {
        this.notify.success('Familia eliminada');
        this.loadFamiliesOnly();
      },
      error: (err) =>
        this.notify.error(err?.error?.message || 'No se puede eliminar'),
    });
  }

  openNewSub(familyId: string) {
    this.subParentFamilyId.set(familyId);
    this.editingSubId.set(null);
    this.subName = '';
    this.subDescription = '';
    this.showSubModal.set(true);
  }

  editSub(sub: ItemCategory) {
    this.subParentFamilyId.set(sub.parentCategoryId ?? null);
    this.editingSubId.set(sub.id);
    this.subName = sub.name;
    this.subDescription = sub.description ?? '';
    this.showSubModal.set(true);
  }

  closeSubModal() {
    this.showSubModal.set(false);
  }

  saveSub() {
    const name = this.subName.trim();
    if (!name) {
      this.notify.error('El nombre de la subcategoría es obligatorio');
      return;
    }
    const desc = this.subDescription.trim() || null;
    const parentId = this.subParentFamilyId();
    const sid = this.editingSubId();
    if (!parentId && !sid) {
      this.notify.error('Falta familia padre');
      return;
    }
    if (sid) {
      this.items.updateCategory(sid, { name, description: desc }).subscribe({
        next: () => {
          this.notify.success('Subcategoría actualizada');
          this.closeSubModal();
          if (parentId) {
            this.refreshFamilyChildren(parentId);
          }
        },
        error: (err) =>
          this.notify.error(err?.error?.message || 'Error al guardar'),
      });
      return;
    }
    if (!parentId) {
      return;
    }
    this.items
      .createCategory({
        name,
        description: desc,
        parentCategoryId: parentId,
      })
      .subscribe({
        next: () => {
          this.notify.success('Subcategoría creada');
          this.closeSubModal();
          this.refreshFamilyChildren(parentId);
        },
        error: (err) =>
          this.notify.error(err?.error?.message || 'Error al crear'),
      });
  }

  deleteSub(sub: ItemCategory, familyId: string) {
    const m = sub._count?.items ?? 0;
    if (
      !confirm(
        `¿Eliminar la subcategoría "${sub.name}"?${m > 0 ? ` Tiene ${m} artículo(s).` : ''}`,
      )
    ) {
      return;
    }
    this.items.deleteCategory(sub.id).subscribe({
      next: () => {
        this.notify.success('Subcategoría eliminada');
        this.refreshFamilyChildren(familyId);
      },
      error: (err) =>
        this.notify.error(err?.error?.message || 'No se puede eliminar'),
    });
  }
}
