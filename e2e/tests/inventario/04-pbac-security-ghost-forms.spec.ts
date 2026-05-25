import { test, expect } from '../../fixtures/inventario.fixture';
import { INVENTARIO_USERS, seedBrowserSession, apiLogin } from '../../helpers/auth';
import { getWarehouses } from '../../helpers/api-inventario';
import { waitForPageReady } from '../../helpers/ui';

test.describe('Inventario — seguridad PBAC y formularios fantasma', () => {
  test('USER vacío: ruta bodegas redirige fuera del inventario protegido', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;

    await seedBrowserSession(page, INVENTARIO_USERS.vacio);
    await page.goto('/app/inventario/bodegas');
    await expect(page).not.toHaveURL(/\/app\/inventario\/bodegas/, { timeout: 20_000 });
    expect(page.url()).toMatch(/\/app\//);
  });

  test('solo lectura: ficha bodega con fieldset disabled y sin Guardar', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;

    const { token } = await apiLogin(INVENTARIO_USERS.lectura);
    const warehouses = await getWarehouses(token);
    test.skip(!warehouses.length, 'Sin bodegas visibles para lectura');

    await seedBrowserSession(page, INVENTARIO_USERS.lectura);
    await page.goto(`/app/inventario/bodegas/${warehouses[0].id}`);
    await waitForPageReady(page);

    await expect(
      page.getByText('Solo lectura: no tiene permiso para gestionar bodegas'),
    ).toBeVisible();
    const fieldset = page.locator('fieldset[disabled]');
    await expect(fieldset).toBeVisible();
    await expect(page.getByRole('button', { name: 'GUARDAR BODEGA' })).toHaveCount(0);
  });

  test('solo lectura: ficha artículo con fieldset disabled y sin Guardar', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;

    const { token } = await apiLogin(INVENTARIO_USERS.gestor);
    const catalogRes = await fetch(
      `${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/inventory-items?page=1&pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const catalog = (await catalogRes.json()) as { data?: { id: string }[] };
    const itemId = catalog.data?.[0]?.id;
    test.skip(!itemId, 'Sin artículos en catálogo');

    await seedBrowserSession(page, INVENTARIO_USERS.lectura);
    await page.goto(`/app/articulos/${itemId}`);
    await waitForPageReady(page);

    const fieldset = page.locator('fieldset[disabled]');
    await expect(fieldset).toBeVisible();
    await expect(page.getByRole('button', { name: 'GUARDAR ARTÍCULO' })).toHaveCount(0);
  });
});
