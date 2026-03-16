import { Injectable, signal, computed } from '@angular/core';

export type CatalogCategory =
  | 'EQUIPMENT_TYPES'
  | 'BRANDS'
  | 'SYSTEMS'
  | 'FLUIDS';

export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  category: CatalogCategory;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CatalogService {
  // Estado global de los catálogos (Más adelante, se llenará con un HTTP GET al backend)
  private catalogsSignal = signal<CatalogItem[]>([
    {
      id: '1',
      code: 'EQ-01',
      name: 'CAMIONETA',
      category: 'EQUIPMENT_TYPES',
      isActive: true,
    },
    {
      id: '2',
      code: 'EQ-02',
      name: 'CAMIÓN ALJIBE',
      category: 'EQUIPMENT_TYPES',
      isActive: true,
    },
    {
      id: '3',
      code: 'EQ-03',
      name: 'BULLDOZER',
      category: 'EQUIPMENT_TYPES',
      isActive: true,
    },
    {
      id: '4',
      code: 'EQ-04',
      name: 'EXCAVADORA',
      category: 'EQUIPMENT_TYPES',
      isActive: true,
    },
    {
      id: '5',
      code: 'BR-01',
      name: 'TOYOTA',
      category: 'BRANDS',
      isActive: true,
    },
    {
      id: '6',
      code: 'BR-02',
      name: 'CATERPILLAR',
      category: 'BRANDS',
      isActive: true,
    },
    {
      id: '7',
      code: 'BR-03',
      name: 'FOTON',
      category: 'BRANDS',
      isActive: true,
    },
    {
      id: '8',
      code: 'SYS-01',
      name: 'MOTOR',
      category: 'SYSTEMS',
      isActive: true,
    },
    {
      id: '9',
      code: 'SYS-02',
      name: 'TRANSMISIÓN',
      category: 'SYSTEMS',
      isActive: true,
    },
    {
      id: '10',
      code: 'FLD-01',
      name: 'ACEITE DE MOTOR 15W40',
      category: 'FLUIDS',
      isActive: true,
    },
  ]);

  // Computed signals globales que cualquier componente puede leer
  public equipmentTypes = computed(() =>
    this.catalogsSignal().filter(
      (c) => c.category === 'EQUIPMENT_TYPES' && c.isActive,
    ),
  );

  public brands = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'BRANDS' && c.isActive),
  );

  public systems = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'SYSTEMS' && c.isActive),
  );

  public fluids = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'FLUIDS' && c.isActive),
  );

  // Método general para obtener todo el catálogo (usado por el administrador)
  public getAllCatalogs() {
    return this.catalogsSignal;
  }
}
