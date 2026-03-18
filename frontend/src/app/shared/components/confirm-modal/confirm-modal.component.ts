import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isOpen) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      >
        <div
          class="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md flex flex-col scale-in"
        >
          <!-- Header -->
          <div
            class="flex items-center gap-3 p-5 border-b border-border bg-dark/50"
          >
            <div class="p-2 bg-error/10 text-error rounded-full">
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

          <!-- Body -->
          <div class="p-5 text-gray-300">
            <p>{{ message }}</p>
          </div>

          <!-- Footer -->
          <div
            class="p-5 border-t border-border bg-dark/30 flex justify-end gap-3"
          >
            <button
              (click)="onCancel()"
              class="px-5 py-2 rounded-lg bg-dark border border-border text-white hover:bg-surface transition-colors font-medium text-sm"
            >
              {{ cancelText }}
            </button>
            <button
              (click)="onConfirm()"
              class="px-5 py-2 rounded-lg bg-error hover:bg-error/90 text-white shadow-lg shadow-error/20 transition-colors font-medium text-sm"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
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
export class ConfirmModalComponent {
  @Input() isOpen = false;
  @Input() title = 'Confirmar Acción';
  @Input() message = '¿Estás seguro de que deseas realizar esta acción?';
  @Input() confirmText = 'Confirmar';
  @Input() cancelText = 'Cancelar';

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onConfirm() {
    this.confirm.emit();
  }

  onCancel() {
    this.cancel.emit();
  }
}
