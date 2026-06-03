import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { MeterLogSource, Prisma } from '@prisma/client';
import { applyCurrentMeterChange } from './equipment-meter-sync';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const tenantId    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const equipmentId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const userId      = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const sourceId    = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const baseParams = {
  tenantId,
  equipmentId,
  source: MeterLogSource.MANUAL,
  userId,
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('applyCurrentMeterChange — reglas de negocio del horómetro', () => {
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(() => {
    tx = mockDeep<Prisma.TransactionClient>();
    tx.equipmentMeterLog.create.mockResolvedValue({} as never);
    tx.equipment.update.mockResolvedValue({} as never);
  });

  // ── Caso 1: Happy Path ─────────────────────────────────────────────────────

  it('Caso 1 (Happy Path): registra el log y actualiza currentMeter cuando newMeter > oldMeter', async () => {
    await applyCurrentMeterChange(tx, { ...baseParams, oldMeter: 1000, newMeter: 1050 });

    // Debe crear exactamente un log con los Decimals correctos
    expect(tx.equipmentMeterLog.create).toHaveBeenCalledTimes(1);
    expect(tx.equipmentMeterLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        equipmentId,
        oldValue: new Prisma.Decimal(1000),
        newValue: new Prisma.Decimal(1050),
        source: MeterLogSource.MANUAL,
        sourceId: null,
        userId,
      }),
    });

    // Debe actualizar el campo currentMeter del equipo
    expect(tx.equipment.update).toHaveBeenCalledTimes(1);
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { currentMeter: 1050 },
    });
  });

  // ── Caso 2: Silent Skip ────────────────────────────────────────────────────
  // El helper solo guarda contra oldMeter === newMeter.
  // La protección contra "newMeter < oldMeter" vive en cada servicio consumidor
  // (M1 lanza BadRequestException; M2/M3 no llaman al helper si el metro retrocede).

  it('Caso 2 (Silent Skip): no toca la DB cuando oldMeter === newMeter (horómetro estacionario)', async () => {
    await applyCurrentMeterChange(tx, { ...baseParams, oldMeter: 1050, newMeter: 1050 });

    expect(tx.equipmentMeterLog.create).not.toHaveBeenCalled();
    expect(tx.equipment.update).not.toHaveBeenCalled();
  });

  // ── Caso 3: fuente AVAILABILITY_REPORT (M2) ────────────────────────────────

  it('persiste fuente AVAILABILITY_REPORT con su sourceId cuando viene de M2', async () => {
    await applyCurrentMeterChange(tx, {
      ...baseParams,
      oldMeter: 2000,
      newMeter: 2150,
      source: MeterLogSource.AVAILABILITY_REPORT,
      sourceId,
    });

    expect(tx.equipmentMeterLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: MeterLogSource.AVAILABILITY_REPORT,
        sourceId,
        oldValue: new Prisma.Decimal(2000),
        newValue: new Prisma.Decimal(2150),
      }),
    });
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { currentMeter: 2150 },
    });
  });

  // ── Caso 4: fuente FAULT_REPORT (M3) ─────────────────────────────────────

  it('persiste fuente FAULT_REPORT con su sourceId cuando viene de M3', async () => {
    await applyCurrentMeterChange(tx, {
      ...baseParams,
      oldMeter: 3000,
      newMeter: 3100,
      source: MeterLogSource.FAULT_REPORT,
      sourceId,
    });

    expect(tx.equipmentMeterLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: MeterLogSource.FAULT_REPORT,
        sourceId,
        oldValue: new Prisma.Decimal(3000),
        newValue: new Prisma.Decimal(3100),
      }),
    });
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { currentMeter: 3100 },
    });
  });

  // ── Caso 5: fecha explícita ────────────────────────────────────────────────

  it('respeta la fecha explícita en el log cuando se provee en el parámetro date', async () => {
    const explicitDate = new Date('2026-06-01T08:00:00Z');

    await applyCurrentMeterChange(tx, {
      ...baseParams,
      oldMeter: 500,
      newMeter: 600,
      date: explicitDate,
    });

    expect(tx.equipmentMeterLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ date: explicitDate }),
    });
  });

  // ── Caso 6: sourceId omitido → persiste null ──────────────────────────────

  it('persiste sourceId como null cuando no se provee (fuente MANUAL sin referencia documental)', async () => {
    await applyCurrentMeterChange(tx, { ...baseParams, oldMeter: 100, newMeter: 200 });

    expect(tx.equipmentMeterLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceId: null }),
    });
  });

  // ── Caso 7: orden de operaciones — el log se crea ANTES de la actualización ──

  it('ordena correctamente: crea el log antes de actualizar equipment.currentMeter', async () => {
    const callOrder: string[] = [];

    tx.equipmentMeterLog.create.mockImplementation(async () => {
      callOrder.push('log');
      return {} as never;
    });
    tx.equipment.update.mockImplementation(async () => {
      callOrder.push('update');
      return {} as never;
    });

    await applyCurrentMeterChange(tx, { ...baseParams, oldMeter: 400, newMeter: 450 });

    expect(callOrder).toEqual(['log', 'update']);
  });
});
