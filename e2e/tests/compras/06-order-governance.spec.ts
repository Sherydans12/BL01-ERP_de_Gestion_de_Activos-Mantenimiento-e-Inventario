import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession } from '../../helpers/auth';
import { buildPendingPurchaseOrderViaApi, rejectPurchaseOrderViaApi } from '../../helpers/api-compras';
import { confirmDialog, waitForPageReady } from '../../helpers/ui';

test.describe('Compras — gobernanza OC (UI)', () => {
  test('reject API + admin reinicia borrador en UI', async ({ page, backendAvailable: _ }) => {
    const built = await buildPendingPurchaseOrderViaApi();
    test.skip(!built, 'No se pudo crear OC pendiente vía API');

    const rejected = await rejectPurchaseOrderViaApi(built!.poId);
    expect(rejected).toBeTruthy();

    await seedBrowserSession(page, PBAC_USERS.adminCompras);
    await page.goto(`/app/compras/ordenes/${built!.poId}`);
    await expect(page.getByRole('button', { name: /Reiniciar a Borrador/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Reiniciar a Borrador/i }).click();
    await confirmDialog(page, 'Sí, reiniciar');
    await expect(page.getByText(/Borrador|DRAFT/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('comprador: logistics en OC editable', async ({ page, backendAvailable: _ }) => {
    const built = await buildPendingPurchaseOrderViaApi();
    test.skip(!built, 'No se pudo crear OC pendiente vía API');

    await seedBrowserSession(page, PBAC_USERS.comprador);
    await page.goto(`/app/compras/ordenes/${built!.poId}`);
    await page.locator('label:has-text("Dirección de entrega")').locator('..').locator('input, textarea').fill('Bodega E2E Playwright');
    await page.getByRole('button', { name: /Guardar entrega y pago/i }).click();
    await waitForPageReady(page);
  });
});
