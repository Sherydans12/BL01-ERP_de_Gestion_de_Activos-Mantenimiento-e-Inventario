import {
  Component,
  inject,
  input,
  effect,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { MAX_UPLOAD_FILE_BYTES } from '../../../core/constants/file-upload.constants';
import { P } from '../../../core/constants/purchases-permissions';

export type PurchaseDocumentEntity =
  | 'REQUISITION'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_INVOICE';

export interface PurchaseDocumentRow {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  downloadUrl?: string;
  uploadedBy?: { id: string; name: string; email?: string | null };
}

@Component({
  selector: 'app-purchase-documents-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="rounded-xl border border-border/80 bg-surface/80 p-5 mt-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 class="text-lg font-semibold text-main">{{ title() }}</h2>
          <p class="text-xs text-muted mt-0.5">
            Máximo 20MB. Todos los formatos permitidos.
          </p>
        </div>
        @if (canManage()) {
          <label
            class="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium cursor-pointer hover:bg-primary/20"
          >
            Subir archivo
            <input
              type="file"
              class="sr-only"
              (change)="onFileSelected($event)"
            />
          </label>
        }
      </div>

      @if (loading()) {
        <div class="flex justify-center py-6">
          <div
            class="animate-spin rounded-full h-7 w-7 border-b-2 border-primary"
          ></div>
        </div>
      } @else if (!documents().length) {
        <p class="text-sm text-muted">No hay archivos adjuntos.</p>
      } @else {
        <ul class="divide-y divide-border/60 rounded-lg border border-border/60 overflow-hidden">
          @for (d of documents(); track d.id) {
            <li
              class="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5 bg-dark/20 text-sm"
            >
              <div class="min-w-0 flex-1">
                <p class="font-medium text-main truncate" [title]="d.originalName">
                  {{ d.originalName }}
                </p>
                <p class="text-xs text-muted">
                  {{ formatBytes(d.sizeBytes) }} ·
                  {{ d.createdAt | date: 'short' }}
                  @if (d.uploadedBy?.name) {
                    · {{ d.uploadedBy?.name }}
                  }
                </p>
              </div>
              <div class="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  (click)="openPreview(d)"
                  class="px-2.5 py-1 rounded-md border border-border text-xs text-main hover:bg-dark/80"
                >
                  Ver / descargar
                </button>
                @if (canManage()) {
                  <button
                    type="button"
                    (click)="remove(d)"
                    class="px-2.5 py-1 rounded-md border border-red-500/35 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Eliminar
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class PurchaseDocumentsPanelComponent {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private notify = inject(NotificationService);
  private base = environment.apiUrl;

  entity = input.required<PurchaseDocumentEntity>();
  entityId = input.required<string>();
  title = input('Documentos adjuntos');

  documents = signal<PurchaseDocumentRow[]>([]);
  loading = signal(false);

  canManage = computed(() => this.auth.hasPermission(P.DOCUMENT_MANAGE));

  constructor() {
    effect(() => {
      const id = this.entityId();
      const ent = this.entity();
      if (id && ent) {
        this.load();
      }
    });
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  load() {
    const ent = this.entity();
    const id = this.entityId();
    if (!ent || !id) return;
    this.loading.set(true);
    this.http
      .get<PurchaseDocumentRow[]>(`${this.base}/purchase-documents`, {
        params: { entity: ent, entityId: id },
      })
      .subscribe({
        next: (rows) => {
          this.documents.set(rows);
          this.loading.set(false);
        },
        error: () => {
          this.documents.set([]);
          this.loading.set(false);
        },
      });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      this.notify.error('El archivo supera el máximo de 20 MB.');
      return;
    }
    const ent = this.entity();
    const id = this.entityId();
    const fd = new FormData();
    fd.append('file', file, file.name);
    this.loading.set(true);
    this.http
      .post<PurchaseDocumentRow>(`${this.base}/purchase-documents`, fd, {
        params: { entity: ent, entityId: id },
      })
      .subscribe({
        next: () => {
          this.notify.success('Archivo subido.');
          this.load();
        },
        error: (err: unknown) => {
          this.loading.set(false);
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(
            typeof msg === 'string' ? msg : 'No se pudo subir el archivo.',
          );
        },
      });
  }

  openPreview(doc: PurchaseDocumentRow) {
    const url = `${this.base}/purchase-documents/${doc.id}/file`;
    this.http
      .get(url, {
        responseType: 'blob',
        observe: 'response',
      })
      .subscribe({
        next: (res: HttpResponse<Blob>) => {
          const blob = res.body;
          if (!blob) return;
          const mime =
            res.headers.get('Content-Type') ||
            doc.mimeType ||
            'application/octet-stream';
          const file = new Blob([blob], { type: mime });
          const objectUrl = URL.createObjectURL(file);
          window.open(objectUrl, '_blank', 'noopener,noreferrer');
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        },
        error: () => this.notify.error('No se pudo abrir el archivo.'),
      });
  }

  remove(doc: PurchaseDocumentRow) {
    if (!confirm(`¿Eliminar «${doc.originalName}»?`)) return;
    this.http.delete(`${this.base}/purchase-documents/${doc.id}`).subscribe({
      next: () => {
        this.notify.success('Archivo eliminado.');
        this.load();
      },
      error: () => this.notify.error('No se pudo eliminar.'),
    });
  }
}
