import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import {
  createEquipmentApi,
  deleteEquipmentApi,
  resolveE2EPrimaryContractId,
} from '../helpers/api-operations-lifecycle';
import { todayIsoDate } from '../helpers/api-equipment-availability';
import { waitForPageReady } from '../helpers/ui';

test.describe('Reactividad global — M2 sincroniza Maestro de Flota', () => {
  let adminToken = '';
  let contractId = '';
  let equipmentId = '';
  const reportDate = todayIsoDate();
  const runId = Date.now().toString(36).slice(-6).toUpperCase();
  const internalId = `ACT-SYNC-${runId}`;

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    adminToken = (await apiLogin(INVENTARIO_USERS.admin)).token;
    contractId = (await resolveE2EPrimaryContractId()) ?? '';
    if (!contractId) throw new Error('resolveE2EPrimaryContractId fallo');

    const eq = await createEquipmentApi(adminToken, {
      contractId,
      internalId,
      initialMeter: 9000,
      currentMeter: 9000,
    });
    if (!eq?.id) throw new Error('createEquipmentApi fallo');
    equipmentId = eq.id;
  });

  test.afterAll(async () => {
    if (adminToken && equipmentId) {
      await deleteEquipmentApi(adminToken, equipmentId).catch(() => {});
    }
  });

  test('dos pestanas: registrar DOWN_FAILURE en M2 actualiza Flota sin reload manual', async ({
    page: fleetPage,
    context,
  }) => {
    const m2Page = await context.newPage();

    await seedBrowserSessionWithContract(
      fleetPage,
      INVENTARIO_USERS.admin,
      contractId,
    );
    await seedBrowserSessionWithContract(m2Page, INVENTARIO_USERS.admin, contractId);

    await fleetPage.goto('/app/flota');
    await waitForPageReady(fleetPage);
    await fleetPage.locator('input[type="search"]').fill(internalId);
    const fleetRow = fleetPage.locator('tr', { hasText: internalId });
    await expect(fleetRow).toBeVisible({ timeout: 25_000 });
    await expect(fleetRow.getByText('Operativo', { exact: true })).toBeVisible();

    let fleetNavigations = 0;
    fleetPage.on('framenavigated', (frame) => {
      if (frame === fleetPage.mainFrame()) fleetNavigations += 1;
    });

    await m2Page.goto(
      `/app/operaciones/disponibilidad/nuevo?date=${reportDate}&shift=DAY&equipmentId=${equipmentId}`,
    );
    await waitForPageReady(m2Page);
    await m2Page.locator('input[type="search"]').fill(internalId);

    const m2Row = m2Page.locator(`#avail-eq-${equipmentId}`);
    await expect(m2Row).toBeVisible({ timeout: 25_000 });
    await m2Row.locator('select').selectOption({ label: 'Detenido por Falla' });
    await m2Row
      .locator('input[type="text"]')
      .fill('Falla E2E de sincronizacion entre M2 y Flota');

    const saveResponse = m2Page.waitForResponse((res) =>
      res.url().includes('/equipment-availability/batch') &&
      res.request().method() === 'POST',
    );
    await m2Page.getByRole('button', { name: /Enviar 1 Reporte/i }).click();
    expect((await saveResponse).status()).toBeLessThan(300);

    await expect(fleetRow.getByText('Fuera de servicio')).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      fleetRow.locator('[data-testid="fleet-action-required-fault"]'),
    ).toBeVisible();
    expect(fleetNavigations).toBe(0);
  });
});
