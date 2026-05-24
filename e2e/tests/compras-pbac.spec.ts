import { test, expect } from '@playwright/test';
import {
  PBAC_USERS,
  seedBrowserSession,
  findPendingPurchaseOrderId,
  API_BASE,
} from '../helpers/auth';

test.describe('Compras PBAC — UI smoke', () => {
  test.beforeAll(async () => {
    const ping = await fetch(`${API_BASE}/auth/captcha`).catch(() => null);
    if (!ping?.ok) {
      test.skip(true, 'Backend no disponible en :3000');
    }
  });

  test('usuario vacío: sin sección Compras en sidebar', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.vacio);
    await expect(page.locator('nav').getByText('Compras', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Requerimientos' })).toHaveCount(0);
  });

  test('solicitante: ve Compras y Requerimientos', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.solicitante);
    await expect(page.locator('nav').getByText('Compras', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Requerimientos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Config. Compras' })).toHaveCount(0);
  });

  test('comprador: ve ítems operativos de Compras', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.comprador);
    await expect(page.getByRole('link', { name: 'Requerimientos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Órdenes de Compra' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Proveedores' })).toBeVisible();
  });

  test('lectura: ve Compras sin botón de creación en requerimientos', async ({ page }) => {
    await seedBrowserSession(page, PBAC_USERS.lectura);
    await page.goto('/app/compras/requerimientos');
    await expect(page.getByRole('link', { name: 'Requerimientos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nuevo Requerimiento' })).toHaveCount(0);
  });

  test('en ACL sin approve: detalle OC sin botón Firmar', async ({ page }) => {
    const poId = await findPendingPurchaseOrderId(PBAC_USERS.comprador);
    test.skip(!poId, 'No hay OC PENDING_APPROVAL (correr simulate:compras-pbac antes)');

    await seedBrowserSession(page, PBAC_USERS.enAclSinApprove);
    await page.goto(`/app/compras/ordenes/${poId}`);
    await expect(page.getByRole('heading', { name: 'Ítems de la Orden' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Firmar' })).toHaveCount(0);
  });
});
