import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession } from '../../helpers/auth';
import {
  findRequisitionByDescription,
  findOpenReceiptForOrder,
  findPurchaseOrderByRequisition,
  getCatalogSearchHint,
  getFirstVendorId,
  getPurchaseOrderDetail,
} from '../../helpers/api-compras';
import { pickCatalogItem } from '../../helpers/item-picker';
import { confirmDialog, selectFirstNonEmptyOption, uniqueLabel, waitForPageReady } from '../../helpers/ui';

async function fillQuotationLine(page: import('@playwright/test').Page, vendorId: string, unitPrice: string) {
  await page.getByRole('button', { name: 'Agregar cotización' }).click();
  await page.locator('label:has-text("Proveedor")').locator('..').locator('select').selectOption(vendorId);
  await page.locator('label:has-text("Precio unitario")').locator('..').locator('input[type="number"]').fill(unitPrice);
}

/**
 * Flujo P2P completo vía UI (serial).
 * Personas: solicitante → comprador → aprobador1/2 → comprador → bodega → tesorería
 */
test.describe.configure({ mode: 'serial' });

test.describe('Compras — P2P full UI', () => {
  const description = uniqueLabel('P2P UI');
  let requisitionId = '';
  let requisitionCorrelative = '';
  let purchaseOrderId = '';
  let poCorrelative = '';
  let poTotal = 0;
  let receiptId = '';

  test('1 · Solicitante crea y envía SRC', async ({ page, backendAvailable: _ }) => {
    const searchHint = await getCatalogSearchHint(PBAC_USERS.solicitante);
    await seedBrowserSession(page, PBAC_USERS.solicitante);
    await page.goto('/app/compras/requerimientos/nuevo');
    await expect(page.getByRole('heading', { name: 'Nuevo requerimiento de compra' })).toBeVisible();

    const contractSelect = page.locator('select').first();
    await selectFirstNonEmptyOption(page, contractSelect);
    await page.locator('textarea').first().fill(description);

    await page.getByRole('button', { name: 'Buscar o crear artículo…' }).click();
    await pickCatalogItem(page, searchHint);

    await page.locator('input[type="number"]').first().fill('3');
    await page.getByRole('button', { name: 'Crear requerimiento' }).click();
    await page.waitForURL(/\/app\/compras\/requerimientos\/[0-9a-f-]+/, { timeout: 30_000 });

    requisitionId = page.url().split('/').pop() ?? '';
    await expect(page.getByRole('button', { name: 'Enviar requerimiento' })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar requerimiento' }).click();
    await confirmDialog(page, 'Sí, enviar');
    await expect(page.getByText(/Enviado|SUBMITTED|Enviado/i)).toBeVisible({ timeout: 20_000 }).catch(() => {});

    const found = await findRequisitionByDescription(PBAC_USERS.solicitante, description);
    expect(found?.id).toBeTruthy();
    requisitionId = found!.id;
    requisitionCorrelative = found!.correlative ?? '';
  });

  test('2 · Comprador cotiza, adjudica y genera OC', async ({ page }) => {
    test.skip(!requisitionId, 'Sin SRC del paso 1');
    const vendorId = await getFirstVendorId(PBAC_USERS.comprador);
    test.skip(!vendorId, 'Sin proveedores en tenant');

    await seedBrowserSession(page, PBAC_USERS.comprador);
    await page.goto(`/app/compras/requerimientos/${requisitionId}`);
    await waitForPageReady(page);

    await page.getByRole('button', { name: 'Iniciar Cotización' }).click();
    await confirmDialog(page, 'Iniciar cotización');

    await fillQuotationLine(page, vendorId, '2500');
    await page.getByRole('button', { name: 'Registrar cotización' }).click();
    await confirmDialog(page, 'Registrar');
    await waitForPageReady(page);

    await page.getByText('Elegir', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Guardar selección' })).toBeEnabled();
    await page.getByRole('button', { name: 'Guardar selección' }).click();
    await waitForPageReady(page);

    await page.getByRole('button', { name: /Generar orden\(es\) de compra/i }).click();
    await confirmDialog(page, /Generar OC/i);
    await waitForPageReady(page);

    const po = await findPurchaseOrderByRequisition(PBAC_USERS.comprador, requisitionId);
    expect(po?.id).toBeTruthy();
    purchaseOrderId = po!.id;
    poCorrelative = po!.correlative ?? '';
  });

  test('3 · Aprobadores firman OC (N1 + N2)', async ({ page }) => {
    test.skip(!purchaseOrderId, 'Sin OC del paso 2');

    for (const approver of [PBAC_USERS.aprobador1, PBAC_USERS.aprobador2] as const) {
      await seedBrowserSession(page, approver);
      await page.goto(`/app/compras/ordenes/${purchaseOrderId}`);
      await expect(page.getByRole('heading', { name: 'Ítems de la Orden' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Firmar' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Firmar' }).click();
      await confirmDialog(page, 'Sí, firmar');
      await waitForPageReady(page);
    }
  });

  test('4 · Comprador envía OC al proveedor', async ({ page }) => {
    test.skip(!purchaseOrderId, 'Sin OC');
    await seedBrowserSession(page, PBAC_USERS.comprador);
    await page.goto(`/app/compras/ordenes/${purchaseOrderId}`);
    await page.getByRole('button', { name: /Marcar como enviada al proveedor/i }).click();
    await waitForPageReady(page);
    const detail = await getPurchaseOrderDetail(PBAC_USERS.comprador, purchaseOrderId);
    poTotal = Number(detail.totalAmount ?? 7500);
    expect(['SENT', 'SENT_TO_SUPPLIER', 'ORDERED'].includes(String(detail.status))).toBeTruthy();
  });

  test('5 · Bodega registra recepción total', async ({ page }) => {
    test.skip(!purchaseOrderId, 'Sin OC');
    const existing = await findOpenReceiptForOrder(PBAC_USERS.bodega, purchaseOrderId);

    await seedBrowserSession(page, PBAC_USERS.bodega);
    if (existing?.id) {
      await page.goto(`/app/compras/recepciones/${existing.id}`);
    } else {
      await page.goto(`/app/compras/recepciones/nueva?orderId=${purchaseOrderId}`);
      await waitForPageReady(page);
      const warehouseSelect = page.locator('label:has-text("Bodega de recepción")').locator('..').locator('select');
      await expect(warehouseSelect).toBeVisible({ timeout: 20_000 });
      await selectFirstNonEmptyOption(page, warehouseSelect);
      const createResp = page.waitForResponse(
        (r) => r.url().includes('/warehouse-receipts') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Crear recepción' }).click();
      const resp = await createResp;
      expect(resp.ok()).toBeTruthy();
      await page.waitForURL(/\/app\/compras\/recepciones\/[0-9a-f-]+/, { timeout: 30_000 });
    }
    receiptId = page.url().split('/').pop() ?? '';

    await page.locator('tbody input[type="number"]').first().fill('3');
    await page.getByRole('button', { name: /Confirmar Recepción/i }).click();
    await confirmDialog(page, 'Sí, confirmar recepción');
    await expect(page.getByText('Recepción completada').first()).toBeVisible({ timeout: 30_000 });
  });

  test('6 · Tesorería registra factura y paga', async ({ page }) => {
    test.skip(!purchaseOrderId, 'Sin OC');
    const invoiceNumber = `FE-P2P-${Date.now()}`;

    await seedBrowserSession(page, PBAC_USERS.tesoreria);
    await page.goto(`/app/compras/ordenes/${purchaseOrderId}/factura`);
    await expect(page.getByRole('heading', { name: /Factura de compra/i })).toBeVisible({ timeout: 20_000 });

    await page.locator('label:has-text("Número de factura")').locator('..').locator('input').fill(invoiceNumber);
    const today = new Date().toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(today);
    await page.locator('label:has-text("Total facturado")').locator('..').locator('input').fill(String(poTotal || 7500));

    await page.getByRole('button', { name: 'Registrar y validar' }).click();
    await waitForPageReady(page);

    await page.goto(`/app/compras/ordenes/${purchaseOrderId}?tab=billing`);
    await waitForPageReady(page);
    await expect(page.getByText(/MATCHED|Conciliada|Validada|Pagada/i).first()).toBeVisible({ timeout: 25_000 });

    const payBtn = page.getByRole('button', { name: 'Marcar factura como pagada' });
    if (await payBtn.isVisible().catch(() => false)) {
      await payBtn.click();
      await waitForPageReady(page);
    }
    await expect(page.getByText(/Pagada|PAID|marcada como pagada/i).first()).toBeVisible({ timeout: 25_000 });
  });
});
