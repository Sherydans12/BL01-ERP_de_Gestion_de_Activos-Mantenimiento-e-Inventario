import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import {
  EquipmentAvailabilityService,
  ImportCommitResult,
  ImportRowCommit,
  ImportValidationResult,
  SHIFT_LABELS,
  SHIFTS,
  STATUS_LABELS,
  ShiftType,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

export type ImportPageState =
  | 'idle'
  | 'validating'
  | 'preview'
  | 'committing'
  | 'done';

@Component({
  selector: 'app-availability-import',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './availability-import.component.html',
})
export class AvailabilityImportComponent {
  protected readonly SHIFT_LABELS = SHIFT_LABELS;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly SHIFTS = SHIFTS;

  private availabilityService = inject(EquipmentAvailabilityService);
  private notify = inject(NotificationService);

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  // ── State signals ─────────────────────────────────────────────────────────

  /** Fase actual del flujo de importación. */
  pageState = signal<ImportPageState>('idle');

  /** Fecha del turno que se exportará en la plantilla. */
  reportDate = signal<string>(this.todayIso());

  /** Turno que se exportará en la plantilla. */
  shift = signal<ShiftType>('DAY');

  /** Está generando y descargando la plantilla. */
  isExporting = signal(false);

  /** El usuario está arrastrando un archivo sobre la zona de drop. */
  isDragOver = signal(false);

  /** Resultado del dry-run (null mientras no haya archivo validado). */
  preview = signal<ImportValidationResult | null>(null);

  /** Resultado de la confirmación de importación. */
  commitResult = signal<ImportCommitResult | null>(null);

  // ── Computed ──────────────────────────────────────────────────────────────

  /**
   * Hay algo que importar: al menos una fila CREATE o UPDATE en la previsualización.
   * Si solo hay SKIPs y ERRORs, el botón "Confirmar" queda deshabilitado.
   */
  canCommit = computed(() => {
    const p = this.preview();
    return p != null && p.summary.toCreate + p.summary.toUpdate > 0;
  });

  /** Número de equipos que se importarán (CREATE + UPDATE). */
  commitCount = computed(() => {
    const p = this.preview();
    if (!p) return 0;
    return p.summary.toCreate + p.summary.toUpdate;
  });

  /** Hay filas con error bloqueante en la previsualización. */
  hasErrors = computed(() => (this.preview()?.summary.withErrors ?? 0) > 0);

  /** Hay filas con advertencia no bloqueante. */
  hasWarnings = computed(() => (this.preview()?.summary.withWarnings ?? 0) > 0);

  // ── Getters ────────────────────────────────────────────────────────────────

  get maxDate(): string {
    return this.todayIso();
  }

  // ── Excel Export ───────────────────────────────────────────────────────────

  exportTemplate(): void {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    this.availabilityService.exportTemplate(this.reportDate(), this.shift()).subscribe({
      next: () => this.isExporting.set(false),
      error: () => {
        this.notify.error('No se pudo generar la plantilla. Intenta de nuevo.');
        this.isExporting.set(false);
      },
    });
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.processFile(file);
  }

  /** Abre el selector de archivos nativo del sistema operativo. */
  triggerFilePicker(): void {
    this.fileInputRef.nativeElement.value = '';
    this.fileInputRef.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.processFile(file);
  }

  // ── File processing ────────────────────────────────────────────────────────

  private processFile(file: File): void {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.notify.error(
        'Solo se aceptan archivos .xlsx generados con la plantilla del sistema.',
      );
      return;
    }
    this.pageState.set('validating');
    this.preview.set(null);

    this.availabilityService.validateImport(file).subscribe({
      next: (result) => {
        this.preview.set(result);
        this.pageState.set('preview');
      },
      error: (err: { error?: { message?: string } }) => {
        const msg =
          err?.error?.message ??
          'Error al validar el archivo. Verifica que sea una plantilla del sistema.';
        this.notify.error(msg);
        this.pageState.set('idle');
      },
    });
  }

  // ── Commit ─────────────────────────────────────────────────────────────────

  /**
   * Envía las filas CREATE + UPDATE al backend.
   * Usa el reportDate y shift extraídos del archivo (preview), no los filtros UI.
   */
  commitImport(): void {
    const p = this.preview();
    if (!p || !this.canCommit() || this.pageState() === 'committing') return;

    const rowsToCommit: ImportRowCommit[] = p.rows
      .filter((r) => r.action === 'CREATE' || r.action === 'UPDATE')
      .map((r) => ({
        equipmentId: r.equipmentId!,
        status: r.status!,
        ...(r.meterReading != null ? { meterReading: r.meterReading } : {}),
        ...(r.comments ? { comments: r.comments } : {}),
      }));

    this.pageState.set('committing');

    this.availabilityService.commitImport(p.reportDate, p.shift, rowsToCommit).subscribe({
      next: (result) => {
        this.commitResult.set(result);
        this.pageState.set('done');
      },
      error: () => {
        this.notify.error('Error al importar. Verifica tu conexión e intenta de nuevo.');
        this.pageState.set('preview');
      },
    });
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Vuelve al estado inicial (desde la previsualización o done). */
  resetToIdle(): void {
    this.pageState.set('idle');
    this.preview.set(null);
    this.commitResult.set(null);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
