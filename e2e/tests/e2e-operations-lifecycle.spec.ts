import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  OPERACIONES_USERS,
  API_BASE,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import { getUserIdByEmail } from '../helpers/api-operaciones';
import {
  bootstrapOperationsLifecycleSeed,
  deleteEquipmentApi,
  deleteInventoryItemApi,
  deleteWarehouseApi,
  getMeterLogsChronological,
  getStockRowApi,
  getWorkOrderApi,
  patchWorkOrderApi,
  updateWorkOrderStatusApi,
  type OperationsLifecycleSeed,
} from '../helpers/api-operations-lifecycle';
import {
  abrirHistorialMedidoresEquipo,
  crearArticuloEIngresarStock,
  crearBodegaMovil,
  crearOtConRepuesto,
  cerrarOT,
  despacharLubricante,
  ejecutarTransferencia,
} from '../helpers/operations-lifecycle.pom';
import { parseUiNumber } from '../helpers/ui';

/**
 * Ciclo E2E: Bodega móvil → ingreso → W2W → M1 → OT → historial de medidor.
 *
 * Aserciones de persistencia: Playwright `request` + JWT (helpers/api-operations-lifecycle).
 * Datos efímeros con prefijo E2E; teardown en afterAll (best-effort).
 */
test.describe.serial('Operaciones y fluidos — ciclo de vida integrado', () => {
  let ctx: OperationsLifecycleSeed | null = null;
  let adminToken = '';
  let planificadorToken = '';
  let mechanicUserId = '';
  let workOrderId = '';
  let otCorrelative = '';
  let mobileStockAfterM1 = 0;

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    const adminLogin = await apiLogin(INVENTARIO_USERS.admin);
    adminToken = adminLogin.token;
    ctx = await bootstrapOperationsLifecycleSeed(INVENTARIO_USERS.admin);
    if (!ctx) {
      throw new Error(
        'Setup E2E lifecycle falló: requiere tenant TPM, contrato, bodega principal, familia/UoM decimal y seed operaciones',
      );
    }
    const planLogin = await apiLogin(OPERACIONES_USERS.planificador);
    planificadorToken = planLogin.token;
    mechanicUserId = (await getUserIdByEmail(OPERACIONES_USERS.mecanico)) ?? '';
    if (!mechanicUserId) {
      throw new Error('Falta usuario mecánico seed (npm run seed:operaciones-pbac-personas)');
    }
  });

  test.afterAll(async () => {
    if (!ctx || !adminToken) return;
    if (ctx.itemId) await deleteInventoryItemApi(adminToken, ctx.itemId).catch(() => {});
    if (ctx.mobileWarehouseId) {
      await deleteWarehouseApi(adminToken, ctx.mobileWarehouseId).catch(() => {});
    }
    if (ctx.equipmentId) await deleteEquipmentApi(adminToken, ctx.equipmentId).catch(() => {});
  });

  test('1 — Bodega móvil (Camión Lubricador)', async ({ page, request, backendAvailable }) => {
    void backendAvailable;
    test.skip(!ctx, 'Sin contexto seed');

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.gestor, ctx!.contractId);
    const { warehouseId, code } = await crearBodegaMovil(page, ctx!);
    expect(warehouseId).toBeTruthy();
    expect(code).toMatch(/^CAM-E2E-/);

    const whRes = await request.get(`${API_BASE}/warehouses/${warehouseId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(whRes.ok()).toBeTruthy();
    const whBody = (await whRes.json()) as { name?: string; contractId?: string };
    expect(whBody.name).toMatch(/Camión Lubricador/i);
    expect(whBody.contractId).toBe(ctx!.contractId);
  });

  test('2 — Artículo fluido (litros) + ingreso bodega principal', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.mobileWarehouseId, 'Sin bodega móvil');

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.gestor, ctx!.contractId);
    await crearArticuloEIngresarStock(page, ctx!, ctx!.stockInQty);

    const row = await getStockRowApi(request, adminToken, ctx!.mainWarehouseId, ctx!.itemId);
    expect(row).not.toBeNull();
    expect(Number(row?.quantity ?? 0)).toBeCloseTo(ctx!.stockInQty, 2);
  });

  test('3 — Transferencia W2W principal → bodega móvil', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.itemId, 'Sin artículo');

    const qtyBeforeMain = Number(
      (await getStockRowApi(request, adminToken, ctx!.mainWarehouseId, ctx!.itemId))?.quantity ?? 0,
    );

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.gestor, ctx!.contractId);
    await ejecutarTransferencia(
      page,
      ctx!,
      ctx!.mainWarehouseId,
      ctx!.mobileWarehouseId,
      ctx!.transferQty,
    );

    const mainAfter = await getStockRowApi(request, adminToken, ctx!.mainWarehouseId, ctx!.itemId);
    const mobileAfter = await getStockRowApi(request, adminToken, ctx!.mobileWarehouseId, ctx!.itemId);

    expect(Number(mainAfter?.quantity ?? 0)).toBeCloseTo(qtyBeforeMain - ctx!.transferQty, 2);
    expect(Number(mobileAfter?.quantity ?? 0)).toBeCloseTo(ctx!.transferQty, 2);
  });

  test('4 — M1 despacho desde bodega móvil + integridad stock/medidor', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.itemId, 'Sin artículo');

    const mobileBefore = Number(
      (await getStockRowApi(request, adminToken, ctx!.mobileWarehouseId, ctx!.itemId))?.quantity ?? 0,
    );

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, ctx!.contractId);
    await despacharLubricante(
      page,
      ctx!,
      ctx!.equipmentInternalId,
      ctx!.m1DispatchQty,
      ctx!.meterAfterM1,
    );

    mobileStockAfterM1 = mobileBefore - ctx!.m1DispatchQty;
    const mobileRow = await getStockRowApi(
      request,
      adminToken,
      ctx!.mobileWarehouseId,
      ctx!.itemId,
    );
    expect(Number(mobileRow?.quantity ?? 0)).toBeCloseTo(mobileStockAfterM1, 2);

    const logs = await getMeterLogsChronological(request, adminToken, ctx!.equipmentId);
    const m1Log = logs.find(
      (l) =>
        l.source === 'MANUAL' &&
        Number(l.newValue) === ctx!.meterAfterM1 &&
        Number(l.oldValue) === ctx!.meterAfterBootstrap,
    );
    expect(m1Log).toBeTruthy();
  });

  test('5 — OT: reserva, consumo, cierre y rechazo de medidor regresivo', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.itemId, 'Sin artículo');

    await seedBrowserSessionWithContract(
      page,
      OPERACIONES_USERS.planificador,
      ctx!.contractId,
    );
    workOrderId = await crearOtConRepuesto(page, ctx!, ctx!.otConsumeQty + 1);

    await patchWorkOrderApi(planificadorToken, workOrderId, {
      shiftSupervisorUserId: mechanicUserId,
    });

    await patchWorkOrderApi(planificadorToken, workOrderId, {
      detentionFinalMeter: ctx!.meterAfterBootstrap - 50,
      finalMeter: ctx!.meterAfterBootstrap - 50,
    });
    const regressive = await updateWorkOrderStatusApi(
      planificadorToken,
      workOrderId,
      'CLOSED',
      ctx!.mobileWarehouseId,
      true,
    );
    expect(regressive.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(regressive.body)).toMatch(/medidor final/i);

    await patchWorkOrderApi(planificadorToken, workOrderId, {
      detentionFinalMeter: ctx!.meterAfterOt,
      finalMeter: ctx!.meterAfterOt,
    });

    await updateWorkOrderStatusApi(planificadorToken, workOrderId, 'IN_PROGRESS');

    await cerrarOT(
      page,
      ctx!,
      workOrderId,
      ctx!.meterAfterOt,
      ctx!.otConsumeQty,
      mechanicUserId,
      planificadorToken,
    );

    const wo = await getWorkOrderApi(request, planificadorToken, workOrderId);
    expect(String(wo?.status ?? '').toUpperCase()).toBe('CLOSED');
    expect(Number(wo?.finalMeter ?? 0)).toBe(ctx!.meterAfterOt);
    otCorrelative = String(wo?.correlative ?? '');

    const mobileRow = await getStockRowApi(
      request,
      adminToken,
      ctx!.mobileWarehouseId,
      ctx!.itemId,
    );
    expect(Number(mobileRow?.quantity ?? 0)).toBeCloseTo(
      mobileStockAfterM1 - ctx!.otConsumeQty,
      2,
    );

    const otLog = (await getMeterLogsChronological(request, adminToken, ctx!.equipmentId)).find(
      (l) => l.source === 'OT' && Number(l.newValue) === ctx!.meterAfterOt,
    );
    expect(otLog).toBeTruthy();
  });

  test('6 — Modal equipo: timeline medidor (bootstrap → M1 → OT)', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.equipmentId || !workOrderId, 'Sin equipo u OT');

    const logs = await getMeterLogsChronological(request, adminToken, ctx!.equipmentId);
    expect(logs.length).toBeGreaterThanOrEqual(3);

    const bootstrap = logs.find(
      (l) =>
        l.source === 'MANUAL' &&
        Number(l.newValue) === ctx!.meterAfterBootstrap &&
        Number(l.oldValue) === ctx!.initialMeter,
    );
    const m1 = logs.find(
      (l) =>
        l.source === 'MANUAL' &&
        Number(l.newValue) === ctx!.meterAfterM1 &&
        Number(l.oldValue) === ctx!.meterAfterBootstrap,
    );
    const ot = logs.find(
      (l) => l.source === 'OT' && Number(l.newValue) === ctx!.meterAfterOt,
    );
    expect(bootstrap).toBeTruthy();
    expect(m1).toBeTruthy();
    expect(ot).toBeTruthy();

    const ordered = [bootstrap!, m1!, ot!].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    expect(new Date(ordered[0].date).getTime()).toBeLessThanOrEqual(
      new Date(ordered[1].date).getTime(),
    );
    expect(new Date(ordered[1].date).getTime()).toBeLessThanOrEqual(
      new Date(ordered[2].date).getTime(),
    );

    expect(Number(m1!.newValue) - Number(m1!.oldValue)).toBeCloseTo(
      ctx!.meterAfterM1 - ctx!.meterAfterBootstrap,
      0,
    );
    expect(Number(ot!.newValue) - Number(ot!.oldValue)).toBeCloseTo(
      ctx!.meterAfterOt - ctx!.meterAfterM1,
      0,
    );

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, ctx!.contractId);
    const ui = await abrirHistorialMedidoresEquipo(page, ctx!.equipmentInternalId);

    expect(ui.sourceLabels.some((s) => /Manual/i.test(s))).toBe(true);
    if (otCorrelative) {
      expect(ui.sourceLabels.some((s) => s.includes(otCorrelative))).toBe(true);
    }
    expect(ui.readings.some((r) => parseUiNumber(r) === ctx!.meterAfterOt)).toBe(true);
  });
});
