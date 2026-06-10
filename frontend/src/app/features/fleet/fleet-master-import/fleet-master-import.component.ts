import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import {
  FleetImportValidationResult,
  FleetService,
  MasterImportCommitResult,
} from '../../../core/services/fleet/fleet.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

type ImportState = 'idle' | 'validating' | 'preview' | 'committing' | 'done';

@Component({
  selector: 'app-fleet-master-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="space-y-6 pb-10">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-[10px] font-mono uppercase tracking-widest text-primary">BaseLogic · Maestro</p>
          <h1 class="text-2xl font-bold text-main tracking-tight">Importar flota desde Excel</h1>
          <p class="mt-1 text-sm text-muted max-w-3xl">
            Valida contratos, subcontratos, tipos de equipo, cambios por fila y bajas detectadas antes de escribir en la base.
          </p>
        </div>
        <a routerLink="/app/flota" class="inline-flex items-center justify-center rounded-lg border border-border bg-dark px-4 py-2 text-sm font-mono text-muted hover:bg-surface">
          VOLVER
        </a>
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
            @if (file()) {
              <p class="mt-2 text-xs text-muted">{{ file()!.name }}</p>
            }
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
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Altas</p><p class="text-xl font-bold text-main">{{ p.summary.creates }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Cambios</p><p class="text-xl font-bold text-main">{{ p.summary.updates }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Sin cambios</p><p class="text-xl font-bold text-main">{{ p.summary.unchanged }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Errores</p><p class="text-xl font-bold" [class.text-red-400]="p.summary.errors">{{ p.summary.errors }}</p></div>
          <div class="rounded-lg border border-border bg-surface p-3"><p class="text-xs text-muted">Bajas detectadas</p><p class="text-xl font-bold text-amber-300">{{ p.summary.deleteCandidates }}</p></div>
        </section>

        <section class="rounded-xl border border-border bg-surface p-4">
          <h2 class="text-sm font-bold text-main mb-3">Configuración de importación</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" [(ngModel)]="options.allowCreates" /> Permitir altas</label>
            <label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" [(ngModel)]="options.allowUpdates" /> Permitir actualizaciones</label>
            <label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" [(ngModel)]="options.allowDeletes" /> Procesar bajas ausentes</label>
            <label class="flex items-center gap-2 text-sm text-amber-200"><input type="checkbox" [(ngModel)]="options.forceDeleteWithAssociations" /> Borrado destructivo con historial</label>
          </div>
        </section>

        @if (p.requirements.length) {
          <section class="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4">
            <h2 class="text-sm font-bold text-amber-100 mb-3">Requisitos por resolver</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase text-amber-200"><tr><th class="py-2">Tipo</th><th>Código</th><th>Filas</th><th>Severidad</th><th>Mensaje</th></tr></thead>
                <tbody class="divide-y divide-amber-500/20">
                  @for (r of p.requirements; track r.kind + r.code) {
                    <tr><td class="py-2">{{ r.kind }}</td><td class="font-mono">{{ r.code }}</td><td>{{ r.rows.join(', ') }}</td><td>{{ r.severity }}</td><td>{{ r.message }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        @if (p.deleteCandidates.length) {
          <section class="rounded-xl border border-red-500/35 bg-red-500/10 p-4">
            <h2 class="text-sm font-bold text-red-100 mb-3">Bajas detectadas</h2>
            <div class="max-h-72 overflow-auto">
              @for (d of p.deleteCandidates; track d.equipmentId) {
                <div class="border-b border-red-500/20 py-3">
                  <p class="font-mono text-sm text-main">{{ d.internalId }} · {{ d.label }}</p>
                  <p class="mt-1 text-xs text-red-100">Impacto: {{ impactText(d.impact) }}</p>
                </div>
              }
            </div>
          </section>
        }

        <section class="rounded-xl border border-border bg-surface overflow-hidden">
          <div class="flex items-center justify-between border-b border-border p-4">
            <h2 class="text-sm font-bold text-main">Vista previa por fila</h2>
            <button type="button" (click)="commit()" [disabled]="!canCommit()" class="rounded-lg bg-primary px-5 py-2 text-sm font-bold font-mono text-dark disabled:opacity-50">
              @if (state() === 'committing') { IMPORTANDO... } @else { CONFIRMAR IMPORTACIÓN }
            </button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-dark text-xs uppercase text-muted"><tr><th class="px-4 py-3">Fila</th><th>Acción</th><th>Equipo</th><th>Cambios</th><th>Errores / advertencias</th></tr></thead>
              <tbody class="divide-y divide-border/50">
                @for (row of p.previewRows.slice(0, 120); track row.rowNumber) {
                  <tr>
                    <td class="px-4 py-3 font-mono">{{ row.rowNumber }}</td>
                    <td><span [class]="actionClass(row.action)">{{ row.action }}</span></td>
                    <td class="min-w-72"><p class="text-main">{{ row.label }}</p><p class="font-mono text-xs text-muted">{{ row.equipmentId || 'nuevo' }}</p></td>
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
        </section>
      }

      @if (commitResult(); as result) {
        <section class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Importación finalizada: {{ result.created }} creados, {{ result.updated }} actualizados, {{ result.deleted }} eliminados.
        </section>
      }
    </div>
  `,
})
export class FleetMasterImportComponent {
  private fleetService = inject(FleetService);
  private auth = inject(AuthService);
  private notify = inject(NotificationService);

  state = signal<ImportState>('idle');
  file = signal<File | null>(null);
  preview = signal<FleetImportValidationResult | null>(null);
  commitResult = signal<MasterImportCommitResult | null>(null);

  options = {
    allowCreates: true,
    allowUpdates: true,
    allowDeletes: false,
    forceDeleteWithAssociations: false,
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
    const contractId = this.auth.currentContractId();
    this.fleetService
      .validateFleetMasterImport(file, {
        contractId: contractId && contractId !== 'ALL' ? contractId : null,
      })
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
    const contractId = this.auth.currentContractId();
    this.fleetService
      .commitFleetMasterImport(file, this.options, {
        contractId: contractId && contractId !== 'ALL' ? contractId : null,
      })
      .subscribe({
        next: (result) => {
          this.commitResult.set(result);
          this.state.set('done');
          this.notify.success('Importación de flota completada.');
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
    if (action === 'CREATE') return `${base} bg-emerald-500/15 text-emerald-300`;
    if (action === 'UPDATE') return `${base} bg-amber-500/15 text-amber-200`;
    return `${base} bg-slate-500/15 text-muted`;
  }

  impactText(impact: Record<string, number>): string {
    return Object.entries(impact)
      .filter(([, count]) => Number(count) > 0)
      .map(([key, count]) => `${key}: ${count}`)
      .join(' · ') || 'sin asociaciones';
  }
}
