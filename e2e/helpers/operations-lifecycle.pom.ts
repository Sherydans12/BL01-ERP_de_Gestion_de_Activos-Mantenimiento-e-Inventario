import { expect, type Page } from '@playwright/test';
import { pickCatalogItem } from './item-picker';
import {
  addPartLineWithPicker,
  fillOtCreateForm,
  saveOtForm,
} from './ot-form';
import {
  confirmDialog,
  selectOptionWhenReady,
  stockDashboardWarehouseSelect,
  uniqueLabel,
  waitForPageReady,
} from './ui';
import {
  patchWorkOrderApi,
  updateWorkOrderStatusApi,
  type OperationsLifecycleSeed,
} from './api-operations-lifecycle';

export type LifecyclePomContext = OperationsLifecycleSeed;

/** Crea bodega móvil (Camión Lubricador) vía UI de inventario. */
export async function crearBodegaMovil(
  page: Page,
  ctx: LifecyclePomContext,
): Promise<{ warehouseId: string; code: string }> {
  const code = `CAM-E2E-${ctx.runId.slice(-5).toUpperCase()}`;
  const name = `Camión Lubricador E2E ${ctx.runId}`;

  await page.goto('/app/inventario/bodegas/nueva');
  await waitForPageReady(page);

  await page.locator('input[formControlName="code"]').fill(code);
  await page.locator('input[formControlName="name"]').fill(name);
  await page.locator('input[formControlName="location"]').fill('Unidad móvil — prueba E2E');

  const contractSelect = page.locator('select[formControlName="contractId"]');
  await selectOptionWhenReady(contractSelect, ctx.contractId);

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/warehouses') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'GUARDAR BODEGA' }).click();
  const res = await createResp;
  expect(res.status()).toBeLessThan(300);
  const body = (await res.json()) as { id?: string; code?: string };
  const warehouseId = body.id ?? '';
  expect(warehouseId).toBeTruthy();

  ctx.mobileWarehouseId = warehouseId;
  ctx.mobileWarehouseCode = String(body.code ?? code);
  return { warehouseId, code: ctx.mobileWarehouseCode };
}

/** Alta de artículo (aceite/fluido) y primer ingreso a bodega principal vía stock dashboard. */
export async function crearArticuloEIngresarStock(
  page: Page,
  ctx: LifecyclePomContext,
  quantity: number,
): Promise<{ itemId: string }> {
  const itemName = uniqueLabel('Aceite hidráulico E2E');

  await page.goto('/app/articulos/nuevo');
  await waitForPageReady(page);

  await page.locator('input[formControlName="partNumber"]').fill(ctx.itemPartNumber);
  await page.locator('input[formControlName="name"]').fill(itemName);
  await page.locator('select[formControlName="familyId"]').selectOption(ctx.familyId);
  await page.waitForTimeout(500);
  await page.locator('select[formControlName="categoryId"]').selectOption(ctx.categoryId);
  await page.locator('select[formControlName="unitOfMeasureId"]').selectOption(ctx.unitId);

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/inventory-items') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'GUARDAR ARTÍCULO' }).click();
  const createRes = await createResp;
  expect(createRes.status()).toBeLessThan(300);
  const created = (await createRes.json()) as { id?: string };
  const itemId = created.id ?? '';
  expect(itemId).toBeTruthy();
  ctx.itemId = itemId;

  await page.waitForURL(/\/app\/articulos/, { timeout: 30_000 });

  await page.goto('/app/inventario/stock');
  await waitForPageReady(page);

  const whSelect = stockDashboardWarehouseSelect(page);
  await selectOptionWhenReady(whSelect, ctx.mainWarehouseId);
  await page.getByRole('button', { name: 'Nuevo movimiento' }).click();

  const dialog = page.locator('dialog').filter({ hasText: 'Operación de almacén' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('label').filter({ hasText: /^Entrada por compra$/ }).first().click();
  await dialog
    .getByRole('button', { name: /Buscar artículo en el Catálogo Maestro/i })
    .click();
  await pickCatalogItem(page, ctx.itemSearchHint);

  await dialog.locator('input[formControlName="quantity"]').fill(String(quantity));
  await dialog.locator('input[formControlName="unitCost"]').fill('2500');

  const txResp = page.waitForResponse(
    (r) =>
      r.url().includes('/inventory-stock/transaction') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  const txRes = await txResp;
  expect(txRes.status()).toBeLessThan(300);

  return { itemId };
}

/** W2W: origen → destino (envío + recepción en una sesión con permisos completos). */
export async function ejecutarTransferencia(
  page: Page,
  ctx: LifecyclePomContext,
  origenId: string,
  destinoId: string,
  cantidad: number,
): Promise<string> {
  await page.goto('/app/inventario/transferencias');
  await waitForPageReady(page);

  await selectOptionWhenReady(
    page.locator('select[formControlName="originWarehouseId"]'),
    origenId,
  );
  await selectOptionWhenReady(
    page.locator('select[formControlName="destinationWarehouseId"]'),
    destinoId,
  );

  await page.getByRole('button', { name: '+ Agregar ítem' }).click();
  await pickCatalogItem(page, ctx.itemSearchHint);

  await page.locator('tbody input').first().fill(String(cantidad));

  const postXfer = page.waitForResponse(
    (r) => r.url().includes('/inventory-transfers') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'ENVIAR' }).click();
  await confirmDialog(page, 'Sí, enviar');

  const xferRes = await postXfer;
  expect(xferRes.status()).toBeLessThan(300);
  const xferBody = (await xferRes.json()) as { id?: string };
  const transferId = xferBody.id ?? '';
  expect(transferId).toBeTruthy();

  const receiveResp = page.waitForResponse(
    (r) =>
      r.url().includes(`/inventory-transfers/${transferId}/receive`) &&
      r.request().method() === 'POST',
  );
  const row = page
    .locator('tbody tr')
    .filter({ hasText: `${ctx.mainWarehouseCode} —` })
    .filter({ hasText: `${ctx.mobileWarehouseCode} —` })
    .first();
  await expect(row).toBeVisible({ timeout: 25_000 });
  await row.getByRole('button', { name: 'Confirmar recepción' }).click();
  await confirmDialog(page, 'Sí, confirmar recepción');
  const receiveRes = await receiveResp;
  expect(receiveRes.status()).toBeLessThan(300);

  return transferId;
}

/** M1 — despacho de lubricante desde bodega móvil hacia equipo. */
export async function despacharLubricante(
  page: Page,
  ctx: LifecyclePomContext,
  equipoInternalId: string,
  cantidad: number,
  medidor: number,
): Promise<string> {
  await page.goto('/app/operaciones/lubricantes/nuevo');
  await waitForPageReady(page);

  await selectOptionWhenReady(page.locator('select#warehouseId'), ctx.mobileWarehouseId);

  await page.locator('#equipSearch').fill(equipoInternalId);
  await selectOptionWhenReady(page.locator('select#equipmentId'), ctx.equipmentId);

  await page.locator('#meterReading').fill(String(medidor));

  await page.getByRole('button', { name: 'Agregar ítem' }).click();
  await pickCatalogItem(page, ctx.itemSearchHint);

  const qtyInput = page.locator(`input[id="fluid-qty-${ctx.itemId}"]`);
  await expect(qtyInput).toBeVisible({ timeout: 15_000 });
  await qtyInput.fill(String(cantidad));

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
  const lubeBody = (await lubeRes.json()) as { id?: string; correlative?: string };
  expect(lubeBody.id).toBeTruthy();

  await page.waitForURL(/\/app\/operaciones\/lubricantes/, { timeout: 30_000 });
  return String(lubeBody.correlative ?? lubeBody.id);
}

/** Crea OT con repuesto reservado; devuelve workOrderId. */
export async function crearOtConRepuesto(
  page: Page,
  ctx: LifecyclePomContext,
  reserveQty: number,
): Promise<string> {
  await fillOtCreateForm(page, {
    equipmentId: ctx.equipmentId,
    warehouseId: ctx.mobileWarehouseId,
    initialMeter: ctx.meterAfterM1,
    finalMeter: ctx.meterAfterOt,
  });
  await addPartLineWithPicker(page, ctx.itemSearchHint, reserveQty);
  const createRes = await saveOtForm(page, true);
  const body = (await createRes.json()) as { id?: string };
  const workOrderId = body.id ?? page.url().split('/').pop() ?? '';
  expect(workOrderId).toBeTruthy();
  return workOrderId;
}

/** Cierra OT con medidor final; opcionalmente vía UI si el botón está visible. */
export async function cerrarOT(
  page: Page,
  ctx: LifecyclePomContext,
  workOrderId: string,
  medidorFinal: number,
  consumeQty: number,
  mechanicUserId: string,
  planificadorToken: string,
): Promise<void> {
  await patchWorkOrderApi(planificadorToken, workOrderId, {
    shiftSupervisorUserId: mechanicUserId,
    detentionFinalMeter: medidorFinal,
    finalMeter: medidorFinal,
  });

  await page.goto(`/app/ots/${workOrderId}`);
  await waitForPageReady(page);
  await page.getByRole('tab', { name: /Repuestos y stock/i }).click();
  await page.locator('input[formControlName="quantity"]').first().fill(String(consumeQty));
  await saveOtForm(page, false);

  const closeRes = await updateWorkOrderStatusApi(
    planificadorToken,
    workOrderId,
    'CLOSED',
    ctx.mobileWarehouseId,
    true,
  );
  expect(closeRes.status).toBeLessThan(300);
}

/** Abre modal de equipo y tab Historial de Medidores; devuelve filas visibles. */
/** Registro masivo de horómetros — filtra por prefijo y carga lecturas. */
export async function registrarHorasBulk(
  page: Page,
  searchPrefix: string,
  readings: { equipmentId: string; value: number }[],
): Promise<void> {
  await page.goto('/app/flota/registro-horas');
  await waitForPageReady(page);

  const search = page.locator('input[type="search"]');
  await search.fill(searchPrefix);
  await page.waitForTimeout(800);

  for (const row of readings) {
    const input = page.locator(`#meter-reading-${row.equipmentId}`);
    await expect(input).toBeVisible({ timeout: 25_000 });
    await input.clear();
    await input.pressSequentially(String(row.value), { delay: 15 });
    await input.blur();
  }
}

export async function clickSyncRegistroHoras(page: Page): Promise<void> {
  const syncBtn = page.getByRole('button', { name: 'Sincronizar lecturas' });
  await expect(syncBtn).toBeEnabled({ timeout: 25_000 });
  await syncBtn.click();
}

export async function confirmLargeJumpModal(page: Page): Promise<void> {
  await expect(page.locator('dialog.confirm-dialog')).toBeVisible({ timeout: 15_000 });
  await confirmDialog(page, 'Confirmar y sincronizar');
}

export async function abrirHistorialMedidoresEquipo(
  page: Page,
  equipmentInternalId: string,
): Promise<{ sourceLabels: string[]; readings: string[]; deltas: string[] }> {
  await page.goto('/app/flota');
  await waitForPageReady(page);

  const row = page.locator('tbody tr').filter({ hasText: equipmentInternalId }).first();
  await expect(row).toBeVisible({ timeout: 25_000 });
  await row.getByRole('button', { name: 'HOJA DE VIDA' }).click();

  const dialog = page.locator('dialog.equipment-detail-dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Historial de Medidores' }).click();

  const table = dialog.locator('app-equipment-meter-history-table table tbody tr');
  await expect(table.first()).toBeVisible({ timeout: 20_000 });

  const sourceLabels = await table.locator('td:nth-child(4)').allTextContents();
  const readings = await table.locator('td:nth-child(2)').allTextContents();
  const deltas = await table.locator('td:nth-child(3)').allTextContents();

  return { sourceLabels, readings, deltas };
}
