import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { FleetService } from '../../core/services/fleet/fleet.service';
import { CatalogService } from '../../core/services/catalog/catalog.service';
import { ContractsService } from '../../core/services/contracts/contracts.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { O } from '../../core/constants/operations-permissions';
import { NotificationService } from '../../core/services/notification/notification.service';
import type {
  Contract,
  MeterBulkSyncErrorItem,
  MeterCaptureBoardRow,
} from '../../core/models/types';

const DRAFT_STORAGE_KEY = 'bl01-meter-capture-draft';

interface MeterDraftPayload {
  v: 1;
  userId: string;
  readings: Record<string, number>;
  lastWrittenWhileOffline: boolean;
}

@Component({
  selector: 'app-registro-horas',
  standalone: true,
  imports: [CommonModule, FormsModule, HasPermissionDirective],
  templateUrl: './registro-horas.component.html',
  styleUrl: './registro-horas.component.scss',
})
export class RegistroHorasComponent implements OnInit, OnDestroy {
  protected readonly o = O;

  readonly canRegisterMeters = computed(() =>
    this.auth.hasPermission(O.METER_READING_CREATE),
  );

  private readonly fleet = inject(FleetService);
  private readonly catalogs = inject(CatalogService);
  private readonly contractsApi = inject(ContractsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  boardRows = signal<MeterCaptureBoardRow[]>([]);
  /** Texto libre por equipo (input); vacío = sin cambio local. */
  readings = signal<Record<string, string>>({});
  searchText = signal('');
  categoryType = signal('');
  /** null = solo cabeceras HTTP globales; string = forzar `x-contract-id` en esta vista. */
  contractScopeId = signal<string | null>(null);
  contracts = signal<Contract[]>([]);
  loading = signal(false);
  syncing = signal(false);
  isOnline = signal(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  /**
   * Tras un bulk parcial: solo filas con error; el medidor `currentMeter` refleja el valor en BD.
   */
  conflictOnlyMode = signal(false);

  showContractPicker = computed(() => {
    const r = this.auth.currentUser()?.role;
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
  });

  pendingSyncCount = computed(() => {
    let n = 0;
    for (const row of this.boardRows()) {
      const parsed = this.parseReadingInt(this.readings()[row.id]);
      if (parsed === null) continue;
      if (parsed < row.currentMeter) continue;
      if (parsed !== row.currentMeter) n += 1;
    }
    return n;
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!this.hasNavigationBlock()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const win = this.document.defaultView;
      win?.addEventListener('online', this.onBrowserOnline);
      win?.addEventListener('offline', this.onBrowserOffline);
      win?.addEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  ngOnInit(): void {
    this.catalogs
      .loadCatalogs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
    if (this.showContractPicker()) {
      this.contractsApi
        .findAll()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (rows) => this.contracts.set(rows),
          error: () => this.contracts.set([]),
        });
    }
    this.loadBoard();
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      const win = this.document.defaultView;
      win?.removeEventListener('online', this.onBrowserOnline);
      win?.removeEventListener('offline', this.onBrowserOffline);
      win?.removeEventListener('beforeunload', this.onBeforeUnload);
    }
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  /** Guard `canDeactivate` + comprobación explícita si se reusa. */
  confirmLeaveIfDraft(): boolean {
    if (!isPlatformBrowser(this.platformId)) return true;
    this.persistDraft();
    if (!this.hasNavigationBlock()) return true;
    return !!this.document.defaultView?.confirm(
      'Tienes registros pendientes de sincronización. ¿Seguro que quieres salir?',
    );
  }

  hasNavigationBlock(): boolean {
    if (this.pendingSyncCount() > 0) return true;
    const draft = this.readDraftPayload();
    if (!draft) return false;
    if (Object.keys(draft.readings).length > 0) return true;
    return !!draft.lastWrittenWhileOffline;
  }

  private readonly onBrowserOnline = () => {
    this.isOnline.set(true);
    if (this.pendingSyncCount() > 0) {
      this.notify.info(
        'Conexión recuperada. Pulse «Sincronizar lecturas» para subir los datos guardados.',
        8000,
      );
    }
  };

  private readonly onBrowserOffline = () => {
    this.isOnline.set(false);
    this.persistDraft();
  };

  equipmentTypesSorted = computed(() =>
    [...this.catalogs.equipmentTypes()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  );

  syncButtonLabel(): string {
    if (this.syncing()) return 'Sincronizando…';
    if (!this.isOnline()) return 'Guardar en Local';
    return 'Sincronizar lecturas';
  }

  /**
   * Recarga el tablero completo (sale del modo resolución de conflictos).
   */
  reloadFullList(): void {
    this.loadBoard({ exitConflictMode: true });
  }

  loadBoard(options?: { exitConflictMode?: boolean }): void {
    if (options?.exitConflictMode) {
      this.conflictOnlyMode.set(false);
    } else if (this.conflictOnlyMode()) {
      return;
    }

    const user = this.auth.currentUser();
    if (!user) return;

    this.loading.set(true);
    const scope = this.contractScopeId();
    this.fleet
      .getMeterCaptureBoard(
        {
          type: this.categoryType() || undefined,
          search: this.searchText().trim() || undefined,
          limit: 1000,
        },
        { contractId: scope ?? undefined },
      )
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.boardRows.set(res.data);
          this.mergeDraftIntoReadings();
        },
        error: (err) => {
          this.notify.error(
            err?.error?.message ??
              'No se pudo cargar el listado de equipos. Intente nuevamente.',
          );
        },
      });
  }

  onSearchInput(value: string): void {
    if (this.conflictOnlyMode()) return;
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadBoard(), 400);
  }

  onCategoryChange(value: string): void {
    if (this.conflictOnlyMode()) return;
    this.categoryType.set(value);
    this.loadBoard();
  }

  onContractScopeChange(value: string): void {
    if (this.conflictOnlyMode()) return;
    this.contractScopeId.set(value === '' ? null : value);
    this.loadBoard();
  }

  readingFor(id: string): string {
    return this.readings()[id] ?? '';
  }

  updateReading(id: string, raw: string | number): void {
    this.readings.update((m) => ({ ...m, [id]: String(raw ?? '') }));
    this.persistDraft();
  }

  rowHasInvalidReading(row: MeterCaptureBoardRow): boolean {
    const raw = this.readings()[row.id];
    if (raw === undefined || raw === null || raw.trim() === '') return false;
    const n = this.parseReadingInt(raw);
    if (n === null) return true;
    return n < row.currentMeter;
  }

  scanQrPlaceholder(): void {
    this.notify.info(
      'Escanear QR: próximamente. Se enfocará la lectura de la fila del equipo escaneado.',
      6000,
    );
  }

  focusReadingInput(equipmentId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const el = this.document.getElementById(
      `meter-reading-${equipmentId}`,
    ) as HTMLInputElement | null;
    el?.focus();
    el?.select?.();
  }

  syncReadings(): void {
    if (!this.isOnline()) {
      this.persistDraft();
      this.notify.warning(
        'Sin conexión. Las lecturas quedaron guardadas en este equipo; sincronice al volver la red.',
        7000,
      );
      return;
    }

    const items: { equipmentId: string; newReading: number }[] = [];
    for (const row of this.boardRows()) {
      const raw = this.readings()[row.id];
      const n = this.parseReadingInt(raw);
      if (n === null) continue;
      if (n < row.currentMeter) {
        this.notify.error(
          `Corrija las lecturas inferiores al medidor actual (equipo ${row.internalId}).`,
        );
        return;
      }
      if (n !== row.currentMeter) {
        items.push({ equipmentId: row.id, newReading: n });
      }
    }

    if (items.length === 0) {
      this.notify.info('No hay lecturas nuevas que sincronizar.');
      return;
    }

    const prevRows = [...this.boardRows()];

    this.syncing.set(true);
    const scope = this.contractScopeId();
    this.fleet
      .bulkSyncMeterReadings({ items }, { contractId: scope ?? undefined })
      .pipe(
        finalize(() => this.syncing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const appliedIds = res.applied.map((a) => a.equipmentId);
          this.clearDraftEntries(appliedIds);

          const orphanErrors = res.errors.filter(
            (e) => !prevRows.some((r) => r.id === e.equipmentId),
          );

          if (res.errors.length > 0) {
            this.conflictOnlyMode.set(true);
            const failedRows = this.buildConflictRows(prevRows, res.errors);
            this.boardRows.set(failedRows);

            const msg = [
              `${res.successCount} lectura(s) aplicadas en servidor.`,
              res.errors.length > 0
                ? `${res.errors.length} con conflicto: revise la tabla.`
                : '',
              orphanErrors.length
                ? `${orphanErrors.length} id(s) no visibles en el listado (revise permisos o contrato).`
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            this.notify.warning(msg, 9000);
          } else {
            this.conflictOnlyMode.set(false);
            this.notify.success(
              `Sincronizado: ${res.successCount} lectura(s) aplicadas${
                res.unchangedCount
                  ? `, ${res.unchangedCount} sin cambio respecto a BD`
                  : ''
              }.`,
            );
            this.loadBoard({ exitConflictMode: true });
          }

          if (orphanErrors.length > 0) {
            this.notify.info(
              `Equipos no resueltos en pantalla: ${orphanErrors
                .map((e) => e.equipmentId.slice(0, 8))
                .join(', ')}…`,
              8000,
            );
          }
        },
        error: (err) => {
          this.notify.error(
            err?.error?.message ??
              'Error al sincronizar lecturas. Revise los datos e intente nuevamente.',
          );
        },
      });
  }

  private buildConflictRows(
    prevRows: MeterCaptureBoardRow[],
    errors: MeterBulkSyncErrorItem[],
  ): MeterCaptureBoardRow[] {
    const out: MeterCaptureBoardRow[] = [];
    for (const e of errors) {
      const prev = prevRows.find((r) => r.id === e.equipmentId);
      if (!prev) continue;
      const serverVal =
        e.error === 'READING_LOWER_THAN_CURRENT' &&
        e.serverValue !== undefined
          ? e.serverValue
          : prev.currentMeter;
      out.push({ ...prev, currentMeter: serverVal });
    }
    return out;
  }

  private parseReadingInt(raw: string | undefined): number | null {
    if (raw === undefined || raw === null || raw.trim() === '') return null;
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
    return n;
  }

  private readDraftPayload(): MeterDraftPayload | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const uid = this.auth.currentUser()?.id;
    if (!uid) return null;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MeterDraftPayload;
      if (parsed?.v !== 1 || parsed.userId !== uid) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private mergeDraftIntoReadings(): void {
    const draft = this.readDraftPayload();
    if (!draft?.readings) return;
    this.readings.update((current) => {
      const next = { ...current };
      for (const row of this.boardRows()) {
        const v = draft.readings[row.id];
        if (v === undefined) continue;
        next[row.id] = String(v);
      }
      return next;
    });
  }

  private persistDraft(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const uid = this.auth.currentUser()?.id;
    if (!uid) return;

    const readings: Record<string, number> = {};
    for (const row of this.boardRows()) {
      const n = this.parseReadingInt(this.readings()[row.id]);
      if (n !== null) readings[row.id] = n;
    }

    const offline = !this.isOnline();
    const prev = this.readDraftPayload();
    const payload: MeterDraftPayload = {
      v: 1,
      userId: uid,
      readings,
      lastWrittenWhileOffline:
        offline || (prev?.lastWrittenWhileOffline ?? false),
    };

    if (
      Object.keys(readings).length === 0 &&
      !payload.lastWrittenWhileOffline
    ) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }

    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota / modo privado */
    }
  }

  /** Quita borrador local y valores en memoria solo para los ids sincronizados OK. */
  private clearDraftEntries(equipmentIds: string[]): void {
    this.readings.update((m) => {
      const next = { ...m };
      for (const id of equipmentIds) {
        delete next[id];
      }
      return next;
    });
    this.persistDraft();
  }
}
