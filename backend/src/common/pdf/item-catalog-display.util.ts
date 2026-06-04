/**
 * Etiquetas de catálogo para PDF/Excel: nombre y descripción del artículo por separado.
 */
export function catalogItemName(
  name?: string | null,
  fallback?: string | null,
): string {
  const n = name?.trim();
  if (n) return n;
  const f = fallback?.trim();
  return f || '—';
}

export function catalogItemDescription(
  description?: string | null,
): string {
  const d = description?.trim();
  return d || '—';
}

/** Una línea legible (OC/SRC): código + nombre + descripción cuando aplica. */
export function catalogItemLineLabel(opts: {
  partNumber?: string | null;
  inventoryCode?: string | null;
  name?: string | null;
  description?: string | null;
  lineDescription?: string | null;
}): string {
  const part = opts.partNumber?.trim() || opts.inventoryCode?.trim();
  const name = opts.name?.trim();
  const desc =
    opts.lineDescription?.trim() ||
    opts.description?.trim() ||
    '';
  const parts: string[] = [];
  if (part) parts.push(`COD (${part})`);
  if (name) parts.push(name);
  if (desc && desc !== name) parts.push(desc);
  return parts.length ? parts.join(' — ') : '—';
}
