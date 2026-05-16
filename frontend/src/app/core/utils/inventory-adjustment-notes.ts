/**
 * Parsea el texto de `InventoryTransaction.notes` para ajustes manuales.
 * Formatos soportados:
 * - `Ajuste [Etiqueta]: comentario`
 * - `Ajuste [Saldo pendiente] (OC: #<correlativo OC>): comentario` (p. ej. `#2025-0042`)
 */
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
    return { reason: m[1].trim(), comment: m[2].trim() };
  }
  return { reason: 'Ajuste', comment: notes.trim() };
}
