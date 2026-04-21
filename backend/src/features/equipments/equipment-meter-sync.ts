import { MeterLogSource, Prisma } from '@prisma/client';

export type MeterChangeTx = Prisma.TransactionClient;

/**
 * Registra el cambio de medidor y actualiza `equipment.currentMeter`.
 * Las proyecciones PM en cliente/servidor usan `computePmProjection` leyendo el medidor actualizado.
 */
export async function applyCurrentMeterChange(
  tx: MeterChangeTx,
  params: {
    tenantId: string;
    equipmentId: string;
    oldMeter: number;
    newMeter: number;
    source: MeterLogSource;
    sourceId?: string | null;
    userId: string;
    date?: Date;
  },
): Promise<void> {
  if (params.oldMeter === params.newMeter) {
    return;
  }

  await tx.equipmentMeterLog.create({
    data: {
      tenantId: params.tenantId,
      equipmentId: params.equipmentId,
      oldValue: new Prisma.Decimal(params.oldMeter),
      newValue: new Prisma.Decimal(params.newMeter),
      source: params.source,
      sourceId: params.sourceId ?? null,
      userId: params.userId,
      date: params.date ?? new Date(),
    },
  });

  await tx.equipment.update({
    where: { id: params.equipmentId },
    data: { currentMeter: params.newMeter },
  });
}
