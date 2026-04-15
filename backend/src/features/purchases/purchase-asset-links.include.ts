/**
 * Selects compartidos para vínculos Equipo / OT en requerimientos y órdenes de compra.
 */
export const EQUIPMENT_LINK_SELECT = {
  select: {
    id: true,
    internalId: true,
    plate: true,
    brand: true,
    model: true,
    type: true,
  },
} as const;

export const WORK_ORDER_LINK_SELECT = {
  select: {
    id: true,
    correlative: true,
    description: true,
  },
} as const;
