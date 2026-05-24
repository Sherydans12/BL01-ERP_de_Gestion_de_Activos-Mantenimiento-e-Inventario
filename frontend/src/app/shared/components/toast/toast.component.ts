import {
  Component,
  inject,
  viewChild,
  effect,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  NotificationService,
  Toast,
} from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      #toastStack
      class="toast-stack-host fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none"
      [attr.popover]="popoverTopLayer ? 'manual' : null"
    >
      @for (toast of notificationService.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-center justify-between w-full max-w-sm p-4 text-white shadow-2xl rounded-xl border animate-fade-in-up"
          [ngClass]="{
            'bg-success border-success/30': toast.type === 'success',
            'bg-error border-error/30': toast.type === 'error',
            'bg-warning border-warning/30 text-dark': toast.type === 'warning',
            'bg-surface border-border/50': toast.type === 'info',
          }"
        >
          <div class="flex items-center gap-3">
            <!-- Icon based on type -->
            @if (toast.type === 'success') {
              <svg
                class="w-5 h-5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            }
            @if (toast.type === 'error') {
              <svg
                class="w-5 h-5 shrink-0"
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
            }
            @if (toast.type === 'warning') {
              <svg
                class="w-5 h-5 shrink-0 text-dark"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
            @if (toast.type === 'info') {
              <svg
                class="w-5 h-5 shrink-0 text-[#FF3366]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }

            <p class="text-sm font-medium leading-tight">{{ toast.message }}</p>
          </div>

          <button
            (click)="notificationService.remove(toast.id)"
            class="ml-4 shrink-0 text-white/70 hover:text-white transition-colors"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      /*
       * UA stylesheet de [popover] centra el host (inset:0; margin:auto).
       * Sin esto los toasts quedan en el medio de la pantalla siempre que hay avisos.
       */
      .toast-stack-host,
      .toast-stack-host:popover-open {
        position: fixed;
        inset: auto 1rem 1rem auto;
        top: auto;
        left: auto;
        width: auto;
        height: auto;
        max-width: none;
        margin: 0;
        padding: 0;
        border: none;
        overflow: visible;
        background: transparent;
        color: inherit;
      }

      .animate-fade-in-up {
        animation: fadeInUp 0.3s ease-out forwards;
      }
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ],
})
export class ToastComponent {
  notificationService = inject(NotificationService);
  private stackRef = viewChild<ElementRef<HTMLElement>>('toastStack');

  /**
   * `<dialog showModal>` vive en el **top layer** del navegador: un toast con
   * solo `z-index` alto sigue **debajo**. `popover="manual"` mete el host en
   * el mismo mecanismo y queda visible sobre diálogos nativos.
   * @see docs/agentes/ui-notificaciones-toasts-top-layer.md
   */
  readonly popoverTopLayer =
    typeof document !== 'undefined' &&
    typeof HTMLElement !== 'undefined' &&
    'popover' in HTMLElement.prototype;

  constructor() {
    effect(() => {
      const list = this.notificationService.toasts();
      const el = this.stackRef()?.nativeElement;
      if (!el || !this.popoverTopLayer) return;

      queueMicrotask(() => {
        try {
          const anyEl = el as HTMLElement & {
            showPopover?: () => void;
            hidePopover?: () => void;
          };
          if (list.length > 0) {
            if (!el.matches(':popover-open')) {
              anyEl.showPopover?.();
            }
          } else if (el.matches(':popover-open')) {
            anyEl.hidePopover?.();
          }
        } catch {
          /* API popover o :popover-open no disponible */
        }
      });
    });
  }
}
