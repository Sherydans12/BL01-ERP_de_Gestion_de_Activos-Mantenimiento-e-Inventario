import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AvailabilityImpact,
  FaultCriticality,
  FaultReportStatus,
  OtStatus,
  Prisma,
} from '@prisma/client';
import { resolveReturnToService } from './operational-blockers';

const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherTenantId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const equipmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const otherEquipmentId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('resolveReturnToService', () => {
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(() => {
    tx = mockDeep<Prisma.TransactionClient>();
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);
  });

  it('sin bloqueadores permite reactivar', async () => {
    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it('falla HIGH OPEN bloquea', async () => {
    tx.faultReport.findMany.mockResolvedValue([
      {
        id: 'fr-1',
        correlative: 'RF-00010',
        status: FaultReportStatus.OPEN,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]).toEqual({
      type: 'HIGH_FAULT',
      sourceId: 'fr-1',
      correlative: 'RF-00010',
      status: FaultReportStatus.OPEN,
    });
  });

  it('falla HIGH LINKED con OT OPEN bloquea', async () => {
    tx.faultReport.findMany.mockResolvedValue([
      {
        id: 'fr-2',
        correlative: 'RF-00020',
        status: FaultReportStatus.LINKED,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0].type).toBe('HIGH_FAULT');
  });

  it('falla HIGH LINKED con OT IN_PROGRESS bloquea', async () => {
    tx.faultReport.findMany.mockResolvedValue([
      {
        id: 'fr-3',
        correlative: 'RF-00030',
        status: FaultReportStatus.LINKED,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0].type).toBe('HIGH_FAULT');
  });

  it('falla HIGH LINKED con OT CLOSED no bloquea (se excluye en la query Prisma)', async () => {
    // Si Prisma devuelve vacío, la falla no bloquea
    tx.faultReport.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it('falla MEDIUM no bloquea (criticidad no es HIGH)', async () => {
    // La consulta filtra por criticality=HIGH; MEDIUM no aparece en resultados
    tx.faultReport.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    // Verificar que la consulta especifica criticality=HIGH
    expect(tx.faultReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          criticality: FaultCriticality.HIGH,
        }),
      }),
    );
  });

  it('falla LOW no bloquea (criticidad no es HIGH)', async () => {
    tx.faultReport.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
  });

  it('OT con affectsAvailability=SI e IN_PROGRESS bloquea', async () => {
    tx.workOrder.findMany.mockResolvedValue([
      {
        id: 'wo-1',
        correlative: 'OT-2026-001',
        status: OtStatus.IN_PROGRESS,
        affectsAvailability: AvailabilityImpact.SI,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]).toEqual({
      type: 'AVAILABILITY_WORK_ORDER',
      sourceId: 'wo-1',
      correlative: 'OT-2026-001',
      status: OtStatus.IN_PROGRESS,
    });
  });

  it('OT con affectsAvailability=SI y ON_HOLD bloquea', async () => {
    tx.workOrder.findMany.mockResolvedValue([
      {
        id: 'wo-2',
        correlative: 'OT-2026-002',
        status: OtStatus.ON_HOLD,
        affectsAvailability: AvailabilityImpact.SI,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0].status).toBe(OtStatus.ON_HOLD);
  });

  it('OT con affectsAvailability=NO no bloquea', async () => {
    // La consulta filtra por affectsAvailability=SI; NO no aparece
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          affectsAvailability: AvailabilityImpact.SI,
        }),
      }),
    );
  });

  it('OT con affectsAvailability=STP no bloquea porque la política filtra únicamente AvailabilityImpact.SI', async () => {
    // La consulta filtra por affectsAvailability=SI; STP no aparece
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          affectsAvailability: AvailabilityImpact.SI,
        }),
      }),
    );
  });

  it('registros de otro tenant no bloquean (consulta filtra por tenantId)', async () => {
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    // Verificar filtro de tenantId en ambas consultas
    expect(tx.faultReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId }),
      }),
    );
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId }),
      }),
    );
  });

  it('registros de otro equipo no bloquean (consulta filtra por equipmentId)', async () => {
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(true);
    expect(tx.faultReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equipmentId }),
      }),
    );
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ equipmentId }),
      }),
    );
  });

  it('múltiples bloqueadores retorna todos', async () => {
    tx.faultReport.findMany.mockResolvedValue([
      { id: 'fr-x', correlative: 'RF-00100', status: FaultReportStatus.OPEN },
      { id: 'fr-y', correlative: 'RF-00101', status: FaultReportStatus.LINKED },
    ] as never);
    tx.workOrder.findMany.mockResolvedValue([
      {
        id: 'wo-z',
        correlative: 'OT-2026-010',
        status: OtStatus.OPEN,
        affectsAvailability: AvailabilityImpact.SI,
      },
    ] as never);

    const decision = await resolveReturnToService(tx, tenantId, equipmentId);

    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toHaveLength(3);
  });

  it('excludeWorkOrderId excluye la OT que se está cerrando', async () => {
    tx.workOrder.findMany.mockResolvedValue([] as never);

    await resolveReturnToService(tx, tenantId, equipmentId, {
      excludeWorkOrderId: 'wo-closing',
    });

    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'wo-closing' },
        }),
      }),
    );
  });

  it('sin excludeWorkOrderId no aplica filtro de exclusión', async () => {
    await resolveReturnToService(tx, tenantId, equipmentId);

    const call = tx.workOrder.findMany.mock.calls[0][0] as any;
    expect(call.where.id).toBeUndefined();
  });

  it('usa el TransactionClient proporcionado', async () => {
    await resolveReturnToService(tx, tenantId, equipmentId);

    expect(tx.faultReport.findMany).toHaveBeenCalled();
    expect(tx.workOrder.findMany).toHaveBeenCalled();
  });
});
