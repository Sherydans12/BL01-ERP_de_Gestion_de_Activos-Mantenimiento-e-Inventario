import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import {
  InventoryImportCommitResult,
  InventoryImportValidationResult,
  InventoryItemsService,
} from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

type ImportState = 'idle' | 'validating' | 'preview' | 'committing' | 'done';

@Component({
  selector: 'app-inventory-master-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="space-y-6 pb-10">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-[10px] font-mono uppercase tracking-widest text-primary">BaseLogic · Inventario</p>
          <h1 class="text-2xl font-bold text-main tracking-tight">Importar ajustes de stock</h1>
          <p class="mt-1 text-sm text-muted max-w-3xl">
            Valida stock físico, ubicación, bins y umbrales por bodega para artículos existentes. El catálogo se crea y edita dentro del sistema.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <a routerLink="/app/inventario/stock" class="rounded-lg border border-border bg-dark px-4 py-2 text-sm font-mono text-muted hover:bg-surface">STOCK</a>
          <a routerLink="/app/articulos" class="rounded-lg border border-border bg-dark px-4 py-2 text-sm font-mono text-muted hover:bg-surface">ARTÍCULOS</a>
        </div>
      </div>

      <section class="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div class="flex-1">
            <label class="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1">Archivo Excel</label>
            <input
              type="file"
              accept=".xlsx"
              (change)="onFileSelected($event)"
              class="block w-full rounded-lg border border-border bg-dark px-3 py-2.5 text-sm text-main file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:font-mono file:text-xs file:font-bold file:text-dark"
            />
            @if (file()) { <p class="mt-2 text-xs text-muted">{{ file()!.name }}</p> }
          </div>
          <button
            type="button"
            (click)="validate()"
            [disabled]="!file() || state() === 'validating' || state() === 'committing'"
            class="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold font-mono text-dark shadow-sm transition disabled:opacity-50"
          >
            @if (state() === 'validating') { VALIDANDO... } @else { VALIDAR ARCHIVO }
          </button>
        </div>
      </section>

      @if (preview(); as p) {
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Filas</p><p class="text-xl font-bold text-main">{{ p.summary.rows }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Nuevos bloqueados</p><p class="text-xl font-bold text-red-300">{{ p.summary.creates }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Ajustes stock</p><p class="text-xl font-bold text-main">{{ p.summary.updates }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Sin cambios</p><p class="text-xl font-bold text-main">{{ p.summary.unchanged }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Errores</p><p class="text-xl font-bold" [class.text-red-400]="p.summary.errors">{{ p.summary.errors }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Bajas</p><p class="text-xl font-bold text-muted">0</p></div>
        </section>

        <section class="rounded-xl border border-border bg-surface p-4">
          <h2 class="text-sm font-bold text-main mb-3">Reglas de importación</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" [(ngModel)]="options.allowStockAdjustments" /> Ajustar stock con kardex</label>
            <label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" [(ngModel)]="options.autoCreateBins" /> Crear bins faltantes</label>
          </div>
          <p class="mt-3 text-xs text-muted">
            El Excel no crea, edita ni elimina artículos. Si cambia nombre, categoría, unidad, número de parte, flags, proveedor, SKU o QR, la fila queda bloqueada. CPP es informativo y no se importa.
          </p>
        </section>

        @if (p.requirements.length) {
          <section class="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4">
            <h2 class="text-sm font-bold text-amber-100 mb-3">Requisitos por resolver</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase text-amber-200"><tr><th class="py-2">Tipo</th><th>Código</th><th>Padre</th><th>Filas</th><th>Mensaje</th></tr></thead>
                <tbody class="divide-y divide-amber-500/20">
                  @for (r of p.requirements; track r.kind + r.code + r.parentCode) {
                    <tr><td class="py-2">{{ r.kind }}</td><td class="font-mono">{{ r.code }}</td><td>{{ r.parentCode || '—' }}</td><td>{{ r.rows.join(', ') }}</td><td>{{ r.message }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        <section class="rounded-xl border border-border bg-surface overflow-hidden">
          <div class="flex items-center justify-between border-b border-border p-4">
            <div>
              <h2 class="text-sm font-bold text-main">Vista previa artículo/bodega</h2>
              <p class="mt-1 text-xs text-muted">
                Se priorizan errores y ajustes permitidos. Los cambios estructurales se bloquean antes de confirmar.
              </p>
            </div>
            <button type="button" (click)="commit()" [disabled]="!canCommit()" class="rounded-lg bg-primary px-5 py-2 text-sm font-bold font-mono text-dark disabled:opacity-50">
              @if (state() === 'committing') { IMPORTANDO... } @else { CONFIRMAR IMPORTACIÓN }
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-dark text-xs uppercase text-muted"><tr><th class="px-4 py-3">Fila</th><th>Acción</th><th>Artículo</th><th>Bodega</th><th>Cambios</th><th>Errores / advertencias</th></tr></thead>
              <tbody class="divide-y divide-border/50">
                @for (row of visiblePreviewRows(p); track row.rowNumber) {
                  <tr>
                    <td class="px-4 py-3 font-mono">{{ row.rowNumber }}</td>
                    <td><span [class]="actionClass(row.action)">{{ row.action }}</span></td>
                    <td class="min-w-72"><p class="text-main">{{ row.label }}</p><p class="font-mono text-xs text-muted">{{ row.itemId || 'artículo no resuelto' }}</p></td>
                    <td class="font-mono text-xs">{{ row.warehouseCode || '—' }}</td>
                    <td>{{ row.changes.length }}</td>
                    <td class="min-w-96">
                      @for (e of row.errors; track e) { <p class="text-xs text-red-300">{{ e }}</p> }
                      @for (w of row.warnings; track w) { <p class="text-xs text-amber-200">{{ w }}</p> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (p.previewRows.length > visiblePreviewRows(p).length) {
            <p class="border-t border-border px-4 py-3 text-xs text-muted">
              Mostrando {{ visiblePreviewRows(p).length }} de {{ p.previewRows.length }} filas, con prioridad en acciones que requieren revisión.
            </p>
          }
        </section>
      }

      @if (commitResult(); as result) {
        <section class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Importación finalizada: {{ result.stockAdjusted }} ajustes de stock con kardex, {{ result.updated }} filas de stock revisadas, {{ result.unchanged || 0 }} sin cambios.
        </section>
      }
    </div>
  `,
})
export class InventoryMasterImportComponent {
  private inventoryService = inject(InventoryItemsService);
  private notify = inject(NotificationService);

  state = signal<ImportState>('idle');
  file = signal<File | null>(null);
  preview = signal<InventoryImportValidationResult | null>(null);
  commitResult = signal<InventoryImportCommitResult | null>(null);

  options = {
    allowStockAdjustments: true,
    autoCreateBins: true,
  };

  canCommit = computed(() => {
    const p = this.preview();
    return !!p && p.summary.errors === 0 && this.state() !== 'committing';
  });

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.file.set(file);
    this.preview.set(null);
    this.commitResult.set(null);
    this.state.set('idle');
  }

  validate(): void {
    const file = this.file();
    if (!file) return;
    this.state.set('validating');
    this.inventoryService
      .validateInventoryMasterImport(file)
      .pipe(finalize(() => this.state.set(this.preview() ? 'preview' : 'idle')))
      .subscribe({
        next: (preview) => this.preview.set(preview),
        error: (err) => this.notify.error(err?.error?.message ?? 'No se pudo validar el Excel.'),
      });
  }

  commit(): void {
    const file = this.file();
    if (!file || !this.canCommit()) return;
    this.state.set('committing');
    this.inventoryService.commitInventoryMasterImport(file, this.options).subscribe({
      next: (result) => {
        this.commitResult.set(result);
        this.state.set('done');
        this.notify.success('Importación de inventario completada.');
      },
      error: (err) => {
        this.notify.error(err?.error?.message ?? 'No se pudo confirmar la importación.');
        this.state.set('preview');
      },
    });
  }

  actionClass(action: string): string {
    const base = 'inline-flex rounded-full px-2 py-1 text-[10px] font-bold font-mono';
    if (action === 'ERROR') return `${base} bg-red-500/15 text-red-300`;
    if (action === 'CREATE') return `${base} bg-red-500/15 text-red-300`;
    if (action === 'UPDATE') return `${base} bg-amber-500/15 text-amber-200`;
    return `${base} bg-slate-500/15 text-muted`;
  }

  visiblePreviewRows(preview: InventoryImportValidationResult) {
    const priority: Record<string, number> = {
      ERROR: 0,
      CREATE: 1,
      UPDATE: 2,
      NO_CHANGE: 3,
    };
    return [...preview.previewRows]
      .sort(
        (a, b) =>
          (priority[a.action] ?? 9) - (priority[b.action] ?? 9) ||
          a.rowNumber - b.rowNumber,
      )
      .slice(0, 160);
  }

  impactText(impact: Record<string, number>): string {
    return Object.entries(impact)
      .filter(([, count]) => Number(count) > 0)
      .map(([key, count]) => `${key}: ${count}`)
      .join(' · ') || 'sin asociaciones';
  }
}
