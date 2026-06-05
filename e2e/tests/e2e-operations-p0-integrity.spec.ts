import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  OPERACIONES_USERS,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import { getUserIdByEmail } from '../helpers/api-operaciones';
import { createFaultReportApi } from '../helpers/api-fault-reports';
import {
  getOperationalConfig,
  patchOperationalConfig,
  type TenantOperationalSnapshot,
} from '../helpers/api-tenant-config';
import {
  bootstrapChaosFixture,
  createLubeReportApi,
  createWorkOrderApi,
  fetchCatalogSystemId,
  getPhysicalStockQty,
  patchWorkOrderPartsApi,
  sumLedgerOutQuantity,
  teardownChaosFixture,
  type ChaosFixture,
} from '../helpers/api-chaos';
import {
  createEquipmentApi,
  deleteEquipmentApi,
  patchWorkOrderApi,
  resolveE2EPrimaryContractId,
  updateWorkOrderStatusApi,
} from '../helpers/api-operations-lifecycle';
import { pickCatalogItem } from '../helpers/item-picker';
import {
  selectOptionWhenReady,
  setReactiveInput,
  waitForPageReady,
} from '../helpers/ui';
import { API_BASE } from '../helpers/auth';

const INITIAL_STOCK = 10;
const OVER_DISPATCH = 15;
const OT_RESERVE = 10;
const OT_OVER_CONSUME = 15;

test.describe('P0 — Integridad transversal operaciones', () => {
  let operationalSnapshot: TenantOperationalSnapshot | null = null;
  let adminToken = '';

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    const login = await apiLogin(INVENTARIO_USERS.admin);
    adminToken = login.token;
    operationalSnapshot = await getOperationalConfig(adminToken);
    const patchRes = await patchOperationalConfig(adminToken, {
      blockNegativeStock: true,
    });
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBeLessThan(300);
  });

  test.afterAll(async () => {
    if (!adminToken) return;
    const restore: TenantOperationalSnapshot = {
      blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
    };
    if (operationalSnapshot?.hasNightShift !== undefined) {
      restore.hasNightShift = operationalSnapshot.hasNightShift;
    }
    if (operationalSnapshot?.dayShiftStartTime) {
      restore.dayShiftStartTime = operationalSnapshot.dayShiftStartTime;
    }
    if (operationalSnapshot?.nightShiftStartTime) {
      restore.nightShiftStartTime = operationalSnapshot.nightShiftStartTime;
    }
    await patchOperationalConfig(adminToken, restore).catch(() => {});
  });

  test.describe('1 — blockNegativeStock: M1 UI', () => {
    let fx: ChaosFixture | null = null;

    test.beforeAll(async () => {
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
    });

    test.afterAll(async () => {
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('despacho > stock bloquea Guardar; kardex sin movimiento', async ({ page, request }) => {
      test.skip(!fx, 'Sin fixture');

      const preStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      expect(preStock).toBeCloseTo(INITIAL_STOCK, 2);

      const preLedger = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );

      await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, fx!.contractId);
      const tenantCfg = page.waitForResponse(
        (r) =>
          r.url().includes('/tenant-config') &&
          r.request().method() === 'GET' &&
          !r.url().includes('/operational'),
      );
      await page.goto('/app/operaciones/lubricantes/nuevo');
      await tenantCfg;
      await waitForPageReady(page);

      await selectOptionWhenReady(page.locator('select#warehouseId'), fx!.mobileWarehouseId);
      await page.locator('#equipSearch').fill(fx!.equipmentInternalId);
      await selectOptionWhenReady(page.locator('select#equipmentId'), fx!.equipmentId);
      await page.locator('#meterReading').fill('5010');

      await page.getByRole('button', { name: 'Agregar ítem' }).click();
      await pickCatalogItem(page, fx!.itemPartNumber);

      const qtyInput = page.locator(`input[id="fluid-qty-${fx!.itemId}"]`);
      await expect(qtyInput).toBeVisible({ timeout: 15_000 });
      await setReactiveInput(qtyInput, String(OVER_DISPATCH));
      await expect(qtyInput).toHaveValue(String(OVER_DISPATCH), { timeout: 10_000 });

      const guardarSalir = page.getByRole('button', { name: 'Guardar y Salir' });

      const apiRes = await createLubeReportApi(adminToken, {
        contractId: fx!.contractId,
        equipmentId: fx!.equipmentId,
        warehouseId: fx!.mobileWarehouseId,
        dispatchDate: new Date(Date.now() + 86_400_000).toISOString(),
        meterReading: 5010,
        lines: [{ itemId: fx!.itemId, quantity: OVER_DISPATCH }],
      });
      expect(apiRes.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(apiRes.body)).toMatch(/stock|insuficiente/i);

      if (await guardarSalir.isEnabled()) {
        const postLube = page.waitForResponse(
          (r) => r.url().includes('/lube-reports') && r.request().method() === 'POST',
        );
        await guardarSalir.click();
        const lubeRes = await postLube;
        expect(lubeRes.status()).toBeGreaterThanOrEqual(400);
      } else {
        await expect(guardarSalir).toBeDisabled();
        await expect(page.getByText(/Stock insuficiente|Revise las cantidades/i)).toBeVisible({
          timeout: 5_000,
        });
      }

      const postStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      const postLedger = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );
      expect(postStock).toBeCloseTo(preStock, 2);
      expect(postLedger - preLedger).toBeCloseTo(0, 2);
    });
  });

  test.describe('2 — blockNegativeStock: OT cierre fluidos', () => {
    let fx: ChaosFixture | null = null;
    let planificadorToken = '';
    let mechanicUserId = '';
    let workOrderId = '';

    test.beforeAll(async () => {
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
      planificadorToken = (await apiLogin(OPERACIONES_USERS.planificador)).token;
      mechanicUserId = (await getUserIdByEmail(OPERACIONES_USERS.mecanico)) ?? '';
    });

    test.afterAll(async () => {
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('cierre con consumo > disponible → 400; kardex delta 0', async ({ request }) => {
      test.skip(!fx || !mechanicUserId, 'Sin fixture o mecánico seed');

      const systemId = await fetchCatalogSystemId(planificadorToken);
      expect(systemId).toBeTruthy();

      const preStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      const preLedgerOut = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );

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
          symptomsText: 'E2E P0 blockNegativeStock OT',
          workPerformedDescription: 'Consumo excesivo bloqueado',
          responsibleMechanicName: 'E2E P0',
          parts: [
            {
              inventoryItemId: fx!.itemId,
              partNumber: fx!.itemPartNumber,
              description: 'Fluido OT P0',
              quantity: OT_RESERVE,
            },
          ],
        },
        fx!.contractId,
      );
      expect(otCreate.status).toBeLessThan(300);
      workOrderId = String((otCreate.body as { id?: string })?.id ?? '');

      await patchWorkOrderPartsApi(
        planificadorToken,
        workOrderId,
        [
          {
            inventoryItemId: fx!.itemId,
            partNumber: fx!.itemPartNumber,
            description: 'Fluido OT P0',
            quantity: OT_OVER_CONSUME,
          },
        ],
        fx!.contractId,
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

      const closeRes = await updateWorkOrderStatusApi(
        planificadorToken,
        workOrderId,
        'CLOSED',
        fx!.mobileWarehouseId,
        true,
        { contractId: fx!.contractId },
      );
      expect(closeRes.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(closeRes.body)).toMatch(/stock|insuficiente|bodega|cantidad/i);

      const postLedgerOut = await sumLedgerOutQuantity(
        request,
        adminToken,
        fx!.itemId,
        fx!.mobileWarehouseId,
      );
      const postStock = await getPhysicalStockQty(
        request,
        adminToken,
        fx!.mobileWarehouseId,
        fx!.itemId,
      );
      expect(postLedgerOut - preLedgerOut).toBeCloseTo(0, 2);
      expect(postStock).toBeCloseTo(preStock, 2);
    });
  });

  test('3 — M3 falla ALTA: isOperational=false + OT NO_PROGRAMADA_REACTIVA', async ({
    request,
  }) => {
    const contractId = await resolveE2EPrimaryContractId();
    expect(contractId).toBeTruthy();

    const runId = `p0-m3-${Date.now().toString(36)}`;
    const equipment = await createEquipmentApi(adminToken, {
      contractId: contractId!,
      internalId: `ACT-P0-M3-${runId.slice(-6).toUpperCase()}`,
      initialMeter: 6000,
      currentMeter: 6000,
    });
    expect(equipment?.id).toBeTruthy();

    try {
      const preEq = await request.get(`${API_BASE}/equipments/${equipment!.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const preBody = (await preEq.json()) as { isOperational?: boolean };
      expect(preBody.isOperational).not.toBe(false);

      const faultRes = await createFaultReportApi(adminToken, {
        equipmentId: equipment!.id,
        eventDate: new Date().toISOString(),
        affectedSystem: 'MOTOR',
        criticality: 'HIGH',
        symptomDescription: 'E2E P0 falla crítica — humo y pérdida de potencia en terreno.',
        meterAtFault: 6010,
      });
      expect(faultRes.status, JSON.stringify(faultRes.body)).toBeLessThan(300);
      const correlative = String((faultRes.body as { correlative?: string })?.correlative ?? '');
      expect(correlative).toMatch(/^RF-/);

      const workOrderId = String((faultRes.body as { workOrderId?: string })?.workOrderId ?? '');
      expect(workOrderId.length).toBeGreaterThan(0);

      const eqRes = await request.get(`${API_BASE}/equipments/${equipment!.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(eqRes.ok()).toBeTruthy();
      const eqBody = (await eqRes.json()) as { isOperational?: boolean };
      expect(eqBody.isOperational).toBe(false);

      const woRes = await request.get(`${API_BASE}/work-orders/${workOrderId}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'x-site-id': contractId!,
        },
      });
      expect(woRes.ok()).toBeTruthy();
      const woBody = (await woRes.json()) as { category?: string; equipmentId?: string };
      expect(woBody.category).toBe('NO_PROGRAMADA_REACTIVA');
      expect(woBody.equipmentId).toBe(equipment!.id);
    } finally {
      await deleteEquipmentApi(adminToken, equipment!.id).catch(() => {});
    }
  });

  test.describe('4 — Smoke correlativos M1/M3', () => {
    let fx: ChaosFixture | null = null;
    let smokeEquipmentId = '';

    test.beforeAll(async () => {
      fx = await bootstrapChaosFixture(INVENTARIO_USERS.admin);
      if (!fx) throw new Error('bootstrapChaosFixture falló');
      const contractId = await resolveE2EPrimaryContractId();
      const runId = Date.now().toString(36);
      const eq = await createEquipmentApi(adminToken, {
        contractId: contractId!,
        internalId: `ACT-P0-SMK-${runId.slice(-6).toUpperCase()}`,
        initialMeter: 7000,
        currentMeter: 7000,
      });
      smokeEquipmentId = eq?.id ?? '';
    });

    test.afterAll(async () => {
      if (smokeEquipmentId) {
        await deleteEquipmentApi(adminToken, smokeEquipmentId).catch(() => {});
      }
      if (fx && adminToken) await teardownChaosFixture(adminToken, fx);
    });

    test('POST /lube-reports → RCL- y POST /fault-reports → RF-', async () => {
      test.skip(!fx || !smokeEquipmentId, 'Sin fixture');

      const lubeRes = await createLubeReportApi(adminToken, {
        contractId: fx!.contractId,
        equipmentId: fx!.equipmentId,
        warehouseId: fx!.mobileWarehouseId,
        dispatchDate: new Date().toISOString(),
        meterReading: 5020,
        lines: [{ itemId: fx!.itemId, quantity: 1 }],
      });
      expect(lubeRes.status, JSON.stringify(lubeRes.body)).toBeLessThan(300);
      expect(String((lubeRes.body as { correlative?: string })?.correlative ?? '')).toMatch(
        /^RCL-/,
      );

      const faultRes = await createFaultReportApi(adminToken, {
        equipmentId: smokeEquipmentId,
        eventDate: new Date().toISOString(),
        affectedSystem: 'MOTOR',
        criticality: 'LOW',
        symptomDescription: 'E2E P0 smoke correlativo — ruido leve en bomba auxiliar.',
      });
      expect(faultRes.status, JSON.stringify(faultRes.body)).toBeLessThan(300);
      expect(String((faultRes.body as { correlative?: string })?.correlative ?? '')).toMatch(
        /^RF-/,
      );
    });
  });
});
