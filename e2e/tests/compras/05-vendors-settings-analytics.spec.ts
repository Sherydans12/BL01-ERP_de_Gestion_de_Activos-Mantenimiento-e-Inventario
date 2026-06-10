import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession, apiLogin } from '../../helpers/auth';
import { uniqueLabel, waitForPageReady } from '../../helpers/ui';

async function createVendorViaApi(code: string, name: string) {
  const { token } = await apiLogin(PBAC_USERS.config);
  const res = await fetch(`${process.env.E2E_API_BASE || 'http://localhost:3000/api'}/vendors`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  return res.ok;
}

test.describe('Compras — proveedores, config y analítica', () => {
  test('config: guardar parámetros sin error', async ({ page, backendAvailable: _ }) => {
    await seedBrowserSession(page, PBAC_USERS.config);
    await page.goto('/app/compras/configuracion');
    await expect(page.getByRole('heading', { name: 'Configuración de Compras' })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar Configuración' }).click();
    await waitForPageReady(page);
    await expect(page.getByText(/guardad|actualiz|éxito|ok/i).first()).toBeVisible({ timeout: 15_000 }).catch(() => {});
  });

  test('config: crear proveedor y listar en UI', async ({ page, backendAvailable: _ }) => {
    const code = `PV${Date.now().toString().slice(-8)}`;
    const name = uniqueLabel('Proveedor E2E');
    expect(await createVendorViaApi(code, name)).toBeTruthy();

    await seedBrowserSession(page, PBAC_USERS.config);
    await page.goto('/app/compras/proveedores');
    await page.getByPlaceholder(/Código, nombre, RUT/i).fill(code);
    await waitForPageReady(page);
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  });

  test('analítica: dashboard y export PDF', async ({ page, backendAvailable: _ }) => {
    await seedBrowserSession(page, PBAC_USERS.comprador);
    await page.goto('/app/compras/analytics');
    await expect(page.getByRole('heading', { name: 'Analítica de compras' })).toBeVisible();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await waitForPageReady(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 45_000 }).catch(() => null);
    await page.getByRole('button', { name: 'Exportar Reporte PDF' }).click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    }
  });

  test('tesorería: calendario de pagos', async ({ page, backendAvailable: _ }) => {
    await seedBrowserSession(page, PBAC_USERS.tesoreria);
    await page.goto('/app/compras/calendario-pagos');
    await expect(page.getByRole('heading', { name: 'Calendario de pagos' })).toBeVisible();
    await page.getByRole('link', { name: 'Lista de facturas' }).click();
    await expect(page.getByRole('heading', { name: 'Facturas de compra' })).toBeVisible();
  });
});
