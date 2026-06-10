import { test, expect } from '../../fixtures/inventario.fixture';
import {
  INVENTARIO_USERS,
  seedBrowserSessionWithContract,
  apiLogin,
} from '../../helpers/auth';
import {
  ensureStockForW2W,
  findW2WPair,
  getItemLedger,
  getWarehouseStock,
  getWarehouseTransactions,
  getTransfer,
} from '../../helpers/api-inventario';
import { pickCatalogItem } from '../../helpers/item-picker';
import { confirmDialog, selectOptionWhenReady, waitForPageReady } from '../../helpers/ui';

test.describe.serial('Inventario — ciclo W2W origen → destino', () => {
  let contractId = '';
  let originWarehouseId = '';
  let destWarehouseId = '';
  let originCode = '';
  let destCode = '';
  let itemId = '';
  let partSearch = '';
  let qtyBefore = 0;
  let transferQty = 1;
  let transferId = '';

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    const { token } = await apiLogin(INVENTARIO_USERS.w2wOrigen);
    const pair = await findW2WPair(token);
    if (!pair) {
      throw new Error('Se requieren al menos 2 bodegas en el mismo contrato para W2W E2E');
    }
    contractId = pair.contractId;
    originWarehouseId = pair.origin.id;
    destWarehouseId = pair.destination.id;
    originCode = pair.origin.code;
    destCode = pair.destination.code;

    const stocked = await ensureStockForW2W(INVENTARIO_USERS.gestor, originWarehouseId);
    itemId = stocked.itemId;
    partSearch = stocked.searchHint;
    qtyBefore = stocked.qtyBefore;
  });

  test('fase origen: despacho SHIPPED y TRANSFER_OUT', async ({ page, backendAvailable }) => {
    void backendAvailable;

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.w2wOrigen, contractId);
    await page.goto('/app/inventario/transferencias');
    await waitForPageReady(page);
    await page.waitForResponse(
      (r) => r.url().includes('/warehouses') && r.request().method() === 'GET' && r.ok(),
      { timeout: 30_000 },
    ).catch(() => {});

    const originSelect = page.locator('select[formControlName="originWarehouseId"]');
    const destSelect = page.locator('select[formControlName="destinationWarehouseId"]');
    await selectOptionWhenReady(originSelect, originWarehouseId);
    await selectOptionWhenReady(destSelect, destWarehouseId);

    await page.getByRole('button', { name: '+ Agregar ítem' }).click();
    await pickCatalogItem(page, partSearch);

    const qtyInput = page.locator('tbody input').first();
    await qtyInput.fill(String(transferQty));

    const postXfer = page.waitForResponse(
      (r) => r.url().includes('/inventory-transfers') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'ENVIAR' }).click();
    await confirmDialog(page, 'Sí, enviar');

    const xferRes = await postXfer;
    expect(xferRes.status()).toBeLessThan(300);
    const xferBody = (await xferRes.json()) as { id?: string; status?: string };
    transferId = xferBody.id ?? '';
    expect(transferId).toBeTruthy();
    expect(String(xferBody.status ?? '').toUpperCase()).toMatch(/SHIPPED|EN_TRANSIT/);

    const { token } = await apiLogin(INVENTARIO_USERS.gestor);
    const stockAfter = await getWarehouseStock(token, originWarehouseId);
    const row = stockAfter.find((s) => s.itemId === itemId);
    expect(Number(row?.quantity ?? 0)).toBeCloseTo(qtyBefore - transferQty, 3);

    const ledger = await getItemLedger(token, itemId, originWarehouseId);
    expect(
      ledger.some(
        (l) =>
          l.type === 'TRANSFER_OUT' &&
          String(l.referenceType ?? '').includes('INVENTORY_TRANSFER'),
      ),
    ).toBe(true);
  });

  test('fase destino: recepción COMPLETED y TRANSFER_IN', async ({ page, backendAvailable }) => {
    void backendAvailable;
    test.skip(!transferId, 'Sin transferId de fase origen');

    const { token: gestorToken } = await apiLogin(INVENTARIO_USERS.gestor);
    const destBeforeRows = await getWarehouseStock(gestorToken, destWarehouseId);
    const destBefore = destBeforeRows.find((s) => s.itemId === itemId);
    const qtyDestBefore = Number(destBefore?.quantity ?? 0);

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.w2wDestino, contractId);
    await page.goto('/app/inventario/transferencias');
    await waitForPageReady(page);

    const row = page
      .locator('tbody tr')
      .filter({ hasText: `${originCode} —` })
      .filter({ hasText: `${destCode} —` })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const receiveResp = page.waitForResponse(
      (r) =>
        r.url().includes(`/inventory-transfers/${transferId}/receive`) &&
        r.request().method() === 'POST',
    );
    await row.getByRole('button', { name: 'Confirmar recepción' }).click();
    await confirmDialog(page, 'Sí, confirmar recepción');
    const receiveRes = await receiveResp;
    expect(receiveRes.status()).toBeLessThan(300);

    const xfer = await getTransfer(gestorToken, transferId);
    expect(String((xfer.body as { status?: string })?.status ?? '').toUpperCase()).toBe(
      'COMPLETED',
    );

    const destAfterRows = await getWarehouseStock(gestorToken, destWarehouseId);
    const destAfter = destAfterRows.find((s) => s.itemId === itemId);
    expect(Number(destAfter?.quantity ?? 0)).toBeCloseTo(qtyDestBefore + transferQty, 3);

    const whTx = await getWarehouseTransactions(gestorToken, destWarehouseId, itemId);
    expect(
      whTx.some(
        (t) =>
          t.type === 'TRANSFER_IN' &&
          String(t.referenceType ?? '').includes('INVENTORY_TRANSFER'),
      ),
    ).toBe(true);
  });
});
