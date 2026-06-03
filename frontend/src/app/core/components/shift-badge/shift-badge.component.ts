import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ShiftService } from '../../services/shift/shift.service';

/**
 * Indicador de turno activo + reloj para la barra superior del app shell.
 * Solo lectura: el turno se autodetecta por hora local (ver ShiftService).
 */
@Component({
  selector: 'app-shift-badge',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div
      class="flex items-center gap-2 rounded-lg border border-border bg-dark/40 px-2.5 py-1.5"
      [title]="shift.shiftLabel() + ' (' + shift.shiftHours() + ')'"
    >
      @if (shift.currentShift() === 'DAY') {
        <!-- Sol: Turno Día -->
        <svg
          class="h-4 w-4 text-warning"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
          />
        </svg>
      } @else {
        <!-- Luna: Turno Noche (solo cuando hasNightShift=true) -->
        <svg
          class="h-4 w-4 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      }

      <div class="flex flex-col leading-tight">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-main">
          {{ shift.shiftLabel() }}
          @if (!shift.hasNightShift()) {
            <span class="ml-1 text-muted normal-case font-normal tracking-normal">único</span>
          }
        </span>
        <span class="font-mono text-[10px] text-muted">
          {{ shift.now() | date: 'EEE dd MMM · HH:mm' }}
        </span>
      </div>
    </div>
  `,
})
export class ShiftBadgeComponent {
  protected readonly shift = inject(ShiftService);
}
