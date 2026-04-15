import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen) {
      <dialog
        #confirmDialog
        class="confirm-dialog m-0 max-h-[100dvh] w-full max-w-none border-0 bg-transparent p-0 shadow-none [&::backdrop]:bg-black/70 [&::backdrop]:backdrop-blur-sm animate-fade-in"
        (cancel)="onEscapeCancel()"
      >
        <div
          class="flex min-h-full w-full items-center justify-center p-4"
          (click)="onCancelClick()"
        >
          <div
            class="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md flex flex-col scale-in"
            (click)="$event.stopPropagation()"
          >
          <div
            class="flex items-center gap-3 p-5 border-b border-border bg-dark/50"
          >
            <div
              [class]="iconClasses()"
            >
              <svg
                class="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-bold text-white">{{ title }}</h3>
          </div>

          <div class="p-5 text-gray-300">
            <p>{{ message }}</p>
            @if (consequenceSummary.trim()) {
              <div class="mt-3 rounded-lg border border-border bg-dark/40 p-3">
                <p class="text-xs text-muted uppercase tracking-wide mb-1">
                  Impacto
                </p>
                <p class="text-sm text-main">{{ consequenceSummary }}</p>
              </div>
            }
            @if (requireReason) {
              <div class="mt-4">
                <label class="block text-xs text-muted mb-1">{{ reasonLabel }}</label>
                <textarea
                  rows="3"
                  [(ngModel)]="reasonText"
                  [placeholder]="reasonPlaceholder"
                  class="w-full px-3 py-2 bg-dark border border-border rounded-lg text-main text-sm focus:border-primary focus:outline-none resize-none"
                ></textarea>
              </div>
            }
            @if (requireAcknowledge) {
              <label class="mt-4 inline-flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  [(ngModel)]="acknowledged"
                  class="rounded border-border bg-dark text-primary focus:ring-primary mt-0.5"
                />
                <span class="text-xs text-main/90">{{ acknowledgeLabel }}</span>
              </label>
            }
          </div>

          <div
            class="p-5 border-t border-border bg-dark/30 flex justify-end gap-3"
          >
            <button
              type="button"
              (click)="onCancelClick()"
              class="px-5 py-2 rounded-lg bg-dark border border-border text-white hover:bg-surface transition-colors font-medium text-sm"
            >
              {{ cancelText }}
            </button>

            <button
              type="button"
              (click)="onConfirm()"
              [disabled]="!canConfirm()"
              [class]="confirmButtonClasses()"
            >
              {{ confirmButtonLabel() }}
            </button>
          </div>
        </div>
        </div>
      </dialog>
    }
  `,
  styles: [
    `
      :host dialog.confirm-dialog {
        box-sizing: border-box;
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0;
      }
      .animate-fade-in {
        animation: fadeIn 0.2s ease-out forwards;
      }
      .scale-in {
        animation: scaleIn 0.2s ease-out forwards;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes scaleIn {
        from {
          opacity: 0.9;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    `,
  ],
})
export class ConfirmModalComponent implements OnChanges {
  private injector = inject(Injector);
  confirmDialog = viewChild<ElementRef<HTMLDialogElement>>('confirmDialog');

  @Input() isOpen = false;
  @Input() title = 'Confirmar Acción';
  @Input() message = '¿Estás seguro de que deseas realizar esta acción?';
  @Input() confirmText = 'Confirmar';
  @Input() cancelText = 'Cancelar';
  @Input() isDanger = false;
  @Input() riskLevel: 'info' | 'warning' | 'danger' = 'info';
  @Input() consequenceSummary = '';
  @Input() confirmDelayMs = 0;
  @Input() requireReason = false;
  @Input() reasonLabel = 'Motivo';
  @Input() reasonPlaceholder = 'Ingrese el motivo...';
  @Input() reasonMinLength = 3;
  @Input() requireAcknowledge = false;
  @Input() acknowledgeLabel = 'Entiendo el impacto de esta acción';

  @Output() confirm = new EventEmitter<string | null>();
  @Output() cancel = new EventEmitter<void>();
  delayUntil = 0;
  reasonText = '';
  acknowledged = false;

  iconClasses(): string {
    const level = this.effectiveRiskLevel();
    if (level === 'danger') return 'p-2 bg-error/10 text-error rounded-full';
    if (level === 'warning')
      return 'p-2 bg-amber-500/15 text-amber-300 rounded-full';
    return 'p-2 bg-primary/10 text-primary rounded-full';
  }

  confirmButtonClasses(): string {
    const level = this.effectiveRiskLevel();
    if (level === 'danger') {
      return 'px-5 py-2 rounded-lg bg-error hover:bg-error/90 text-white shadow-lg shadow-error/20 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed';
    }
    if (level === 'warning') {
      return 'px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed';
    }
    return 'px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed';
  }

  private effectiveRiskLevel(): 'info' | 'warning' | 'danger' {
    return this.isDanger ? 'danger' : this.riskLevel;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetStateForOpen();
      afterNextRender(
        () => {
          const el = this.confirmDialog()?.nativeElement;
          if (el && !el.open) {
            el.showModal();
          }
        },
        { injector: this.injector },
      );
    }
  }

  onConfirm() {
    if (!this.canConfirm()) return;
    this.confirm.emit(this.requireReason ? this.reasonText.trim() : null);
  }

  /** Clic en Cancelar o fuera del panel: el padre baja `isOpen`. */
  onCancelClick() {
    this.cancel.emit();
  }

  /** Escape: el navegador cierra el diálogo; notificamos al padre. */
  onEscapeCancel() {
    this.cancel.emit();
  }

  private resetStateForOpen() {
    this.reasonText = '';
    this.acknowledged = false;
    this.delayUntil = Date.now() + Math.max(0, this.confirmDelayMs);
  }

  private delaySecondsLeft(): number {
    const remainingMs = this.delayUntil - Date.now();
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / 1000);
  }

  canConfirm(): boolean {
    if (this.delaySecondsLeft() > 0) return false;
    if (this.requireAcknowledge && !this.acknowledged) return false;
    if (this.requireReason) {
      return this.reasonText.trim().length >= this.reasonMinLength;
    }
    return true;
  }

  confirmButtonLabel(): string {
    const sec = this.delaySecondsLeft();
    if (sec > 0) {
      return `${this.confirmText} (${sec}s)`;
    }
    return this.confirmText;
  }
}
