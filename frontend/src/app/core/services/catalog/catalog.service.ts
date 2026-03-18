import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export type CatalogCategory =
  | 'EQUIPMENT_TYPE'
  | 'BRAND'
  | 'SYSTEM'
  | 'FLUID'
  | 'FUEL_TYPE'
  | 'DRIVE_TYPE'
  | 'OWNERSHIP';

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
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/catalogs';

  // Signal central que almacenará los datos de la BD
  private catalogsSignal = signal<CatalogItem[]>([]);

  // Computed signals para los dropdowns y checkboxes
  public equipmentTypes = computed(() =>
    this.catalogsSignal().filter(
      (c) => c.category === 'EQUIPMENT_TYPE' && c.isActive,
    ),
  );
  public brands = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'BRAND' && c.isActive),
  );
  public systems = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'SYSTEM' && c.isActive),
  );
  public fluids = computed(() =>
    this.catalogsSignal().filter((c) => c.category === 'FLUID' && c.isActive),
  );
  public fuelTypes = computed(() =>
    this.catalogsSignal().filter(
      (c) => c.category === 'FUEL_TYPE' && c.isActive,
    ),
  );
  public driveTypes = computed(() =>
    this.catalogsSignal().filter(
      (c) => c.category === 'DRIVE_TYPE' && c.isActive,
    ),
  );
  public ownerships = computed(() =>
    this.catalogsSignal().filter(
      (c) => c.category === 'OWNERSHIP' && c.isActive,
    ),
  );

  // Método para cargar desde el backend
  loadCatalogs(): Observable<CatalogItem[]> {
    return this.http
      .get<CatalogItem[]>(this.apiUrl)
      .pipe(tap((data) => this.catalogsSignal.set(data)));
  }

  // POST: Crear un nuevo ítem y actualizar el Signal
  createItem(data: Omit<CatalogItem, 'id'>): Observable<CatalogItem> {
    return this.http
      .post<CatalogItem>(this.apiUrl, data)
      .pipe(
        tap((newItem) =>
          this.catalogsSignal.update((prev) => [...prev, newItem]),
        ),
      );
  }

  // PATCH: Actualizar un ítem y actualizar el Signal
  updateItem(id: string, data: Partial<CatalogItem>): Observable<CatalogItem> {
    return this.http.patch<CatalogItem>(`${this.apiUrl}/${id}`, data).pipe(
      tap((updatedItem) => {
        this.catalogsSignal.update((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, ...updatedItem } : item,
          ),
        );
      }),
    );
  }

  // DELETE: Eliminar un ítem y actualizar el Signal
  deleteItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      tap(() => {
        this.catalogsSignal.update((prev) =>
          prev.filter((item) => item.id !== id),
        );
      }),
    );
  }

  // Obtenemos el Signal completo para la vista de Administración
  getAllCatalogs() {
    return this.catalogsSignal;
  }
}
