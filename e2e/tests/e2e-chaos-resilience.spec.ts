import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  OPERACIONES_USERS,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import { getUserIdByEmail } from '../helpers/api-operaciones';
import {
  getMeterLogsChronological,
  patchWorkOrderApi,
  updateWorkOrderStatusApi,
  deleteEquipmentApi,
} from '../helpers/api-operations-lifecycle';
import {
  bootstrapChaosFixture,
  bulkSyncMeterReadingsApi,
  createLubeReportApi,
  createMeterBoardEquipments,
  createWorkOrderApi,
  fetchCatalogSystemId,
  getEquipmentCurrentMeter,
  getPhysicalStockQty,
  getStockReservationsApi,
  patchWorkOrderPartsApi,
  postLubeReportsConcurrently,
  sortMeterLogsByDateAsc,
  sortMeterLogsByIdDesc,
  sumLedgerOutQuantity,
  teardownChaosFixture,
  type ChaosFixture,
} from '../helpers/api-chaos';
import { resolveE2EPrimaryContractId } from '../helpers/api-operations-lifecycle';
import { parseUiNumber } from '../helpers/ui';
import {
  abrirHistorialMedidoresEquipo,
  clickSyncRegistroHoras,
  confirmLargeJumpModal,
  registrarHorasBulk,
} from '../helpers/operations-lifecycle.pom';

const DISPATCH_QTY = 8;
const INITIAL_STOCK = 10;

test.describe('Caos y resiliencia — integridad bajo presión', () => {
  test.describe('1 — Concurrencia API: doble POST /lube-reports', () => {
    let fx: ChaosFixture | null = null;
    let adminToken = '';

    test.beforeAll(async ({ backendAvailable }) => {
      void backendAvailable;
      const login = await apiLogin(INVENTARIO_USERS.admin);
      adminToken = login.token;
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
    });

    test.afterAll(async () => {
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('Serializable: no corrompe stock ante dos despachos simultáneos', async ({ request }) => {
      test.skip(!fx, 'Sin fixture');

      const preQty = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      expect(preQty).toBeCloseTo(INITIAL_STOCK, 2);

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const base = {
        contractId: fx!.contractId,
        equipmentId: fx!.equipmentId,
        warehouseId: fx!.mobileWarehouseId,
        dispatchDate: tomorrow,
        lines: [{ itemId: fx!.itemId, quantity: DISPATCH_QTY }],
      };

      const { statusA, statusB } = await postLubeReportsConcurrently(
        adminToken,
        base,
        { ...base, notes: 'E2E chaos concurrent B' },
      );

      const successes = [statusA, statusB].filter((s) => s < 300).length;
      expect(successes).toBeGreaterThanOrEqual(1);
      expect(successes).toBeLessThanOrEqual(2);

      const postQty = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      const ledgerOut = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );

      const maxPossibleOut = DISPATCH_QTY * successes;
      expect(ledgerOut).toBeCloseTo(maxPossibleOut, 2);
      expect(postQty).toBeCloseTo(preQty - ledgerOut, 2);

      if (successes === 2) {
        expect(postQty).toBeLessThanOrEqual(0);
        expect(ledgerOut).toBeCloseTo(DISPATCH_QTY * 2, 2);
      } else {
        expect(postQty).toBeCloseTo(preQty - DISPATCH_QTY, 2);
        expect(ledgerOut).toBeCloseTo(DISPATCH_QTY, 2);
      }
    });
  });

  test.describe('2 — Historial medidor: orden ASC por fecha (no por ID)', () => {
    let fx: ChaosFixture | null = null;
    let adminToken = '';
    let planificadorToken = '';
    let mechanicUserId = '';

    test.beforeAll(async ({ backendAvailable }) => {
      void backendAvailable;
      const adminLogin = await apiLogin(INVENTARIO_USERS.admin);
      adminToken = adminLogin.token;
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
      planificadorToken = (await apiLogin(OPERACIONES_USERS.planificador)).token;
      mechanicUserId = (await getUserIdByEmail(OPERACIONES_USERS.mecanico)) ?? '';
    });

    test.afterAll(async () => {
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('M1 (T+1) insertado antes que OT (T): timeline ASC coherente con API', async ({
      page,
      request,
    }) => {
      test.skip(!fx || !mechanicUserId, 'Sin fixture o mecánico seed');

      const meterM1 = 5020;
      const meterOt = 5035;
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

      const preLogs = await getMeterLogsChronological(request, adminToken, fx!.equipmentId);
      const preCount = preLogs.length;

      const m1Res = await createLubeReportApi(adminToken, {
        contractId: fx!.contractId,
        equipmentId: fx!.equipmentId,
        warehouseId: fx!.mobileWarehouseId,
        dispatchDate: new Date(Date.now() + 86_400_000).toISOString(),
        meterReading: meterM1,
        lines: [{ itemId: fx!.itemId, quantity: 1 }],
      });
      expect(m1Res.status).toBeLessThan(300);

      await new Promise((r) => setTimeout(r, 1200));

      const systemId = await fetchCatalogSystemId(planificadorToken);
      expect(systemId).toBeTruthy();

      const detStart = new Date(`${yesterday}T08:00:00`).toISOString();
      const detEnd = new Date(`${yesterday}T12:00:00`).toISOString();

      const otCreate = await createWorkOrderApi(
        planificadorToken,
        {
          equipmentId: fx!.equipmentId,
          warehouseId: fx!.mobileWarehouseId,
          detentionStartedAt: detStart,
          detentionEndedAt: detEnd,
          detentionInitialMeter: 5000,
          detentionFinalMeter: meterOt,
          mechanicAttentionStartedAt: detStart,
          mechanicAttentionEndedAt: detEnd,
          affectsAvailability: 'NO',
          classificationTags: ['NO_PROGRAMADA', 'NP_CORRECTIVO'],
          systems: [systemId!],
          symptomsText: 'E2E caos cronología OT',
          workPerformedDescription: 'Cierre con fecha pasada',
          responsibleMechanicName: 'E2E Chaos',
        },
        fx!.contractId,
      );
      expect(otCreate.status).toBeLessThan(300);
      const woId = String((otCreate.body as { id?: string })?.id ?? '');
      expect(woId).toBeTruthy();

      await patchWorkOrderApi(
        planificadorToken,
        woId,
        {
          shiftSupervisorUserId: mechanicUserId,
          detentionFinalMeter: meterOt,
          finalMeter: meterOt,
        },
        fx!.contractId,
      );
      await updateWorkOrderStatusApi(planificadorToken, woId, 'IN_PROGRESS', undefined, undefined, {
        contractId: fx!.contractId,
      });
      const closeRes = await updateWorkOrderStatusApi(
        planificadorToken,
        woId,
        'CLOSED',
        fx!.mobileWarehouseId,
        true,
        { confirmedLargeJump: true, contractId: fx!.contractId },
      );
      expect(closeRes.status, JSON.stringify(closeRes.body)).toBeLessThan(300);

      const logs = await getMeterLogsChronological(request, adminToken, fx!.equipmentId);
      expect(logs.length).toBeGreaterThanOrEqual(preCount + 2);

      const newLogs = logs.filter((l) => Number(l.newValue) === meterM1 || Number(l.newValue) === meterOt);
      expect(newLogs.length).toBeGreaterThanOrEqual(2);

      const byDate = sortMeterLogsByDateAsc(newLogs);
      const byIdDesc = sortMeterLogsByIdDesc(newLogs);

      expect(Number(byDate[0].newValue)).toBeLessThan(Number(byDate[1].newValue));
      expect(new Date(byDate[0].date).getTime()).toBeLessThanOrEqual(
        new Date(byDate[1].date).getTime(),
      );

      if (byIdDesc[0]?.id !== byDate[0]?.id) {
        expect(Number(byIdDesc[0].newValue)).not.toBe(Number(byDate[0].newValue));
      }

      await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, fx!.contractId);
      const ui = await abrirHistorialMedidoresEquipo(page, fx!.equipmentInternalId);
      const uiReadings = ui.readings.map(parseUiNumber).filter(Number.isFinite);
      const m1Idx = uiReadings.indexOf(meterM1);
      const otIdx = uiReadings.indexOf(meterOt);
      expect(m1Idx).toBeGreaterThanOrEqual(0);
      expect(otIdx).toBeGreaterThanOrEqual(0);
      expect(m1Idx).toBeLessThan(otIdx);
    });
  });

  test.describe('3 — Fuga de stock en OT (reserva 10 → consumo 15)', () => {
    let fx: ChaosFixture | null = null;
    let adminToken = '';
    let planificadorToken = '';
    let mechanicUserId = '';
    let workOrderId = '';

    test.beforeAll(async ({ backendAvailable }) => {
      void backendAvailable;
      adminToken = (await apiLogin(INVENTARIO_USERS.admin)).token;
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
      planificadorToken = (await apiLogin(OPERACIONES_USERS.planificador)).token;
      mechanicUserId = (await getUserIdByEmail(OPERACIONES_USERS.mecanico)) ?? '';
    });

    test.afterAll(async () => {
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('Post: kardex y stock físico no permiten salida silenciosa más allá del disponible', async ({
      request,
    }) => {
      test.skip(!fx || !mechanicUserId, 'Sin fixture');

      const reserveQty = 10;
      const consumeQty = 15;

      const preStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      expect(preStock).toBeCloseTo(INITIAL_STOCK, 2);

      const systemId = await fetchCatalogSystemId(planificadorToken);
      expect(systemId).toBeTruthy();

      const now = new Date();
      const detStart = new Date(now.getTime() - 4 * 3600_000).toISOString();
      const detEnd = new Date(now.getTime() - 1 * 3600_000).toISOString();

      const otCreate = await createWorkOrderApi(
        planificadorToken,
        {
          equipmentId: fx!.equipmentId,
          warehouseId: fx!.mobileWarehouseId,
          detentionStartedAt: detStart,
          detentionEndedAt: detEnd,
          detentionInitialMeter: 5000,
          detentionFinalMeter: 5012,
          mechanicAttentionStartedAt: detStart,
          mechanicAttentionEndedAt: detEnd,
          affectsAvailability: 'NO',
          classificationTags: ['NO_PROGRAMADA', 'NP_CORRECTIVO'],
          systems: [systemId!],
          symptomsText: 'E2E fuga stock OT',
          workPerformedDescription: 'Reserva vs consumo',
          responsibleMechanicName: 'E2E Chaos',
          parts: [
            {
              inventoryItemId: fx!.itemId,
              partNumber: fx!.itemPartNumber,
              description: 'Fluido OT caos',
              quantity: reserveQty,
            },
          ],
        },
        fx!.contractId,
      );
      expect(otCreate.status).toBeLessThan(300);
      workOrderId = String((otCreate.body as { id?: string })?.id ?? '');

      const preReservations = await getStockReservationsApi(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
        workOrderId,
      );
      expect(preReservations.reduce((s, r) => s + r.quantity, 0)).toBeCloseTo(reserveQty, 2);

      const patchStatus = await patchWorkOrderPartsApi(
        planificadorToken,
        workOrderId,
        [
          {
            inventoryItemId: fx!.itemId,
            partNumber: fx!.itemPartNumber,
            description: 'Fluido OT caos',
            quantity: consumeQty,
          },
        ],
        fx!.contractId,
      );

      if (patchStatus >= 400) {
        const reservationsAfterReject = await getStockReservationsApi(
          request,
          adminToken,
          fx!.mobileWarehouseId,
          fx!.itemId,
          workOrderId,
        );
        expect(reservationsAfterReject.reduce((s, r) => s + r.quantity, 0)).toBeCloseTo(
          reserveQty,
          2,
        );

        await patchWorkOrderApi(
          planificadorToken,
          workOrderId,
          {
            shiftSupervisorUserId: mechanicUserId,
            detentionFinalMeter: 5012,
            finalMeter: 5012,
          },
          fx!.contractId,
        );
        await updateWorkOrderStatusApi(
          planificadorToken,
          workOrderId,
          'IN_PROGRESS',
          undefined,
          undefined,
          { contractId: fx!.contractId },
        );

        const preLedgerOut = await sumLedgerOutQuantity(
          request,
          adminToken,
          fx!.itemId,
          fx!.mobileWarehouseId,
        );
        const closeRes = await updateWorkOrderStatusApi(
          planificadorToken,
          workOrderId,
          'CLOSED',
          fx!.mobileWarehouseId,
          true,
          { contractId: fx!.contractId },
        );
        expect(closeRes.status, JSON.stringify(closeRes.body)).toBeLessThan(300);

        const postLedgerOut = await sumLedgerOutQuantity(
          request,
          adminToken,
          fx!.itemId,
          fx!.mobileWarehouseId,
        );
        expect(postLedgerOut - preLedgerOut).toBeCloseTo(reserveQty, 2);
        expect(postLedgerOut - preLedgerOut).not.toBeCloseTo(consumeQty, 2);
        return;
      }

      expect(patchStatus).toBeLessThan(300);

      const postPatchReservations = await getStockReservationsApi(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
        workOrderId,
      );
      expect(postPatchReservations.reduce((s, r) => s + r.quantity, 0)).toBeCloseTo(consumeQty, 2);

      await patchWorkOrderApi(
        planificadorToken,
        workOrderId,
        {
          shiftSupervisorUserId: mechanicUserId,
          detentionFinalMeter: 5012,
          finalMeter: 5012,
        },
        fx!.contractId,
      );
      await updateWorkOrderStatusApi(
        planificadorToken,
        workOrderId,
        'IN_PROGRESS',
        undefined,
        undefined,
        { contractId: fx!.contractId },
      );

      const preLedgerOut = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );

      const closeRes = await updateWorkOrderStatusApi(
        planificadorToken,
        workOrderId,
        'CLOSED',
        fx!.mobileWarehouseId,
        true,
        { contractId: fx!.contractId },
      );

      const postStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      const postLedgerOut = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );
      const ledgerDelta = postLedgerOut - preLedgerOut;

      if (closeRes.status >= 400) {
        expect(ledgerDelta).toBeCloseTo(0, 2);
        expect(postStock).toBeCloseTo(preStock, 2);
        expect(JSON.stringify(closeRes.body)).toMatch(/stock|insuficiente|bodega|cantidad/i);
      } else {
        expect(ledgerDelta).toBeCloseTo(consumeQty, 2);
        expect(postStock).toBeCloseTo(preStock - consumeQty, 2);
        expect(postStock).toBeLessThan(0);
      }

      expect(ledgerDelta).not.toBeCloseTo(consumeQty * 2, 2);
    });
  });

  test.describe('4 — Registro masivo de horas: errores humanos', () => {
    let adminToken = '';
    let contractId = '';
    let runId = '';
    let meterEquipIds: string[] = [];

    test.beforeAll(async ({ backendAvailable }) => {
      void backendAvailable;
      const login = await apiLogin(INVENTARIO_USERS.admin);
      adminToken = login.token;
      contractId = (await resolveE2EPrimaryContractId()) ?? '';
      if (!contractId) throw new Error('Sin contrato para caos medidor');
      runId = `m${Date.now().toString(36)}`;
      const board = await createMeterBoardEquipments(adminToken, contractId, runId, 10);
      meterEquipIds = board.map((b) => b.id);
      if (meterEquipIds.length < 10) throw new Error('No se pudieron crear 10 equipos caos');
    });

    test.afterAll(async () => {
      for (const id of meterEquipIds) {
        await deleteEquipmentApi(adminToken, id).catch(() => {});
      }
    });

    test('API bulk-sync: 2 OK · 5 regresivos · 3 saltos (confirmación en 2.ª pasada)', async ({
      request,
    }) => {
      const board = meterEquipIds.map((id, i) => ({
        id,
        currentMeter: 1000 + i * 10,
      }));

      const items = board.map((row, i) => {
        let newReading = row.currentMeter;
        if (i < 2) newReading = row.currentMeter + 1;
        else if (i < 7) newReading = row.currentMeter - 5;
        else newReading = row.currentMeter + 30;
        return { equipmentId: row.id, newReading };
      });

      const preMeters = await Promise.all(
        board.map((b) => getEquipmentCurrentMeter(request, adminToken, b.id)),
      );

      const first = await bulkSyncMeterReadingsApi(adminToken, items, contractId);
      expect(first.status).toBeLessThan(300);
      expect(first.body?.applied.length).toBe(2);
      expect(first.body?.errors.filter((e) => e.error === 'READING_LOWER_THAN_CURRENT').length).toBe(
        5,
      );
      expect(
        first.body?.errors.filter((e) => e.error === 'READING_JUMP_REQUIRES_CONFIRMATION').length,
      ).toBe(3);

      const jumpItems = items.slice(7).map((it) => ({ ...it, confirmedLargeJump: true }));
      const second = await bulkSyncMeterReadingsApi(adminToken, jumpItems, contractId);
      expect(second.status).toBeLessThan(300);
      expect(second.body?.applied.length).toBe(3);

      for (let i = 0; i < 2; i++) {
        const meter = await getEquipmentCurrentMeter(request, adminToken, board[i].id);
        expect(meter).toBe(board[i].currentMeter + 1);
      }
      for (let i = 2; i < 7; i++) {
        const meter = await getEquipmentCurrentMeter(request, adminToken, board[i].id);
        expect(meter).toBe(preMeters[i]);
      }
      for (let i = 7; i < 10; i++) {
        const meter = await getEquipmentCurrentMeter(request, adminToken, board[i].id);
        expect(meter).toBe(board[i].currentMeter + 30);
      }
    });

    test('UI registro-horas: bloquea regresivos; modal confirma saltos altos', async ({
      page,
      request,
    }) => {
      const uiRun = `u${Date.now().toString(36)}`;
      const uiBoard = await createMeterBoardEquipments(adminToken, contractId, uiRun, 5);
      const uiIds = uiBoard.map((b) => b.id);

      try {
        const readings = uiBoard.map((row, i) => {
          let value = row.currentMeter;
          if (i < 2) value = row.currentMeter + 1;
          else value = row.currentMeter + 30;
          return { equipmentId: row.id, value };
        });

        await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, contractId);

        await registrarHorasBulk(page, `CHAOS-M-${uiRun.slice(-4)}`, readings);

        const bulkResponse = page.waitForResponse(
          (r) =>
            r.url().includes('/equipments/meter-readings/bulk-sync') &&
            r.request().method() === 'POST',
          { timeout: 45_000 },
        );

        await clickSyncRegistroHoras(page);
        await confirmLargeJumpModal(page);
        const syncRes = await bulkResponse;
        expect(syncRes.status()).toBeLessThan(300);

        for (let i = 0; i < 2; i++) {
          await expect
            .poll(async () => getEquipmentCurrentMeter(request, adminToken, uiBoard[i].id), {
              timeout: 20_000,
            })
            .toBe(uiBoard[i].currentMeter + 1);
        }
        for (let i = 2; i < 5; i++) {
          await expect
            .poll(async () => getEquipmentCurrentMeter(request, adminToken, uiBoard[i].id), {
              timeout: 20_000,
            })
            .toBe(uiBoard[i].currentMeter + 30);
        }

        await registrarHorasBulk(page, `CHAOS-M-${uiRun.slice(-4)}`, [
          { equipmentId: uiBoard[0].id, value: uiBoard[0].currentMeter - 10 },
        ]);

        let bulkCalled = false;
        page.on('request', (r) => {
          if (r.url().includes('/equipments/meter-readings/bulk-sync') && r.method() === 'POST') {
            bulkCalled = true;
          }
        });

        const syncBtn = page.getByRole('button', { name: 'Sincronizar lecturas' });
        await expect(syncBtn).toBeDisabled();
        expect(bulkCalled).toBe(false);

        const meterUnchanged = await getEquipmentCurrentMeter(request, adminToken, uiBoard[0].id);
        expect(meterUnchanged).toBe(uiBoard[0].currentMeter + 1);
      } finally {
        for (const id of uiIds) {
          await deleteEquipmentApi(adminToken, id).catch(() => {});
        }
      }
    });
  });
});
