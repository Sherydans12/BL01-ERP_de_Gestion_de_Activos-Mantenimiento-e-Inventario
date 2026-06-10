import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import {
  bootstrapOperationsLifecycleSeed,
  createInventoryItemApi,
  deleteEquipmentApi,
  deleteInventoryItemApi,
  deleteWarehouseApi,
  getStockRowApi,
  resolveE2EPrimaryContractId,
  type OperationsLifecycleSeed,
} from '../helpers/api-operations-lifecycle';
import { performStockIn } from '../helpers/api-inventario';
import { createLubeReportApi } from '../helpers/api-chaos';
import {
  crearBodegaMovil,
  ejecutarTransferencia,
} from '../helpers/operations-lifecycle.pom';
import { pickCatalogItem } from '../helpers/item-picker';
import { setReactiveInput, waitForPageReady, selectOptionWhenReady } from '../helpers/ui';

const PARTIAL_TRANSFER_QTY = 30;
const M1_DISPATCH_QTY = 8.5;

test.describe.serial('P2 — Inventario × operaciones', () => {
  let ctx: OperationsLifecycleSeed | null = null;
  let adminToken = '';
  let contractId = '';

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    adminToken = (await apiLogin(INVENTARIO_USERS.admin)).token;
    contractId = (await resolveE2EPrimaryContractId()) ?? '';
    ctx = await bootstrapOperationsLifecycleSeed(INVENTARIO_USERS.admin);
    if (!ctx) {
      throw new Error(
        'Setup P2 falló: requiere tenant TPM, contrato, bodega principal y seed operaciones',
      );
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

  test('1 — W2W parcial → M1 misma bodega móvil (stock coherente en picker)', async ({
    page,
    request,
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx, 'Sin contexto seed');

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.gestor, ctx!.contractId);
    const { warehouseId } = await crearBodegaMovil(page, ctx!);
    ctx!.mobileWarehouseId = warehouseId;

    const item = await createInventoryItemApi(adminToken, {
      partNumber: ctx!.itemPartNumber,
      name: `Aceite hidráulico E2E ${ctx!.runId}`,
      categoryId: ctx!.categoryId,
      unitOfMeasureId: ctx!.unitId,
    });
    if (!item?.id) throw new Error('createInventoryItemApi falló');
    ctx!.itemId = item.id;

    const stockIn = await performStockIn(
      adminToken,
      ctx!.mainWarehouseId,
      ctx!.itemId,
      ctx!.stockInQty,
      2500,
    );
    expect(stockIn.status).toBeLessThan(300);

    const mainBefore = Number(
      (await getStockRowApi(request, adminToken, ctx!.mainWarehouseId, ctx!.itemId))?.quantity ??
        0,
    );
    expect(mainBefore).toBeCloseTo(ctx!.stockInQty, 2);

    await ejecutarTransferencia(
      page,
      ctx!,
      ctx!.mainWarehouseId,
      ctx!.mobileWarehouseId,
      PARTIAL_TRANSFER_QTY,
    );

    const mainAfterXfer = await getStockRowApi(
      request,
      adminToken,
      ctx!.mainWarehouseId,
      ctx!.itemId,
    );
    const mobileAfterXfer = await getStockRowApi(
      request,
      adminToken,
      ctx!.mobileWarehouseId,
      ctx!.itemId,
    );
    expect(Number(mainAfterXfer?.quantity ?? 0)).toBeCloseTo(
      ctx!.stockInQty - PARTIAL_TRANSFER_QTY,
      2,
    );
    expect(Number(mobileAfterXfer?.quantity ?? 0)).toBeCloseTo(PARTIAL_TRANSFER_QTY, 2);

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, ctx!.contractId);
    await page.goto('/app/operaciones/lubricantes/nuevo');
    await waitForPageReady(page);

    await page.locator('select#warehouseId').selectOption(ctx!.mobileWarehouseId);
    await page.locator('#equipSearch').fill(ctx!.equipmentInternalId);
    await selectOptionWhenReady(page.locator('select#equipmentId'), ctx!.equipmentId);
    await page.locator('#meterReading').fill(String(ctx!.meterAfterBootstrap));

    await page.getByRole('button', { name: 'Agregar ítem' }).click();
    await pickCatalogItem(page, ctx!.itemSearchHint);

    await expect(page.getByText(/Disponible:\s*30/)).toBeVisible({ timeout: 15_000 });

    const qtyInput = page.locator(`input[id="fluid-qty-${ctx!.itemId}"]`);
    await setReactiveInput(qtyInput, String(M1_DISPATCH_QTY));

    const largeConfirm = page.getByLabel('Confirmar cantidad inusual');
    if (await largeConfirm.isVisible().catch(() => false)) {
      await largeConfirm.check();
    }

    const postLube = page.waitForResponse(
      (r) => r.url().includes('/lube-reports') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Guardar y Salir' }).click();
    const lubeRes = await postLube;
    expect(lubeRes.status()).toBeLessThan(300);
    const lubeBody = (await lubeRes.json()) as { correlative?: string };
    expect(String(lubeBody.correlative ?? '')).toMatch(/^RCL-/);

    const mobileAfterM1 = await getStockRowApi(
      request,
      adminToken,
      ctx!.mobileWarehouseId,
      ctx!.itemId,
    );
    expect(Number(mobileAfterM1?.quantity ?? 0)).toBeCloseTo(
      PARTIAL_TRANSFER_QTY - M1_DISPATCH_QTY,
      2,
    );
  });

  test('2 — PBAC M1 lectura: POST /lube-reports bloqueado (403)', async ({
    backendAvailable,
  }) => {
    void backendAvailable;
    test.skip(!ctx?.itemId || !ctx.mobileWarehouseId, 'Requiere fixture del test 1');

    const { token: lecturaToken } = await apiLogin(INVENTARIO_USERS.lectura);
    const today = new Date().toISOString().slice(0, 10);

    const res = await createLubeReportApi(lecturaToken, {
      contractId: contractId || ctx!.contractId,
      equipmentId: ctx!.equipmentId,
      warehouseId: ctx!.mobileWarehouseId,
      dispatchDate: today,
      meterReading: ctx!.meterAfterBootstrap,
      lines: [{ itemId: ctx!.itemId, quantity: 1 }],
    });

    expect(res.status).toBe(403);
    const msg = JSON.stringify(res.body ?? {});
    expect(msg).toMatch(/permiso|forbidden|lube/i);
  });
});
