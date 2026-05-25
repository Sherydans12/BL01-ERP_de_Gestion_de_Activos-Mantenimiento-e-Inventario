import { test, expect } from '../../fixtures/compras.fixture';
import { PBAC_USERS, seedBrowserSession, findPendingPurchaseOrderId, API_BASE } from '../../helpers/auth';

type NavExpectation = {
  user: keyof typeof PBAC_USERS;
  seesCompras: boolean;
  links: string[];
  hiddenLinks?: string[];
};

const MATRIX: NavExpectation[] = [
  { user: 'vacio', seesCompras: false, links: [] },
  {
    user: 'solicitante',
    seesCompras: true,
    links: ['Requerimientos'],
    hiddenLinks: ['Config. Compras', 'Facturas', 'Órdenes de Compra'],
  },
  {
    user: 'comprador',
    seesCompras: true,
    links: ['Requerimientos', 'Órdenes de Compra', 'Recepciones', 'Proveedores', 'Analítica'],
  },
  {
    user: 'aprobador1',
    seesCompras: true,
    links: ['Requerimientos', 'Órdenes de Compra'],
    hiddenLinks: ['Nuevo Requerimiento'],
  },
  {
    user: 'bodega',
    seesCompras: true,
    links: ['Órdenes de Compra', 'Recepciones'],
    hiddenLinks: ['Config. Compras'],
  },
  {
    user: 'tesoreria',
    seesCompras: true,
    links: ['Facturas', 'Calendario de Pagos', 'Órdenes de Compra'],
    hiddenLinks: ['Config. Compras'],
  },
  {
    user: 'config',
    seesCompras: true,
    links: ['Config. Compras', 'Proveedores', 'Analítica'],
    hiddenLinks: ['Requerimientos'],
  },
  {
    user: 'lectura',
    seesCompras: true,
    links: ['Requerimientos', 'Facturas', 'Órdenes de Compra', 'Recepciones', 'Proveedores', 'Analítica'],
  },
  {
    user: 'adminCompras',
    seesCompras: true,
    links: ['Requerimientos', 'Órdenes de Compra', 'Recepciones'],
  },
];

test.describe('Compras — PBAC navegación sidebar', () => {
  test.beforeAll(async () => {
    const ping = await fetch(`${API_BASE}/auth/captcha`).catch(() => null);
    if (!ping?.ok) test.skip(true, 'Backend no disponible en :3000');
  });

  for (const row of MATRIX) {
    test(`persona ${row.user}: menú Compras`, async ({ page }) => {
      await seedBrowserSession(page, PBAC_USERS[row.user]);
      const nav = page.locator('nav');

      if (row.seesCompras) {
        await expect(nav.getByText('Compras', { exact: true })).toBeVisible();
        for (const link of row.links) {
          await expect(page.getByRole('link', { name: link })).toBeVisible();
        }
      } else {
        await expect(nav.getByText('Compras', { exact: true })).toHaveCount(0);
      }

      for (const hidden of row.hiddenLinks ?? []) {
        await expect(page.getByRole('link', { name: hidden })).toHaveCount(0);
      }
    });
  }

  test('lectura: listado requerimientos sin crear', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.lectura);
    await page.goto('/app/compras/requerimientos');
    await expect(page.getByRole('heading', { name: 'Requerimientos de Compra' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo Requerimiento' })).toHaveCount(0);
  });

  test('en ACL sin approve: detalle OC sin Firmar', async ({ page }) => {
    const poId = await findPendingPurchaseOrderId(PBAC_USERS.comprador);
    test.skip(!poId, 'Sin OC pendiente — correr seed + simulate o flujo P2P UI');

    await seedBrowserSession(page, PBAC_USERS.enAclSinApprove);
    await page.goto(`/app/compras/ordenes/${poId}`);
    await expect(page.getByRole('heading', { name: 'Ítems de la Orden' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Firmar' })).toHaveCount(0);
  });

  test('sin contrato: listados vacíos en requerimientos', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.sinContrato);
    await page.goto('/app/compras/requerimientos');
    await expect(page.getByRole('heading', { name: 'Requerimientos de Compra' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver' })).toHaveCount(0);
  });
});
