import { Component, inject } from '@angular/core';
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
      class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none"
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
}
