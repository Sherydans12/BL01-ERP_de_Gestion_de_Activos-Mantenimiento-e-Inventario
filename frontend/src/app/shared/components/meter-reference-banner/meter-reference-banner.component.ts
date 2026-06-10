import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type {
  EquipmentMeterSnapshot,
  MeterCaptureBoardRow,
  MeterType,
} from '../../../core/models/types';
import { getMeterSourceLabel } from '../../utils/meter-source-label.util';
import { resolveMeterReferenceView } from '../../utils/meter-reference-view.util';

@Component({
  selector: 'app-meter-reference-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meter-reference-banner.component.html',
})
export class MeterReferenceBannerComponent {
  readonly snapshot = input<EquipmentMeterSnapshot | null>(null);
  readonly boardRow = input<MeterCaptureBoardRow | null>(null);
  readonly meterType = input<MeterType | null>(null);
  /** Variante densa para celdas de tabla. */
  readonly compact = input(false);

  protected readonly view = computed(() =>
    resolveMeterReferenceView(
      this.snapshot(),
      this.boardRow(),
      this.meterType(),
    ),
  );

  protected sourceLabel(source: NonNullable<ReturnType<typeof resolveMeterReferenceView>>['source'], otCorrelative: string | null): string {
    if (!source) return '';
    return getMeterSourceLabel(source, { otCorrelative });
  }
}
