import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LubeReportDetail } from '../../../../core/services/lube-reports/lube-reports.service';

@Component({
  selector: 'app-lube-report-detail-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lube-report-detail-modal.component.html',
})
export class LubeReportDetailModalComponent {
  @Input() open = false;
  @Input() loading = false;
  @Input() report: LubeReportDetail | null = null;
  @Input() errorMessage: string | null = null;

  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.open) return;
    this.close();
  }

  close() {
    this.closed.emit();
  }

  equipmentLabel(report: LubeReportDetail): string {
    const e = report.equipment;
    const base = [e.internalId, `${e.brand} ${e.model}`].filter(Boolean).join(' — ');
    return e.plate ? `${base} (${e.plate})` : base;
  }

  lineTotal(line: LubeReportDetail['lines'][number]): number {
    const cost = Number(line.unitCost ?? 0);
    return line.quantity * (Number.isFinite(cost) ? cost : 0);
  }

  dispatchTotal(report: LubeReportDetail): number {
    return report.lines.reduce((sum, line) => sum + this.lineTotal(line), 0);
  }
}
