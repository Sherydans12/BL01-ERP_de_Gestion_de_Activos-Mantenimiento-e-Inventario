import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';
import {
  InventoryAnalyticsService,
  FullReportMetaResponse,
} from '../../../core/services/inventory-analytics/inventory-analytics.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { I } from '../../../core/constants/inventory-permissions';
import {
  INVENTORY_MASTER_REPORT_STORAGE_KEY,
  MASTER_REPORT_PRESETS,
  defaultMasterReportOptions,
  type InventoryMasterReportOptions,
  type MasterReportPresetId,
} from '../../../core/models/inventory-master-report-options';

@Component({
  selector: 'app-inventory-master-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './inventory-master-report.component.html',
})
export class InventoryMasterReportComponent implements OnInit {
  protected readonly i = I;
  readonly presetEntries = (
    Object.entries(MASTER_REPORT_PRESETS) as [
      MasterReportPresetId,
      (typeof MASTER_REPORT_PRESETS)[MasterReportPresetId],
    ][]
  ).map(([id, preset]) => ({ id, ...preset }));

  private analytics = inject(InventoryAnalyticsService);
  private notifications = inject(NotificationService);
  private auth = inject(AuthService);

  metaLoading = signal(true);
  downloadBusy = signal(false);
  meta = signal<FullReportMetaResponse | null>(null);

  options = signal<InventoryMasterReportOptions>(
    this.loadStoredOptions() ?? defaultMasterReportOptions(),
  );

  readonly hasReportPermission = computed(() =>
    this.auth.hasPermission(I.ANALYTICS_REPORT),
  );

  readonly selectedWarehouseCount = computed(
    () => this.options().warehouseIds.length,
  );

  readonly selectedFamilyCount = computed(
    () => this.options().familyNames.length,
  );

  readonly estimatedDetailHint = computed(() => {
    const m = this.meta();
    const o = this.options();
    if (!m || !o.sections.itemDetail) return null;
    let n = m.catalogItemCount;
    if (o.onlyWithStock) n = Math.min(n, m.catalogItemCount);
    if (o.familyNames.length) {
      const famSet = new Set(o.familyNames);
      const sum = m.families
        .filter((f) => famSet.has(f.familyName))
        .reduce((s, f) => s + (f.totalValue > 0 ? 1 : 0), 0);
      if (sum > 0) n = Math.min(n, m.catalogItemCount);
    }
    if (o.detailMaxRows != null) n = Math.min(n, o.detailMaxRows);
    return n;
  });

  readonly anySectionSelected = computed(() => {
    const s = this.options().sections;
    return (
      s.warehouseSummary ||
      s.familySummary ||
      s.criticalItems ||
      s.deadStock ||
      s.itemDetail ||
      s.purchases
    );
  });

  ngOnInit() {
    if (!this.hasReportPermission()) {
      this.metaLoading.set(false);
      return;
    }
    this.analytics.getFullReportMeta().subscribe({
      next: (res) => {
        this.meta.set(res);
        this.metaLoading.set(false);
      },
      error: () => {
        this.metaLoading.set(false);
        this.notifications.error(
          'No se pudo cargar los datos para configurar el reporte.',
        );
      },
    });
  }

  applyPreset(id: MasterReportPresetId) {
    const preset = MASTER_REPORT_PRESETS[id];
    this.options.set(structuredClone(preset.options));
    this.persistOptions();
  }

  toggleWarehouse(id: string, checked: boolean) {
    const current = this.options().warehouseIds;
    const next = checked
      ? [...current, id]
      : current.filter((w) => w !== id);
    this.patchOptions({ warehouseIds: next });
  }

  isWarehouseSelected(id: string): boolean {
    return this.options().warehouseIds.includes(id);
  }

  toggleFamily(name: string, checked: boolean) {
    const current = this.options().familyNames;
    const next = checked
      ? [...current, name]
      : current.filter((f) => f !== name);
    this.patchOptions({ familyNames: next });
  }

  isFamilySelected(name: string): boolean {
    return this.options().familyNames.includes(name);
  }

  selectAllWarehouses() {
    const ids = this.meta()?.warehouses.map((w) => w.id) ?? [];
    this.patchOptions({ warehouseIds: ids });
  }

  clearWarehouses() {
    this.patchOptions({ warehouseIds: [] });
  }

  selectAllFamilies() {
    const names = this.meta()?.families.map((f) => f.familyName) ?? [];
    this.patchOptions({ familyNames: names });
  }

  clearFamilies() {
    this.patchOptions({ familyNames: [] });
  }

  updateSection(
    key: keyof InventoryMasterReportOptions['sections'],
    value: boolean,
  ) {
    this.patchOptions({
      sections: { ...this.options().sections, [key]: value },
    });
  }

  patchOptions(partial: Partial<InventoryMasterReportOptions>) {
    this.options.update((o) => ({ ...o, ...partial }));
    this.persistOptions();
  }

  onOptionsFieldChange() {
    this.persistOptions();
  }

  download(format: 'pdf' | 'xlsx') {
    if (!this.hasReportPermission()) {
      this.notifications.error(
        'Requiere permiso inventory:analytics:report.',
      );
      return;
    }
    if (!this.anySectionSelected()) {
      this.notifications.warning('Seleccione al menos una sección.');
      return;
    }
    this.downloadBusy.set(true);
    const opts = this.options();
    this.analytics
      .downloadFullReport(format, opts)
      .pipe(finalize(() => this.downloadBusy.set(false)))
      .subscribe({
        next: (blob) => {
          if (!blob?.size) {
            this.notifications.error('Archivo vacío.');
            return;
          }
          const stamp = new Date().toISOString().slice(0, 10);
          const ext = format === 'pdf' ? 'pdf' : 'xlsx';
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = `valorizacion-maestro-${stamp}.${ext}`;
          a.click();
          URL.revokeObjectURL(url);
          this.notifications.success('Reporte generado.');
        },
        error: (err) => {
          void this.notifyDownloadError(err);
        },
      });
  }

  resetToDefaults() {
    this.options.set(defaultMasterReportOptions());
    this.persistOptions();
  }

  private loadStoredOptions(): InventoryMasterReportOptions | null {
    try {
      const raw = localStorage.getItem(INVENTORY_MASTER_REPORT_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as InventoryMasterReportOptions;
    } catch {
      return null;
    }
  }

  private persistOptions() {
    try {
      localStorage.setItem(
        INVENTORY_MASTER_REPORT_STORAGE_KEY,
        JSON.stringify(this.options()),
      );
    } catch {
      /* quota / private mode */
    }
  }

  private async notifyDownloadError(err: unknown) {
    const msg = await this.extractHttpBlobErrorMessage(err);
    this.notifications.error(msg || 'No se pudo generar el reporte maestro.');
  }

  private async extractHttpBlobErrorMessage(err: unknown): Promise<string> {
    if (!(err instanceof HttpErrorResponse)) return '';
    const body = err.error;
    if (body instanceof Blob) {
      try {
        const text = await body.text();
        const parsed = JSON.parse(text) as { message?: string | string[] };
        const m = parsed.message;
        if (Array.isArray(m)) return m.join('. ');
        if (typeof m === 'string' && m.trim()) return m;
      } catch {
        return '';
      }
    }
    if (err.status === 403) return 'Sin permiso para el reporte maestro.';
    return '';
  }
}
