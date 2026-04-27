import type {
  FluidCompartment,
  OtClassificationTag,
} from '../../../core/services/work-orders/work-orders.service';

/** Un solo tipo de OT (no multi-selección). */
export type OtKindOption = 'PROGRAMADA' | 'NO_PROGRAMADA' | 'POSIBLE_GARANTIA';

export const OT_KIND_OPTIONS: { id: OtKindOption; label: string }[] = [
  { id: 'PROGRAMADA', label: 'Programada' },
  { id: 'NO_PROGRAMADA', label: 'No programada' },
  { id: 'POSIBLE_GARANTIA', label: 'Posible garantía' },
];

/** Subtipo cuando la OT es no programada: preventivo vs correctivo. */
export const NO_PLAN_SUBTYPE_OPTIONS: {
  id: 'PREVENTIVO' | 'CORRECTIVO';
  label: string;
}[] = [
  { id: 'PREVENTIVO', label: 'Preventivo' },
  { id: 'CORRECTIVO', label: 'Correctivo' },
];

/** Construye `classificationTags` para el API a partir del tipo único + subtipo NP. */
export function buildClassificationTagsFromKind(
  kind: OtKindOption,
  noPlanSubtype: 'PREVENTIVO' | 'CORRECTIVO',
): OtClassificationTag[] {
  if (kind === 'PROGRAMADA') return ['PROGRAMADA'];
  if (kind === 'POSIBLE_GARANTIA') return ['POSIBLE_GARANTIA'];
  if (kind === 'NO_PROGRAMADA') {
    if (noPlanSubtype === 'PREVENTIVO') {
      return ['NO_PROGRAMADA', 'NP_PREVENTIVO'];
    }
    return ['NO_PROGRAMADA', 'NP_CORRECTIVO'];
  }
  return ['PROGRAMADA'];
}

export function inferOtKindFromTags(
  tags: OtClassificationTag[],
): { kind: OtKindOption; noPlanSubtype: 'PREVENTIVO' | 'CORRECTIVO' } {
  const t = new Set(tags);
  if (t.has('POSIBLE_GARANTIA')) {
    return { kind: 'POSIBLE_GARANTIA', noPlanSubtype: 'CORRECTIVO' };
  }
  if (t.has('PROGRAMADA')) {
    return { kind: 'PROGRAMADA', noPlanSubtype: 'CORRECTIVO' };
  }
  if (t.has('NO_PROGRAMADA')) {
    return {
      kind: 'NO_PROGRAMADA',
      noPlanSubtype: t.has('NP_PREVENTIVO') ? 'PREVENTIVO' : 'CORRECTIVO',
    };
  }
  return { kind: 'PROGRAMADA', noPlanSubtype: 'CORRECTIVO' };
}

/** Orden de compartimientos fluidos — alineado al backend `FluidCompartment`. */
export const FLUID_COMPARTMENTS_ORDER: FluidCompartment[] = [
  'MOTOR',
  'TRANSMISION',
  'DIRECCION',
  'HIDRAULICO',
  'MANDOS',
  'DIFERENCIAL',
  'REFRIGERANTE',
  'OTROS',
];

export const FLUID_COMPARTMENT_LABELS: Record<FluidCompartment, string> = {
  MOTOR: 'Motor',
  TRANSMISION: 'Transmisión',
  DIRECCION: 'Dirección',
  HIDRAULICO: 'Hidráulico',
  MANDOS: 'Mandos',
  DIFERENCIAL: 'Diferencial',
  REFRIGERANTE: 'Refrigerante',
  OTROS: 'Otros',
};
