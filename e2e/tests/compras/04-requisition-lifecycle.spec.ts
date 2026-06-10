import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession } from '../../helpers/auth';
import { getCatalogSearchHint } from '../../helpers/api-compras';
import { pickCatalogItem } from '../../helpers/item-picker';
import { confirmDialog, selectFirstNonEmptyOption, uniqueLabel, waitForPageReady } from '../../helpers/ui';

test.describe('Compras — ciclo de vida SRC (UI)', () => {
  test('duplicar SRC desde detalle', async ({ page, backendAvailable: _ }) => {
    const searchHint = await getCatalogSearchHint(PBAC_USERS.solicitante);
    const label = uniqueLabel('Dup SRC');

    await seedBrowserSession(page, PBAC_USERS.solicitante);
    await page.goto('/app/compras/requerimientos/nuevo');
    await selectFirstNonEmptyOption(page, page.locator('select').first());
    await page.locator('textarea').first().fill(label);
    await page.getByRole('button', { name: 'Buscar o crear artículo…' }).click();
    await pickCatalogItem(page, searchHint);
    await page.locator('input[type="number"]').first().fill('1');
    await page.getByRole('button', { name: 'Crear requerimiento' }).click();
    await page.waitForURL(/\/app\/compras\/requerimientos\/[0-9a-f-]+/);

    const originalId = page.url().split('/').pop()!;
    const dupResp = page.waitForResponse(
      (r) => r.url().includes('/duplicate') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Duplicar' }).click();
    const resp = await dupResp;
    expect(resp.ok()).toBeTruthy();
    const body = (await resp.json()) as { id?: string; description?: string };
    expect(body.description ?? '').toContain('[Copia]');
    await page.waitForURL(new RegExp(`${body.id}$`), { timeout: 30_000 });
  });

  test('comprador anula SRC enviada', async ({ page, backendAvailable: _ }) => {
    const searchHint = await getCatalogSearchHint(PBAC_USERS.solicitante);
    const label = uniqueLabel('Cancel SRC');

    await seedBrowserSession(page, PBAC_USERS.solicitante);
    await page.goto('/app/compras/requerimientos/nuevo');
    await selectFirstNonEmptyOption(page, page.locator('select').first());
    await page.locator('textarea').first().fill(label);
    await page.getByRole('button', { name: 'Buscar o crear artículo…' }).click();
    await pickCatalogItem(page, searchHint);
    await page.locator('input[type="number"]').first().fill('2');
    await page.getByRole('button', { name: 'Crear requerimiento' }).click();
    await page.waitForURL(/\/app\/compras\/requerimientos\/[0-9a-f-]+/);
    const reqId = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Enviar requerimiento' }).click();
    await confirmDialog(page, 'Sí, enviar');

    await seedBrowserSession(page, PBAC_USERS.comprador);
    await page.goto(`/app/compras/requerimientos/${reqId}`);
    await page.getByRole('button', { name: 'Anular requerimiento' }).click();
    await page.locator('dialog.confirm-dialog textarea').fill('Anulación E2E Playwright con motivo válido');
    const ack = page.locator('dialog.confirm-dialog input[type="checkbox"]');
    if (await ack.isVisible().catch(() => false)) {
      await ack.check();
    }
    await confirmDialog(page, 'Sí, anular');
    await expect(page.getByText(/Anulado|CANCELLED|Cancelado/i)).toBeVisible({ timeout: 20_000 });
  });
});
