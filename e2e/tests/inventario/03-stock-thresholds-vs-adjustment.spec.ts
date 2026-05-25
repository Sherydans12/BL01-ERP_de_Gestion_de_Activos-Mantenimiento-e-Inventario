import { test, expect } from '../../fixtures/inventario.fixture';
import { INVENTARIO_USERS, seedBrowserSession, apiLogin } from '../../helpers/auth';
import {
  findStockedItemInWarehouse,
  getItemLedger,
  getWarehouseStock,
} from '../../helpers/api-inventario';
import {
  confirmDialog,
  selectFirstNonEmptyOption,
  stockDashboardWarehouseSelect,
  waitForPageReady,
} from '../../helpers/ui';

test.describe('Inventario — umbrales vs corrección física', () => {
  test('modal Umbrales no altera stock; Corregir físico genera ADJUST en kardex', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;

    const { token } = await apiLogin(INVENTARIO_USERS.gestor);
    const newLocation = `E2E-A-${Date.now().toString(36).slice(-4)}`;

    await seedBrowserSession(page, INVENTARIO_USERS.gestor);
    await page.goto('/app/inventario/stock');
    await waitForPageReady(page);

    const whSelect = stockDashboardWarehouseSelect(page);
    await expect(whSelect).toBeEnabled({ timeout: 25_000 });
    await selectFirstNonEmptyOption(page, whSelect);
    const warehouseId = await whSelect.inputValue();
    test.skip(!warehouseId, 'Sin bodega seleccionable en UI');

    await waitForPageReady(page);

    const stocked = await findStockedItemInWarehouse(token, warehouseId, 1);
    test.skip(!stocked, 'Sin filas con stock en la bodega UI');

    const itemId = stocked.itemId;
    const qtyBefore = stocked.quantity;

    const dataRow = page
      .locator('tbody tr')
      .filter({ has: page.locator('button', { hasText: 'Umbrales' }) })
      .first();
    await expect(dataRow).toBeVisible({ timeout: 25_000 });

    await dataRow.getByRole('button', { name: 'Umbrales' }).click();
    const policyDialog = page.locator('dialog').filter({ hasText: 'Umbrales y ubicación' });
    await expect(policyDialog).toBeVisible();
    await expect(policyDialog.getByLabel(/Nuevo stock físico/i)).toHaveCount(0);
    await policyDialog.locator('input[formControlName="location"]').fill(newLocation);
    await policyDialog.getByRole('button', { name: 'Guardar umbrales' }).click();
    await expect(policyDialog).toBeHidden({ timeout: 20_000 });

    const stockAfterPolicy = await getWarehouseStock(token, warehouseId);
    const afterPolicyRow = stockAfterPolicy.find((r) => r.itemId === itemId);
    expect(Number(afterPolicyRow?.quantity ?? qtyBefore)).toBeCloseTo(qtyBefore, 3);

    await dataRow.getByRole('button', { name: 'Corregir físico' }).click();
    const adjustDialog = page.locator('dialog').filter({ hasText: 'Corrección física' });
    await expect(adjustDialog).toBeVisible();
    await expect(adjustDialog.getByText(/solo lectura/i).first()).toBeVisible();

    const mermaQty = Math.max(0, qtyBefore - 1);
    await adjustDialog.locator('input[formControlName="newPhysical"]').fill(String(mermaQty));
    await adjustDialog.locator('select[formControlName="reason"]').selectOption('MERMAS');
    await adjustDialog
      .locator('textarea[formControlName="comment"]')
      .fill('E2E merma control stock — probe Playwright');

    await adjustDialog.getByRole('button', { name: 'Confirmar corrección' }).click();
    await confirmDialog(page, 'Sí, aplicar ajuste');

    await page.waitForTimeout(1500);
    const ledger = await getItemLedger(token, itemId, warehouseId);
    expect(ledger.some((l) => l.type === 'ADJUST')).toBe(true);

    const stockFinal = await getWarehouseStock(token, warehouseId);
    const finalRow = stockFinal.find((r) => r.itemId === itemId);
    expect(Number(finalRow?.quantity ?? -1)).toBeCloseTo(mermaQty, 3);
  });
});
