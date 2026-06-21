/**
 * Parsea el texto de `InventoryTransaction.notes` para ajustes manuales.
 * Formatos soportados:
 * - `Ajuste [Etiqueta]: comentario`
 * - `Ajuste [Saldo pendiente] (OC: #<correlativo OC>): comentario` (p. ej. `#2025-0042`)
 */
export const INVENTORY_ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  CONTEO: 'Ajuste por inventario (conteo / hallazgo)',
  'Error de conteo': 'Ajuste por inventario (conteo / hallazgo)',
  'Ajuste por inventario (conteo / hallazgo)':
    'Ajuste por inventario (conteo / hallazgo)',
  MERMAS: 'Merma o pérdida',
  Mermas: 'Merma o pérdida',
  'Merma o pérdida': 'Merma o pérdida',
  DANO: 'Daño',
  Daño: 'Daño',
  SALDO_PENDIENTE: 'Saldo pendiente',
  'Saldo pendiente': 'Saldo pendiente',
  ENTREGA_EPP: 'Entrega de EPP',
  'Entrega de EPP': 'Entrega de EPP',
};

export function normalizeInventoryAdjustmentReason(reason: string): string {
  const label = reason.trim();
  return INVENTORY_ADJUSTMENT_REASON_LABELS[label] ?? label;
}

export function parseInventoryAdjustmentNotes(
  notes: string | null,
): { reason: string; comment: string } {
  if (!notes?.trim()) {
    return { reason: '', comment: '' };
  }
  const m = notes.match(
    /^Ajuste\s*\[([^\]]+)\]\s*(?:\([^)]+\))?\s*:\s*([\s\S]*)$/,
  );
  if (m) {
    return {
      reason: normalizeInventoryAdjustmentReason(m[1]),
      comment: m[2].trim(),
    };
  }
  return { reason: 'Ajuste', comment: notes.trim() };
}
