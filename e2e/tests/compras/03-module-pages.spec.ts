import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession } from '../../helpers/auth';
import { waitForPageReady } from '../../helpers/ui';

const PAGES: { path: string; heading: string | RegExp }[] = [
  { path: '/app/compras/requerimientos', heading: 'Requerimientos de Compra' },
  { path: '/app/compras/ordenes', heading: 'Órdenes de Compra' },
  { path: '/app/compras/recepciones', heading: 'Recepciones de Bodega' },
  { path: '/app/compras/facturas', heading: 'Facturas de compra' },
  { path: '/app/compras/calendario-pagos', heading: 'Calendario de pagos' },
  { path: '/app/compras/proveedores', heading: 'Proveedores' },
  { path: '/app/compras/analytics', heading: 'Analítica de compras' },
  { path: '/app/compras/configuracion', heading: 'Configuración de Compras' },
];

test.describe('Compras — páginas cargan (comprador)', () => {
  test.beforeEach(async ({ page, backendAvailable: _ }) => {
    await seedBrowserSession(page, PBAC_USERS.comprador);
  });

  for (const p of PAGES) {
    test(`GET ${p.path}`, async ({ page }) => {
      await page.goto(p.path);
      await waitForPageReady(page);
      await expect(page.getByRole('heading', { name: p.heading })).toBeVisible({ timeout: 25_000 });
    });
  }
});

test.describe('Compras — páginas lectura (sin escritura)', () => {
  test('configuración bloqueada para lectura', async ({ page, backendAvailable: _ }) => {
    await seedBrowserSession(page, PBAC_USERS.lectura);
    await page.goto('/app/compras/configuracion');
    await waitForPageReady(page);
    await expect(page.getByText(/Vista de solo lectura/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Guardar Configuración' })).toHaveCount(0);
  });
});
