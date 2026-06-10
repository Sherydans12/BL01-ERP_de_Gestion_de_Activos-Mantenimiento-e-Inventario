import { test, expect } from '../../fixtures/operaciones.fixture';
import {
  OPERACIONES_USERS,
  seedBrowserSession,
  seedBrowserSessionWithContract,
  apiLogin,
} from '../../helpers/auth';
import {
  buildOtE2ESetup,
  findWarehouseInOtherContract,
  getItemLedger,
  getStockReservations,
  getStockRow,
  getWorkOrder,
  patchWorkOrder,
  updateWorkOrderStatus,
  type OtE2ESetup,
} from '../../helpers/api-operaciones';
import {
  addPartLineWithPicker,
  fillOtCreateForm,
  saveOtForm,
} from '../../helpers/ot-form';
import { waitForPageReady } from '../../helpers/ui';

const RESERVE_QTY = 5;
const CONSUME_QTY = 3;

test.describe.serial('Operaciones × Inventario — ciclo OT reserva → consumo → cierre', () => {
  let ctx: OtE2ESetup | null = null;
  let workOrderId = '';
  let otCorrelative = '';
  let physicalBefore = 0;
  let availableBefore = 0;
  let reservedBefore = 0;

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    ctx = await buildOtE2ESetup(OPERACIONES_USERS.planificador);
    if (!ctx) {
      throw new Error('Setup OT E2E falló: requiere equipo, bodega con stock y personas seed');
    }
    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    const row = await getStockRow(token, ctx.warehouseId, ctx.itemId);
    physicalBefore = Number(row?.quantity ?? 0);
    availableBefore = Number(row?.availableQuantity ?? physicalBefore);
    reservedBefore = Number(row?.reservedQuantity ?? 0);
    if (physicalBefore < CONSUME_QTY + 2 || availableBefore < RESERVE_QTY) {
      throw new Error(
        `Stock insuficiente para E2E (físico=${physicalBefore}, disponible=${availableBefore})`,
      );
    }
  });

  test('fase A — planificador: OT con reserva sin mover stock físico', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx, 'Sin contexto E2E');

    await seedBrowserSessionWithContract(
      page,
      OPERACIONES_USERS.planificador,
      ctx!.contractId,
    );

    await fillOtCreateForm(page, {
      equipmentId: ctx!.equipmentId,
      warehouseId: ctx!.warehouseId,
      initialMeter: ctx!.initialMeter,
      finalMeter: ctx!.initialMeter + 10,
    });
    await addPartLineWithPicker(page, ctx!.itemSearchHint, RESERVE_QTY);

    const createRes = await saveOtForm(page, true);
    const body = (await createRes.json()) as { id?: string };
    workOrderId = body.id ?? page.url().split('/').pop() ?? '';
    expect(workOrderId).toBeTruthy();

    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    await patchWorkOrder(token, workOrderId, {
      shiftSupervisorUserId: ctx!.mechanicUserId,
    });

    const wo = await getWorkOrder(token, workOrderId);
    expect(String(wo?.status ?? '').toUpperCase()).toBe('OPEN');
    otCorrelative = String(wo?.correlative ?? '');

    const reservations = await getStockReservations(token, ctx!.warehouseId, ctx!.itemId);
    const ours = reservations.filter((r) => r.workOrder?.id === workOrderId);
    expect(ours.reduce((s, r) => s + Number(r.quantity), 0)).toBe(RESERVE_QTY);

    const stock = await getStockRow(token, ctx!.warehouseId, ctx!.itemId);
    expect(Number(stock?.quantity ?? 0)).toBeCloseTo(physicalBefore, 3);
    expect(Number(stock?.reservedQuantity ?? 0)).toBeCloseTo(reservedBefore + RESERVE_QTY, 3);
    expect(Number(stock?.availableQuantity ?? 0)).toBeCloseTo(
      availableBefore - RESERVE_QTY,
      3,
    );
  });

  test('fase B — mecánico supervisor: IN_PROGRESS y consumo real (qty 3)', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx || !workOrderId, 'Sin OT de fase A');

    await seedBrowserSessionWithContract(
      page,
      OPERACIONES_USERS.mecanico,
      ctx!.contractId,
    );
    await page.goto('/app/ots');
    await waitForPageReady(page);

    const search = otCorrelative || workOrderId.slice(0, 8);
    const row = page.locator('tbody tr').filter({ hasText: search }).first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.getByRole('button', { name: 'INICIAR TRABAJO' }).click();
    await page.waitForTimeout(1500);

    await page.goto(`/app/ots/${workOrderId}`);
    await waitForPageReady(page);

    await page.getByRole('tab', { name: /Repuestos y stock/i }).click();
    await page.locator('input[formControlName="quantity"]').first().fill(String(CONSUME_QTY));
    await saveOtForm(page, false);

    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    const reservations = await getStockReservations(token, ctx!.warehouseId, ctx!.itemId);
    const ours = reservations.filter((r) => r.workOrder?.id === workOrderId);
    expect(ours.reduce((s, r) => s + Number(r.quantity), 0)).toBe(CONSUME_QTY);

    const stock = await getStockRow(token, ctx!.warehouseId, ctx!.itemId);
    expect(Number(stock?.quantity ?? 0)).toBeCloseTo(physicalBefore, 3);
  });

  test('fase C — planificador: cierre libera reserva y genera WORK_ORDER_ISSUE', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx || !workOrderId, 'Sin OT de fases previas');

    const finalMeter = ctx!.initialMeter + 12;
    await seedBrowserSessionWithContract(
      page,
      OPERACIONES_USERS.planificador,
      ctx!.contractId,
    );
    await page.goto(`/app/ots/${workOrderId}`);
    await waitForPageReady(page);

    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    await patchWorkOrder(token, workOrderId, {
      detentionFinalMeter: finalMeter,
      finalMeter,
    });

    const closeRes = await updateWorkOrderStatus(
      token,
      workOrderId,
      'CLOSED',
      ctx!.warehouseId,
      true,
    );
    expect(closeRes.status).toBeLessThan(300);

    const wo = await getWorkOrder(token, workOrderId);
    expect(String(wo?.status ?? '').toUpperCase()).toBe('CLOSED');
    expect(Number(wo?.finalMeter ?? 0)).toBe(finalMeter);

    const reservations = await getStockReservations(token, ctx!.warehouseId, ctx!.itemId);
    expect(reservations.filter((r) => r.workOrder?.id === workOrderId)).toHaveLength(0);

    const stock = await getStockRow(token, ctx!.warehouseId, ctx!.itemId);
    expect(Number(stock?.quantity ?? 0)).toBeCloseTo(physicalBefore - CONSUME_QTY, 3);

    const ledger = await getItemLedger(token, ctx!.itemId, ctx!.warehouseId);
    expect(
      ledger.some(
        (l) =>
          l.type === 'WORK_ORDER_ISSUE' &&
          Number(l.quantity) === CONSUME_QTY,
      ),
    ).toBe(true);

    await page.goto('/app/ots');
    await waitForPageReady(page);
    await expect(page.getByText('CERRADA').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Operaciones × Inventario — negativos terreno', () => {
  test('horómetro final menor al inicial bloquea cierre', async ({ backendAvailable }) => {
    void backendAvailable;

    const ctx = await buildOtE2ESetup(OPERACIONES_USERS.planificador);
    test.skip(!ctx, 'Sin contexto E2E');

    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    const systemsRes = await fetch(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/catalogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const systems = (await systemsRes.json()) as { id: string; type?: string }[];
    const systemId = systems.find((s) => String(s.type ?? '').toUpperCase() === 'SYSTEM')?.id ?? systems[0]?.id;
    test.skip(!systemId, 'Sin catálogo SYSTEM');

    const now = new Date();
    const detStart = new Date(now.getTime() - 4 * 3600_000);
    const detEnd = new Date(now.getTime() - 1 * 3600_000);
    const createRes = await fetch(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/work-orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: ctx!.equipmentId,
        warehouseId: ctx!.warehouseId,
        detentionStartedAt: detStart.toISOString(),
        detentionEndedAt: detEnd.toISOString(),
        detentionInitialMeter: 1000,
        detentionFinalMeter: 500,
        mechanicAttentionStartedAt: detStart.toISOString(),
        mechanicAttentionEndedAt: detEnd.toISOString(),
        affectsAvailability: 'NO',
        classificationTags: ['NO_PROGRAMADA', 'NP_CORRECTIVO'],
        systems: [systemId],
        symptomsText: 'E2E negativo medidor',
        workPerformedDescription: 'Prueba cierre inválido',
        responsibleMechanicName: 'E2E',
      }),
    });
    expect(createRes.status).toBeLessThan(300);
    const created = (await createRes.json()) as { id: string };
    const woId = created.id;

    await updateWorkOrderStatus(token, woId, 'IN_PROGRESS');

    const statusRes = await updateWorkOrderStatus(token, woId, 'CLOSED');
    expect(statusRes.status).toBeGreaterThanOrEqual(400);
    const msg = JSON.stringify(statusRes.body);
    expect(msg).toMatch(/medidor final/i);
  });

  test('bodega de otro contrato rechazada en API (aislamiento)', async ({ backendAvailable }) => {
    void backendAvailable;

    const ctx = await buildOtE2ESetup(OPERACIONES_USERS.planificador);
    test.skip(!ctx, 'Sin contexto E2E');

    const { token } = await apiLogin(OPERACIONES_USERS.planificador);
    const foreignWh = await findWarehouseInOtherContract(token, ctx!.contractId);
    test.skip(!foreignWh, 'Se requieren ≥2 contratos con bodegas para aislamiento');

    const systemsRes = await fetch(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/catalogs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const systems = (await systemsRes.json()) as { id: string }[];
    test.skip(!systems.length, 'Sin catálogo');

    const createRes = await fetch(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/work-orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId: ctx!.equipmentId,
        warehouseId: foreignWh!.id,
        detentionStartedAt: new Date().toISOString(),
        detentionEndedAt: new Date().toISOString(),
        detentionInitialMeter: ctx!.initialMeter,
        mechanicAttentionStartedAt: new Date().toISOString(),
        mechanicAttentionEndedAt: new Date().toISOString(),
        affectsAvailability: 'NO',
        classificationTags: ['NO_PROGRAMADA', 'NP_CORRECTIVO'],
        systems: [systems[0].id],
        symptomsText: 'E2E cross-contract',
        workPerformedDescription: 'Debe fallar',
        responsibleMechanicName: 'E2E',
        parts: [
          {
            inventoryItemId: ctx!.itemId,
            partNumber: 'E2E',
            description: 'Repuesto',
            quantity: 1,
          },
        ],
      }),
    });
    expect(createRes.status).toBeGreaterThanOrEqual(400);
    const bodyText = JSON.stringify(await createRes.json());
    expect(bodyText).toMatch(/bodega|contrato|válida/i);
  });
});
