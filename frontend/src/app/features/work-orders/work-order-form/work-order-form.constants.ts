import type {
  FluidCompartment,
  OtClassificationTag,
} from '../../../core/services/work-orders/work-orders.service';

export const CLASSIFICATION_OPTIONS: {
  id: OtClassificationTag;
  label: string;
}[] = [
  { id: 'PROGRAMADA', label: 'Programada' },
  { id: 'NO_PROGRAMADA', label: 'No programada' },
  { id: 'ACCIDENTE_INCIDENTE', label: 'Accidente / Incidente' },
  {
    id: 'OT_ABIERTA_CONTINUIDAD',
    label: 'OT abierta (cont. trabajos)',
  },
  {
    id: 'OT_ABIERTA_GEN_BCK',
    label: 'OT abierta generación BCK',
  },
  { id: 'POSIBLE_GARANTIA', label: 'Posible garantía' },
];

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
