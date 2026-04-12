import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ActivityLogEntry,
  ActivityLogAction,
} from '../../../core/services/purchases/purchases.service';
import { ClpCurrencyPipe } from '../../pipes/clp-currency.pipe';

/** Campos de auditoría que representan montos (CLP u otra moneda mostrada como CLP en UI). */
const AMOUNT_KEY =
  /(Amount|Cost|Price|Monto|Precio|threshold|Threshold|saldo|Saldo|umbral|Umbral|Subtotal|subtotal)$/i;

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule, ClpCurrencyPipe],
  templateUrl: './activity-timeline.component.html',
})
export class ActivityTimelineComponent {
  logs = input<ActivityLogEntry[]>([]);
  isLoading = input(false);

  actionTitle(action: ActivityLogAction): string {
    const map: Record<ActivityLogAction, string> = {
      CREATE: 'Creación',
      UPDATE: 'Actualización',
      DELETE: 'Eliminación',
      STATUS_CHANGE: 'Cambio de estado',
      SIGNATURE: 'Firma',
    };
    return map[action] ?? action;
  }

  entityLabel(type: string): string {
    if (type === 'PURCHASE_ORDER') return 'Orden de compra';
    if (type === 'REQUISITION') return 'Requerimiento';
    return type;
  }

  summaryLine(log: ActivityLogEntry): string {
    const parts = [this.actionTitle(log.action), this.entityLabel(log.entityType)];
    return parts.join(' · ');
  }

  hasDiff(log: ActivityLogEntry): boolean {
    const d = log.details;
    if (!d) return false;
    const hasOld = d.oldValue && Object.keys(d.oldValue).length > 0;
    const hasNew = d.newValue && Object.keys(d.newValue).length > 0;
    return !!(hasOld || hasNew);
  }

  formatValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v, null, 0);
    return String(v);
  }

  isCurrencyField(key: string, v: unknown): boolean {
    if (!AMOUNT_KEY.test(key)) return false;
    const n = this.asNumber(v);
    return !Number.isNaN(n);
  }

  asNumber(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return NaN;
      return parseFloat(t);
    }
    return NaN;
  }

  objectKeys(obj: Record<string, unknown> | undefined): string[] {
    if (!obj) return [];
    return Object.keys(obj);
  }

  keyValues(obj: Record<string, unknown>): { k: string; v: unknown }[] {
    return Object.entries(obj).map(([k, v]) => ({ k, v }));
  }
}
