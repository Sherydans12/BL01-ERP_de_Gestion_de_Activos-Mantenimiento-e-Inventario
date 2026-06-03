import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject, from, concatMap, catchError, of, tap } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  FaultReportsService,
  CreateFaultReportPayload,
  AffectedSystem,
  FaultCriticality,
  FaultReportRow,
  AFFECTED_SYSTEMS,
  FAULT_CRITICALITIES,
  SYSTEM_LABELS,
  CRITICALITY_META,
} from '../../../core/services/fault-reports/fault-reports.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { MeterReferenceBannerComponent } from '../../../shared/components/meter-reference-banner/meter-reference-banner.component';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import type { EquipmentMeterSnapshot } from '../../../core/models/types';

// ── Constantes de validación (espejo del backend) ────────────────────────────
const ATTACHMENT_MAX_BYTES  = 10 * 1024 * 1024; // 10 MB
const ATTACHMENT_MAX_COUNT  = 3;
const ATTACHMENT_ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4',
]);

@Component({
  selector: 'app-fault-report-form',
  standalone: true,
  imports: [
    CommonModule,
    NgClass,
    FormsModule,
    RouterLink,
    ConfirmModalComponent,
    MeterReferenceBannerComponent,
  ],
  templateUrl: './fault-report-form.component.html',
})
export class FaultReportFormComponent implements OnInit {
  protected readonly AFFECTED_SYSTEMS    = AFFECTED_SYSTEMS;
  protected readonly FAULT_CRITICALITIES = FAULT_CRITICALITIES;
  protected readonly SYSTEM_LABELS       = SYSTEM_LABELS;
  protected readonly CRITICALITY_META    = CRITICALITY_META;
  protected readonly ATTACHMENT_MAX_COUNT = ATTACHMENT_MAX_COUNT;

  private faultService = inject(FaultReportsService);
  private fleetService = inject(FleetService);
  private notify       = inject(NotificationService);
  private equipmentMeterSnapshotService = inject(EquipmentMeterSnapshotService);

  meterSnapshot = signal<EquipmentMeterSnapshot | null>(null);
  meterSnapshotLoading = signal(false);
  private lastSnapshotEquipmentId: string | null = null;

  // ── Catálogo de equipos ───────────────────────────────────────────────────
  equipments   = signal<any[]>([]);
  equipSearch  = signal('');
  equipLoading = signal(true);

  filteredEquipments = computed(() => {
    const q = this.equipSearch().toLowerCase().trim();
    if (!q) return this.equipments();
    return this.equipments().filter(
      (e) =>
        e.internalId?.toLowerCase().includes(q) ||
        e.brand?.toLowerCase().includes(q) ||
        e.model?.toLowerCase().includes(q) ||
        (e.plate ?? '').toLowerCase().includes(q),
    );
  });

  // ── Estado del formulario ─────────────────────────────────────────────────
  selectedEquipmentId  = signal<string>('');
  eventDate            = signal<string>(this.nowIso());
  meterAtFault         = signal<number | null>(null);
  selectedSystem       = signal<AffectedSystem | ''>('');
  selectedCriticality  = signal<FaultCriticality | ''>('');
  symptomDescription   = signal<string>('');

  isSubmitting = signal(false);

  selectedEquipmentLabel = computed(() => {
    const eq = this.equipments().find((e) => e.id === this.selectedEquipmentId());
    if (!eq) return '';
    const plate = eq.plate ? ` — ${eq.plate}` : '';
    return `${eq.internalId ?? ''} ${eq.brand ?? ''} ${eq.model ?? ''}${plate}`.trim();
  });

  isFormValid = computed(
    () =>
      !!this.selectedEquipmentId() &&
      !!this.eventDate() &&
      !!this.selectedSystem() &&
      !!this.selectedCriticality() &&
      this.symptomDescription().trim().length >= 10,
  );

  meterAtFaultBelowCurrent = computed(() => {
    const v = this.meterAtFault();
    const cur = this.meterSnapshot()?.currentMeter ?? null;
    if (v === null || cur === null) return false;
    return v < cur;
  });

  meterAtFaultRegressiveMessage = computed(() => {
    if (!this.meterAtFaultBelowCurrent()) return null;
    const cur = this.meterSnapshot()!.currentMeter;
    return `La lectura ingresada es inferior a la última registrada (${cur.toLocaleString('es-CL')}). Por favor, verifique.`;
  });

  isDirty = computed(
    () =>
      !!this.selectedEquipmentId() ||
      !!this.selectedSystem() ||
      !!this.selectedCriticality() ||
      this.symptomDescription().trim().length > 0 ||
      this.attachedFiles().length > 0,
  );

  // ── Adjuntos multimedia ───────────────────────────────────────────────────
  attachedFiles  = signal<File[]>([]);
  isDragOver     = signal(false);
  uploadProgress = signal<{ done: number; total: number } | null>(null);

  /** Texto del botón/spinner durante la subida. */
  uploadStatusText = computed(() => {
    const p = this.uploadProgress();
    if (!p) return '';
    return `Subiendo foto ${p.done + 1} de ${p.total}…`;
  });

  // ── CanDeactivate ─────────────────────────────────────────────────────────
  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  get maxDate(): string {
    return new Date().toISOString().slice(0, 16);
  }

  ngOnInit(): void {
    this.fleetService.getEquipments({ limit: 300 }).subscribe({
      next: (res) => {
        this.equipments.set(res.data ?? res);
        this.equipLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar los equipos.');
        this.equipLoading.set(false);
      },
    });
  }

  onSelectEquipment(id: string): void {
    this.selectedEquipmentId.set(id);
    this.equipSearch.set('');
    if (!id) {
      this.meterSnapshot.set(null);
      this.lastSnapshotEquipmentId = null;
      return;
    }
    this.loadMeterSnapshot(id);
  }

  private loadMeterSnapshot(equipmentId: string): void {
    if (
      equipmentId === this.lastSnapshotEquipmentId &&
      this.meterSnapshot() !== null
    ) {
      return;
    }
    this.lastSnapshotEquipmentId = equipmentId;
    this.meterSnapshotLoading.set(true);
    this.equipmentMeterSnapshotService.getSnapshot(equipmentId).subscribe({
      next: (s) => {
        this.meterSnapshot.set(s);
        this.meterSnapshotLoading.set(false);
      },
      error: () => {
        this.meterSnapshot.set(null);
        this.meterSnapshotLoading.set(false);
      },
    });
  }

  // ── Drag & Drop handlers ──────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files) this.addFiles(files);
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  }

  private addFiles(fileList: FileList): void {
    const current = this.attachedFiles();
    const slots   = ATTACHMENT_MAX_COUNT - current.length;

    if (slots <= 0) {
      this.notify.error(`Límite de ${ATTACHMENT_MAX_COUNT} archivos alcanzado.`);
      return;
    }

    const incoming = Array.from(fileList).slice(0, slots);
    const valid: File[] = [];

    for (const file of incoming) {
      const err = this.validateFile(file);
      if (err) {
        this.notify.error(`"${file.name}": ${err}`);
        continue;
      }
      valid.push(file);
    }

    if (valid.length) {
      this.attachedFiles.set([...current, ...valid]);
    }
  }

  private validateFile(file: File): string | null {
    if (!ATTACHMENT_ALLOWED_MIMES.has(file.type)) {
      return 'Formato no permitido. Usá JPG, PNG, WEBP o MP4.';
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      return 'El archivo supera el máximo de 10 MB.';
    }
    return null;
  }

  removeAttachment(index: number): void {
    const files = [...this.attachedFiles()];
    files.splice(index, 1);
    this.attachedFiles.set(files);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  isVideoFile(file: File): boolean {
    return file.type === 'video/mp4';
  }

  // ── Submit (reporte → adjuntos secuenciales) ──────────────────────────────

  submit(): void {
    if (!this.isFormValid() || this.isSubmitting()) return;

    const payload: CreateFaultReportPayload = {
      equipmentId:        this.selectedEquipmentId(),
      eventDate:          this.eventDate(),
      affectedSystem:     this.selectedSystem() as AffectedSystem,
      criticality:        this.selectedCriticality() as FaultCriticality,
      symptomDescription: this.symptomDescription().trim(),
      ...(this.meterAtFault() != null ? { meterAtFault: this.meterAtFault()! } : {}),
    };

    const files = this.attachedFiles();
    this.isSubmitting.set(true);
    this.uploadProgress.set(null);

    this.faultService.create(payload).subscribe({
      next: (report) => {
        if (files.length === 0) {
          this.onSubmitSuccess(report);
          return;
        }

        // Subida secuencial: si falla una, continuamos con las demás
        this.uploadProgress.set({ done: 0, total: files.length });

        from(files).pipe(
          concatMap((file, idx) =>
            this.faultService.uploadAttachment(report.id, file).pipe(
              tap(() => this.uploadProgress.set({ done: idx + 1, total: files.length })),
              catchError((err) => {
                const msg: string = err?.error?.message ?? `Error al subir "${file.name}".`;
                this.notify.error(msg);
                return of(null);
              }),
            ),
          ),
        ).subscribe({
          complete: () => this.onSubmitSuccess(report),
        });
      },
      error: (err) => {
        const msg: string = err?.error?.message ?? 'Ocurrió un error al registrar la falla.';
        this.notify.error(msg);
        this.isSubmitting.set(false);
      },
    });
  }

  private onSubmitSuccess(report: FaultReportRow): void {
    const criticality = this.selectedCriticality() as FaultCriticality;
    const woMsg = (criticality === 'HIGH' || criticality === 'MEDIUM')
      ? ' Se generó automáticamente una OT correctiva.'
      : '';
    this.notify.success(`Falla ${report.correlative} registrada.${woMsg}`);

    // Invalida la caché del Maestro de Flota para que `isOperational` y `currentMeter`
    // aparezcan actualizados al navegar a /flota, sin esperar a la re-creación del componente.
    // HIGH muta isOperational=false; MEDIUM puede afectar el horómetro si se reportó meterAtFault.
    // Ver MASTER-CONTEXT.md §2.4 y docs/agentes/decisiones.md «Integración Transversal».
    if (criticality === 'HIGH' || criticality === 'MEDIUM') {
      this.fleetService.invalidateCache();
    }

    this.resetForm();
    this.isSubmitting.set(false);
    this.uploadProgress.set(null);
  }

  resetForm(): void {
    this.onSelectEquipment('');
    this.equipSearch.set('');
    this.eventDate.set(this.nowIso());
    this.meterAtFault.set(null);
    this.selectedSystem.set('');
    this.selectedCriticality.set('');
    this.symptomDescription.set('');
    this.attachedFiles.set([]);
    this.uploadProgress.set(null);
  }

  private nowIso(): string {
    const d = new Date();
    return d.toISOString().slice(0, 16);
  }

  // ── CanDeactivate logic ───────────────────────────────────────────────────

  confirmLeaveIfDirty(): Observable<boolean> | boolean {
    if (!this.isDirty()) return true;
    this.leaveConfirmOpen.set(true);
    return this.leaveResult$.asObservable();
  }

  onLeaveConfirmed(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(true);
  }

  onLeaveCancelled(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(false);
  }
}
