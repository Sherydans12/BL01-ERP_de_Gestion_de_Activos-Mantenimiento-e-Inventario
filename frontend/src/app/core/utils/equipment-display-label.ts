/** Consistente con backend `equipment-display-label.ts`. */
export function equipmentDisplayLabel(eq: {
  internalId: string;
  plate?: string | null;
  brand: string;
  model: string;
}): string {
  const bm = `${eq.brand ?? ''} ${eq.model ?? ''}`.trim().replace(/\s+/g, ' ');
  if (bm.length > 0) {
    return bm;
  }
  const plate = (eq.plate ?? '').trim();
  if (plate.length > 0) {
    return `Pat. ${plate}`;
  }
  const id = (eq.internalId ?? '').trim();
  if (id.length > 0) {
    return `N° ${id}`;
  }
  return 'Sin identificación';
}
