import { Component, input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';

export interface EquipmentMeterHistoryRow {
  id: string;
  date: string;
  reading: number;
  deltaFromPrevious: number | null;
  sourceLabel: string;
  userLabel: string;
}

@Component({
  selector: 'app-equipment-meter-history-table',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './equipment-meter-history-table.component.html',
})
export class EquipmentMeterHistoryTableComponent {
  rows = input<EquipmentMeterHistoryRow[]>([]);
  meterUnit = input<string>('Hrs');
  compact = input(false);

  formatNum(n: number): string {
    return n.toLocaleString('es-CL');
  }
}
