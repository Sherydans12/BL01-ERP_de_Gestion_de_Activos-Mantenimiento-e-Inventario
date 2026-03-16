import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import {
  CatalogService,
  CatalogCategory,
} from '../../../core/services/catalog/catalog.service';

@Component({
  selector: 'app-catalog-master',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './catalog-master.component.html',
})
export class CatalogMasterComponent {
  // Inyectamos el servicio global
  private catalogService = inject(CatalogService);

  activeCategory = signal<CatalogCategory>('EQUIPMENT_TYPES');

  categoryNames: Record<CatalogCategory, string> = {
    EQUIPMENT_TYPES: 'Tipos de Equipo',
    BRANDS: 'Marcas de Flota',
    SYSTEMS: 'Sistemas Intervenidos',
    FLUIDS: 'Fluidos y Aceites',
  };

  // Computamos la lista basándonos en el Signal del servicio
  activeItems = computed(() => {
    return this.catalogService
      .getAllCatalogs()()
      .filter((item) => item.category === this.activeCategory());
  });

  setCategory(category: CatalogCategory) {
    this.activeCategory.set(category);
  }
}
