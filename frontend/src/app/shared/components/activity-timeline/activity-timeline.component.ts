import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ActivityLogEntry,
  ActivityLogAction,
} from '../../../core/services/purchases/purchases.service';
import { ClpCurrencyPipe } from '../../pipes/clp-currency.pipe';
import { EntityLinkComponent } from '../entity-link/entity-link.component';
import type { QuickViewKind } from '../quick-view/quick-view.service';

/** Campos de auditoría que representan montos (CLP u otra moneda mostrada como CLP en UI). */
const AMOUNT_KEY =
  /(Amount|Cost|Price|Monto|Precio|threshold|Threshold|saldo|Saldo|umbral|Umbral|Subtotal|subtotal)$/i;

const REQ_STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Enviado',
  QUOTING: 'En cotización',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Anulado',
};

const PO_STATUS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  PARTIALLY_APPROVED: 'Aprobación parcial',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  SENT: 'Enviada al proveedor',
  ORDERED: 'Pedida al proveedor',
  SENT_TO_SUPPLIER: 'Enviada al proveedor (hist.)',
  PARTIALLY_RECEIVED: 'Recepción parcial',
  RECEIVED: 'Recepción completa',
  CLOSED: 'Cerrada',
  CANCELLED: 'Anulada',
};

const RECEIPT_STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  COMPLETED: 'Completada',
};

/** Etiquetas en español para claves guardadas en auditoría (backend en inglés). */
const FIELD_LABELS: Record<string, string> = {
  correlative: 'Correlativo',
  status: 'Estado',
  description: 'Descripción',
  justification: 'Justificación',
  priority: 'Prioridad',
  itemsCount: 'Cantidad de ítems',
  itemsSnapshot: 'Detalle de ítems',
  event: 'Acción',
  quotationId: 'ID interno de cotización',
  vendorId: 'ID interno de proveedor',
  vendorName: 'Proveedor',
  totalAmount: 'Monto total',
  selectedQuotationId: 'Cotización seleccionada',
  previousWinnerQuotationId: 'Cotización ganadora anterior',
  previousVendorName: 'Proveedor ganador anterior',
  signatureLevel: 'Nivel de firma',
  comment: 'Comentario',
  reason: 'Motivo / observación',
  approvalsCleared: 'Firmas anuladas (reapertura)',
  requiredSignatures: 'Firmas requeridas',
  orderStatus: 'Estado de la orden',
  receiptStatus: 'Estado de la recepción',
  receiptCorrelative: 'Nº recepción',
  receiptId: 'ID interno de recepción',
  warehouseName: 'Bodega',
  warehouseCode: 'Código bodega',
  purchaseOrderCorrelative: 'Orden de compra',
  message: 'Mensaje',
  catalogItemName: 'Artículo de catálogo',
  inventoryItemId: 'ID artículo inventario',
  orderItemId: 'Línea OC',
  invoiceNumber: 'Nº factura',
  emissionDate: 'Fecha de emisión',
  dueDate: 'Fecha de vencimiento',
  netAmount: 'Monto neto',
  taxAmount: 'IVA / impuestos',
  itemLabel: 'Ítem',
  unitCost: 'Precio unitario',
  quantity: 'Cantidad',
  pdfUrl: 'Documento PDF',
  paymentReference: 'Referencia de pago',
  performedByName: 'Ejecutado por',
};

const EVENT_LABELS: Record<string, string> = {
  quotation_added: 'Se registró una cotización de proveedor',
  warehouse_receipt_opened: 'Se abrió una recepción en bodega',
  warehouse_receipt_confirmed: 'Recepción en bodega confirmada',
  invoice_three_way_match_discrepancy:
    'Prevención de sobrepagos — discrepancia en facturación (3-way match)',
  invoice_three_way_match_resolved: 'Factura: 3-way match OK tras corrección',
  marked_sent_to_supplier: 'Orden enviada al proveedor',
  invoice_created: 'Factura registrada',
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule, ClpCurrencyPipe, EntityLinkComponent],
  templateUrl: './activity-timeline.component.html',
})
export class ActivityTimelineComponent {
  logs = input<ActivityLogEntry[]>([]);
  isLoading = input(false);

  /** Vista rápida del documento auditado (REQ / OC / factura). */
  quickViewSpec(log: ActivityLogEntry): {
    kind: QuickViewKind;
    id: string;
    label: string;
    purchaseOrderId: string | null;
  } | null {
    const nv = log.details?.newValue as Record<string, unknown> | undefined;
    const ov = log.details?.oldValue as Record<string, unknown> | undefined;
    const meta = log.details?.metadata as Record<string, unknown> | undefined;

    if (log.entityType === 'REQUISITION') {
      const c =
        (typeof nv?.['correlative'] === 'string' ? nv['correlative'] : null) ||
        (typeof ov?.['correlative'] === 'string' ? ov['correlative'] : null);
      return { kind: 'REQ', id: log.entityId, label: c || 'REQ', purchaseOrderId: null };
    }
    if (log.entityType === 'PURCHASE_ORDER') {
      const c =
        (typeof nv?.['correlative'] === 'string' ? nv['correlative'] : null) ||
        (typeof ov?.['correlative'] === 'string' ? ov['correlative'] : null);
      return { kind: 'PO', id: log.entityId, label: c || 'OC', purchaseOrderId: null };
    }
    if (log.entityType === 'PURCHASE_INVOICE') {
      const num =
        (typeof nv?.['invoiceNumber'] === 'string' ? nv['invoiceNumber'] : null) ||
        (typeof ov?.['invoiceNumber'] === 'string' ? ov['invoiceNumber'] : null) ||
        (typeof meta?.['invoiceNumber'] === 'string' ? meta['invoiceNumber'] : null);
      const po =
        (typeof nv?.['purchaseOrderId'] === 'string' ? nv['purchaseOrderId'] : null) ||
        (typeof ov?.['purchaseOrderId'] === 'string' ? ov['purchaseOrderId'] : null) ||
        (typeof meta?.['purchaseOrderId'] === 'string' ? meta['purchaseOrderId'] : null);
      return {
        kind: 'INV',
        id: log.entityId,
        label: num || 'Factura',
        purchaseOrderId: po,
      };
    }
    return null;
  }

  actionTitle(action: ActivityLogAction): string {
    const map: Record<ActivityLogAction, string> = {
      CREATE: 'Alta',
      UPDATE: 'Modificación',
      DELETE: 'Eliminación',
      STATUS_CHANGE: 'Cambio de estado',
      SIGNATURE: 'Firma de aprobación',
      SYSTEM_UPDATE: 'Actualización de sistema',
    };
    return map[action] ?? action;
  }

  /** Etiquetas formales para la línea de resumen (auditoría). */
  professionalActionLabel(action: ActivityLogAction): string {
    const map: Record<ActivityLogAction, string> = {
      CREATE: 'Alta registrada',
      UPDATE: 'Modificación de ítem',
      DELETE: 'Eliminación',
      STATUS_CHANGE: 'Estado actualizado',
      SIGNATURE: 'Firma de aprobación',
      SYSTEM_UPDATE: 'Actualización de sistema',
    };
    return map[action] ?? action;
  }

  entityLabel(type: string): string {
    if (type === 'PURCHASE_ORDER') return 'orden de compra';
    if (type === 'REQUISITION') return 'requerimiento';
    if (type === 'PURCHASE_INVOICE') return 'factura de compra';
    return type;
  }

  entityShortLabel(type: string): string {
    if (type === 'PURCHASE_ORDER') return 'Orden de compra';
    if (type === 'REQUISITION') return 'Requerimiento';
    if (type === 'PURCHASE_INVOICE') return 'Factura';
    return type;
  }

  /** Línea secundaria (tipo de operación · entidad). */
  summaryLine(log: ActivityLogEntry): string {
    let action = this.professionalActionLabel(log.action);
    if (log.action === 'UPDATE' && log.entityType === 'PURCHASE_INVOICE') {
      action = 'Edición de factura';
    } else if (
      log.action === 'UPDATE' &&
      log.entityType === 'PURCHASE_ORDER' &&
      String(log.details?.metadata?.['event'] ?? '').startsWith('po_line_')
    ) {
      action = 'Modificación de línea OC';
    }
    return `${action} · ${this.entityShortLabel(log.entityType)}`;
  }

  /** Iniciales para avatar cuando no hay foto de perfil. */
  userInitials(name: string | undefined | null): string {
    const n = (name ?? '').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  }

  /** Título principal legible para el usuario. */
  headlineForLog(log: ActivityLogEntry): string {
    const nv = log.details?.newValue as Record<string, unknown> | undefined;
    const ov = log.details?.oldValue as Record<string, unknown> | undefined;
    const meta = log.details?.metadata as Record<string, unknown> | undefined;
    const ev = nv && typeof nv['event'] === 'string' ? (nv['event'] as string) : null;

    if (log.action === 'DELETE' && log.entityType === 'PURCHASE_INVOICE') {
      const num =
        ov && typeof ov['invoiceNumber'] === 'string' ? ov['invoiceNumber'] : '';
      const amt = ov && ov['totalAmount'] != null ? Number(ov['totalAmount']) : NaN;
      const vend = ov && typeof ov['vendorName'] === 'string' ? ov['vendorName'] : '';
      const money = !Number.isNaN(amt) ? this.formatMoney(amt) : '';
      return `Factura eliminada${num ? `: ${num}` : ''}${money ? ` · ${money}` : ''}${vend ? ` · ${vend}` : ''}`;
    }

    if (log.action === 'CREATE' && log.entityType === 'PURCHASE_INVOICE' && nv?.['event'] === 'invoice_created') {
      const num = typeof nv['invoiceNumber'] === 'string' ? nv['invoiceNumber'] : '';
      const amt = nv['totalAmount'];
      const m =
        typeof amt === 'number'
          ? this.formatMoney(amt)
          : typeof amt === 'string'
            ? this.formatMoney(parseFloat(amt))
            : '';
      const vend = typeof nv['vendorName'] === 'string' ? nv['vendorName'] : '';
      return `Factura registrada${num ? ` (${num})` : ''}${m ? ` · ${m}` : ''}${vend ? ` · ${vend}` : ''}`;
    }

    if (log.action === 'UPDATE' && log.entityType === 'PURCHASE_INVOICE') {
      const field = log.details?.field;
      const prev = log.details?.prev;
      const next = log.details?.next;
      const inv =
        (meta && typeof meta['invoiceNumber'] === 'string' ? meta['invoiceNumber'] : '') ||
        (typeof nv?.['invoiceNumber'] === 'string' ? nv['invoiceNumber'] : '');
      if (field === 'totalAmount' && prev != null && next != null) {
        return `Factura ${inv || '(sin nº)'}: monto modificado de ${this.formatMoney(Number(prev))} a ${this.formatMoney(Number(next))}`;
      }
      if (field === 'invoiceNumber') {
        return `Factura: número cambiado de «${String(prev ?? '—')}» a «${String(next ?? '—')}»`;
      }
      if (field === 'emissionDate') {
        return `Factura ${inv}: fecha de emisión actualizada`;
      }
      if (field === 'pdfUrl') {
        return `Factura ${inv}: documento PDF actualizado`;
      }
    }

    if (log.action === 'SYSTEM_UPDATE' && log.entityType === 'PURCHASE_ORDER') {
      const msg = nv && typeof nv['message'] === 'string' ? (nv['message'] as string) : '';
      if (msg) return msg;
      return 'Actualización automática en la orden de compra';
    }

    if (ev === 'quotation_added' && nv) {
      const vendor = typeof nv['vendorName'] === 'string' ? nv['vendorName'] : '';
      const amt = nv['totalAmount'];
      const money =
        typeof amt === 'number'
          ? this.formatMoney(amt)
          : typeof amt === 'string'
            ? this.formatMoney(parseFloat(amt))
            : '';
      if (vendor && money) return `Cotización registrada: ${vendor} · ${money}`;
      if (vendor) return `Cotización registrada: ${vendor}`;
      return 'Cotización registrada en el requerimiento';
    }

    if (ev === 'winner_selection_changed' && log.entityType === 'REQUISITION') {
      const vn = typeof nv?.['vendorName'] === 'string' ? nv['vendorName'] : '';
      const pv = typeof ov?.['previousVendorName'] === 'string' ? ov['previousVendorName'] : '';
      if (pv && vn) return `Cambio de cotización ganadora: «${pv}» → «${vn}»`;
      if (vn) return `Nueva cotización ganadora: «${vn}»`;
      return 'Cambio de cotización ganadora';
    }

    if (ev === 'warehouse_receipt_opened' && nv) {
      const w =
        typeof nv['warehouseName'] === 'string' ? nv['warehouseName'] : '';
      const rc =
        typeof nv['receiptCorrelative'] === 'string' ? nv['receiptCorrelative'] : '';
      if (rc && w) return `Recepción ${rc} iniciada en bodega «${w}»`;
      if (w) return `Recepción de mercadería iniciada en «${w}»`;
    }

    if (ev && EVENT_LABELS[ev]) {
      return EVENT_LABELS[ev];
    }

    if (log.action === 'CREATE' && log.entityType === 'REQUISITION') {
      const c = nv?.['correlative'];
      return typeof c === 'string' && c
        ? `Requerimiento creado (${c})`
        : 'Requerimiento creado';
    }

    if (log.action === 'CREATE' && log.entityType === 'PURCHASE_ORDER') {
      const c = nv?.['correlative'];
      const base =
        typeof c === 'string' && c ? `Orden de compra creada (${c})` : 'Orden de compra creada';
      const amt = nv?.['totalAmount'];
      if (typeof amt === 'number') return `${base} · ${this.formatMoney(amt)}`;
      return base;
    }

    if (log.action === 'SIGNATURE' && log.entityType === 'PURCHASE_ORDER') {
      const level = nv?.['signatureLevel'];
      const st = nv?.['status'];
      const levelStr = typeof level === 'number' ? `Nivel ${level}` : '';
      const statusStr = typeof st === 'string' ? this.labelPoStatus(st) : '';
      if (levelStr && statusStr) return `Firma de aprobación (${levelStr}) · Estado OC: ${statusStr}`;
      if (levelStr) return `Firma de aprobación registrada (${levelStr})`;
      return 'Firma de aprobación registrada';
    }

    if (log.action === 'STATUS_CHANGE' && log.entityType === 'REQUISITION') {
      if (nv && nv['selectedQuotationId']) {
        return 'Cotización elegida como ganadora; requerimiento pendiente de aprobación de la OC';
      }
      const from = ov?.['status'];
      const to = nv?.['status'];
      if (typeof from === 'string' || typeof to === 'string') {
        return `Estado del requerimiento: ${this.labelReqStatus(from)} → ${this.labelReqStatus(to)}`;
      }
    }

    if (log.action === 'STATUS_CHANGE' && log.entityType === 'PURCHASE_INVOICE') {
      if (nv?.['status'] === 'PAID' && (ov?.['status'] === 'MATCHED' || ov?.['status'] === 'DISCREPANCY')) {
        const ref = nv['paymentReference'];
        if (typeof ref === 'string' && ref.trim()) {
          return `Factura marcada como pagada · Ref. ${ref.trim()}`;
        }
        return 'Factura marcada como pagada';
      }
      if (nv?.['event'] === 'invoice_three_way_match_discrepancy') {
        const msg = nv['message'];
        if (typeof msg === 'string' && msg.trim()) return msg;
        const inv = nv['invoiceNumber'];
        const invStr = typeof inv === 'string' ? inv : '';
        if (invStr) return `Prevención de sobrepagos · Factura ${invStr}`;
        return 'Prevención de sobrepagos: revisar facturación (3-way match)';
      }
      if (nv?.['event'] === 'invoice_three_way_match_resolved') {
        return 'Factura conciliada: 3-way match OK';
      }
    }

    if (log.action === 'STATUS_CHANGE' && log.entityType === 'PURCHASE_ORDER') {
      if (ev === 'marked_sent_to_supplier') {
        const sentAt = typeof nv?.['sentAt'] === 'string' ? nv['sentAt'] : '';
        const by = typeof nv?.['performedByName'] === 'string' ? nv['performedByName'] : '';
        const datePart = sentAt ? this.formatLocalDateTime(sentAt) : '';
        if (datePart && by) return `Orden enviada al proveedor · ${datePart} · ${by}`;
        if (by) return `Orden enviada al proveedor · ${by}`;
        return 'Orden enviada al proveedor';
      }
      if (nv?.['event'] === 'warehouse_receipt_confirmed') {
        const rc = nv['receiptCorrelative'];
        const st = nv['status'];
        if (typeof rc === 'string' && typeof st === 'string') {
          return `Recepción ${rc} confirmada · la orden pasa a «${this.labelPoStatus(st)}»`;
        }
        return 'Recepción en bodega confirmada (inventario actualizado)';
      }

      const from = ov?.['status'];
      const to = nv?.['status'];
      const reason = nv?.['reason'];
      if (
        typeof to === 'string' &&
        to === 'REJECTED'
      ) {
        return 'Orden de compra rechazada';
      }
      if (nv?.['approvalsCleared'] === true) {
        return 'Orden reabierta a borrador (firmas eliminadas)';
      }
      if (typeof to === 'string' && to === 'CLOSED') {
        return 'Orden cerrada administrativamente';
      }
      if (typeof from === 'string' || typeof to === 'string') {
        return `Estado de la orden: ${this.labelPoStatus(from)} → ${this.labelPoStatus(to)}`;
      }
      if (typeof reason === 'string' && reason && (from || to)) {
        return `Cambio de estado en orden de compra`;
      }
    }

    if (log.action === 'UPDATE' && log.entityType === 'REQUISITION') {
      if (nv && !nv['event'] && (nv['itemsSnapshot'] || ov?.['itemsSnapshot'])) {
        return 'Se actualizó el requerimiento (descripción, ítems o justificación)';
      }
    }

    if (log.action === 'UPDATE' && log.entityType === 'PURCHASE_ORDER') {
      const evPo = meta?.['event'];
      const label =
        typeof meta?.['itemDescription'] === 'string' ? meta['itemDescription'] : 'Ítem';
      const p = log.details?.prev;
      const n = log.details?.next;
      if (evPo === 'po_line_unit_cost_changed' && p != null && n != null) {
        return `«${label}»: precio unitario modificado de ${this.formatMoney(Number(p))} a ${this.formatMoney(Number(n))}`;
      }
      if (evPo === 'po_line_quantity_changed' && p != null && n != null) {
        return `«${label}»: cantidad modificada de ${String(p)} a ${String(n)}`;
      }
      return 'Se modificó la orden de compra (montos, ítems o reapertura a firma)';
    }

    return this.summaryLine(log);
  }

  hasDiff(log: ActivityLogEntry): boolean {
    const d = log.details;
    if (!d) return false;
    if (
      d.field &&
      (d.prev !== undefined || d.next !== undefined)
    ) {
      return true;
    }
    const hasOld = d.oldValue && Object.keys(d.oldValue).length > 0;
    const hasNew = d.newValue && Object.keys(d.newValue).length > 0;
    return !!(hasOld || hasNew);
  }

  hasOldDetails(log: ActivityLogEntry): boolean {
    const o = log.details?.oldValue;
    return !!o && Object.keys(o).length > 0;
  }

  hasNewDetails(log: ActivityLogEntry): boolean {
    const n = log.details?.newValue;
    return !!n && Object.keys(n).length > 0;
  }

  labelReqStatus(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    return REQ_STATUS[s] ?? s;
  }

  labelPoStatus(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    return PO_STATUS[s] ?? s;
  }

  labelReceiptStatus(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    return RECEIPT_STATUS[s] ?? s;
  }

  fieldLabel(key: string): string {
    return FIELD_LABELS[key] ?? this.camelToWords(key);
  }

  private camelToWords(key: string): string {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  /** Mismo criterio que `ClpCurrencyPipe`: "CLP 1.234.567". */
  private formatMoney(n: number): string {
    if (Number.isNaN(n)) return '—';
    const formatted = n.toLocaleString('es-CL', { maximumFractionDigits: 0 });
    return `CLP ${formatted}`;
  }

  /** Fecha/hora local para metadatos ISO (p. ej. sentAt). */
  private formatLocalDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Valores con contexto del bloque (p. ej. ocultar ID de proveedor si ya hay nombre).
   */
  formatDetailValue(
    key: string,
    v: unknown,
    log: ActivityLogEntry,
    ctx: Record<string, unknown>,
  ): string {
    if (v === null || v === undefined) return '—';

    if (key === 'event' && typeof v === 'string') {
      if (v === 'winner_selection_changed') return 'Cambio de oferta ganadora';
      return EVENT_LABELS[v] ?? v.replace(/_/g, ' ');
    }

    if (key === 'status') {
      if (log.entityType === 'REQUISITION') return this.labelReqStatus(v);
      if (log.entityType === 'PURCHASE_ORDER') return this.labelPoStatus(v);
    }

    if (key === 'orderStatus') return this.labelPoStatus(v);
    if (key === 'receiptStatus') return this.labelReceiptStatus(v);

    if (key === 'approvalsCleared' && typeof v === 'boolean') {
      return v ? 'Sí (se eliminaron las firmas previas)' : 'No';
    }

    if (key === 'itemsSnapshot' && Array.isArray(v)) {
      return this.formatItemsSnapshot(v);
    }

    if (key === 'vendorId' && typeof v === 'string' && typeof ctx['vendorName'] === 'string') {
      return this.shortId(v) + ' (ver nombre de proveedor arriba)';
    }

    if (key === 'quotationId' || key === 'selectedQuotationId' || key === 'receiptId') {
      if (typeof v === 'string' && UUID_RE.test(v)) return this.shortId(v);
    }

    if (key === 'vendorId' && typeof v === 'string' && UUID_RE.test(v)) {
      return this.shortId(v);
    }

    if (key === 'priority' && typeof v === 'string') {
      const m: Record<string, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };
      return m[v] ?? v;
    }

    if (typeof v === 'boolean') return v ? 'Sí' : 'No';

    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return JSON.stringify(v, null, 0);
    }

    if (typeof v === 'string' && UUID_RE.test(v) && (key.endsWith('Id') || key === 'id')) {
      return this.shortId(v);
    }

    return String(v);
  }

  private shortId(uuid: string): string {
    if (uuid.length < 20) return uuid;
    return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
  }

  private formatItemsSnapshot(items: unknown[]): string {
    return items
      .map((raw, i) => {
        const o = raw as Record<string, unknown>;
        const desc = String(o['description'] ?? '—');
        const q = o['quantity'];
        const u = String(o['unitOfMeasure'] ?? '');
        const part = o['partNumber'] ? ` · Parte: ${o['partNumber']}` : '';
        const notes = o['itemNotes'] ? ` · Notas: ${o['itemNotes']}` : '';
        const est =
          o['estimatedCost'] != null && o['estimatedCost'] !== ''
            ? ` · Estimado: ${this.formatMoney(Number(o['estimatedCost']))}`
            : '';
        return `${i + 1}. ${desc} — ${q} ${u}${part}${notes}${est}`;
      })
      .join('\n');
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

  /**
   * Orden de visualización: texto útil primero, IDs al final.
   */
  keyValuesOrdered(obj: Record<string, unknown> | undefined): { k: string; v: unknown }[] {
    if (!obj) return [];
    const priority = [
      'event',
      'correlative',
      'description',
      'vendorName',
      'totalAmount',
      'status',
      'signatureLevel',
      'comment',
      'reason',
      'itemsCount',
      'itemsSnapshot',
      'justification',
    ];
    const keys = Object.keys(obj);
    const rank = (k: string) => {
      const p = priority.indexOf(k);
      return p === -1 ? 100 + k.charCodeAt(0) : p;
    };
    keys.sort((a, b) => rank(a) - rank(b));
    return keys.map((k) => ({ k, v: obj[k] }));
  }

  /** Omite claves redundantes cuando ya hay un nombre legible. */
  shouldShowKey(key: string, ctx: Record<string, unknown>): boolean {
    if (key === 'vendorId' && typeof ctx['vendorName'] === 'string') return false;
    return true;
  }
}
