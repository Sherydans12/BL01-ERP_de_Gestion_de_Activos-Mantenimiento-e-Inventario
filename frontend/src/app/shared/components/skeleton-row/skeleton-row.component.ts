import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Fila de tabla de carga (pulso). Usar dentro de `<tbody>`: `<tr appSkeletonRow [columnCount]="5">`.
 */
@Component({
  selector: 'tr[appSkeletonRow]',
  standalone: true,
  imports: [CommonModule],
  template: `
    @for (c of cells(); track c) {
      <td class="py-4 px-6">
        <div
          class="h-4 rounded-md bg-border/60 animate-pulse"
          [style.width.%]="widthPercent(c)"
        ></div>
      </td>
    }
  `,
})
export class SkeletonRowComponent {
  /** Número de celdas (debe coincidir con las columnas de la tabla). */
  columnCount = input(5);

  cells = computed(() =>
    Array.from({ length: this.columnCount() }, (_, i) => i),
  );

  widthPercent(index: number): number {
    const pattern = [72, 100, 55, 48, 52];
    return pattern[index % pattern.length];
  }
}
