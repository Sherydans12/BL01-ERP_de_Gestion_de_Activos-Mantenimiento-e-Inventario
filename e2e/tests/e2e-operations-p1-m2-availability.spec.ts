import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  apiLogin,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import {
  getOperationalConfig,
  patchOperationalConfig,
  type TenantOperationalSnapshot,
} from '../helpers/api-tenant-config';
import {
  batchCreateAvailability,
  getShiftBoard,
  todayIsoDate,
} from '../helpers/api-equipment-availability';
import {
  createEquipmentApi,
  deleteEquipmentApi,
  resolveE2EPrimaryContractId,
} from '../helpers/api-operations-lifecycle';
import { waitForPageReady } from '../helpers/ui';

test.describe('P1 — M2 Disponibilidad y ajustes empresa', () => {
  let adminToken = '';
  let contractId = '';
  let operationalSnapshot: TenantOperationalSnapshot | null = null;
  const reportDate = todayIsoDate();

  test.beforeAll(async ({ backendAvailable }) => {
    void backendAvailable;
    adminToken = (await apiLogin(INVENTARIO_USERS.admin)).token;
    contractId = (await resolveE2EPrimaryContractId()) ?? '';
    if (!contractId) throw new Error('resolveE2EPrimaryContractId falló');
    operationalSnapshot = await getOperationalConfig(adminToken);
  });

  test.afterAll(async () => {
    if (!adminToken) return;
    const restore: TenantOperationalSnapshot = {
      hasNightShift: operationalSnapshot?.hasNightShift ?? true,
      blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      dayShiftStartTime: operationalSnapshot?.dayShiftStartTime ?? '08:00',
      nightShiftStartTime: operationalSnapshot?.nightShiftStartTime ?? '20:00',
    };
    await patchOperationalConfig(adminToken, restore).catch(() => {});
  });

  test.describe('5 — Monitor: Pendientes → reportar → Reportados', () => {
    const runId = Date.now().toString(36);
    const internalId = `ACT-P1-MON-${runId.slice(-6).toUpperCase()}`;
    let equipmentId = '';

    test.beforeAll(async () => {
      const eq = await createEquipmentApi(adminToken, {
        contractId: contractId!,
        internalId,
        initialMeter: 8000,
        currentMeter: 8000,
      });
      if (!eq?.id) throw new Error('createEquipmentApi falló');
      equipmentId = eq.id;
    });

    test.afterAll(async () => {
      if (equipmentId) await deleteEquipmentApi(adminToken, equipmentId).catch(() => {});
    });

    test('UI: reportar desde tab Pendientes y ver en Reportados', async ({ page }) => {
      const shift = 'DAY';

      await expect
        .poll(async () => {
          const board = await getShiftBoard(adminToken, {
            date: reportDate,
            shift,
            contractId: contractId!,
            tab: 'PENDING',
            search: internalId,
          });
          const rows = (board.body as { rows?: { internalId?: string }[] })?.rows ?? [];
          return rows.some((r) => r.internalId === internalId);
        })
        .toBe(true);

      await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, contractId!);
      await page.goto(
        `/app/operaciones/disponibilidad/monitor?date=${reportDate}&shift=${shift}&tab=PENDING`,
      );
      await waitForPageReady(page);

      await page.locator('input[type="search"]').fill(internalId);
      await page.getByRole('button', { name: 'Consultar' }).click();
      const rowReportLink = page.getByRole('link', { name: 'Reportar', exact: true });
      await expect(rowReportLink).toBeVisible({ timeout: 25_000 });

      await rowReportLink.click();
      await expect(page).toHaveURL(new RegExp(`equipmentId=${equipmentId}`), {
        timeout: 15_000,
      });
      await expect(page).toHaveURL(new RegExp(`shift=${shift}`));

      const batch = await batchCreateAvailability(adminToken, {
        reportDate,
        shift,
        rows: [{ equipmentId, status: 'OPERATIONAL' }],
      });
      expect(batch.status, JSON.stringify(batch.body)).toBeLessThan(300);

      await expect
        .poll(async () => {
          const board = await getShiftBoard(adminToken, {
            date: reportDate,
            shift,
            contractId: contractId!,
            tab: 'REPORTED',
            search: internalId,
          });
          const rows = (board.body as { rows?: { internalId?: string }[] })?.rows ?? [];
          return rows.some((r) => r.internalId === internalId);
        })
        .toBe(true);

      await page.goto(
        `/app/operaciones/disponibilidad/monitor?date=${reportDate}&shift=${shift}&tab=REPORTED`,
      );
      await waitForPageReady(page);
      const reportedBoard = page.waitForResponse(
        (r) =>
          r.url().includes('/equipment-availability/shift-board') &&
          r.url().includes('tab=REPORTED'),
      );
      await page.locator('input[type="search"]').fill(internalId);
      await reportedBoard;
      await expect(page.getByRole('button', { name: internalId })).toBeVisible({
        timeout: 20_000,
      });
    });
  });

  test.describe('6 — Batch create (2 equipos, mismo estado)', () => {
    const runId = Date.now().toString(36);
    const ids: string[] = [];
    const internalIds = [
      `ACT-P1-B1-${runId.slice(-5).toUpperCase()}`,
      `ACT-P1-B2-${runId.slice(-5).toUpperCase()}`,
    ];

    test.beforeAll(async () => {
      for (const internalId of internalIds) {
        const eq = await createEquipmentApi(adminToken, {
          contractId: contractId!,
          internalId,
          initialMeter: 8100,
          currentMeter: 8100,
        });
        if (!eq?.id) throw new Error(`createEquipmentApi falló: ${internalId}`);
        ids.push(eq.id);
      }
    });

    test.afterAll(async () => {
      for (const id of ids) {
        await deleteEquipmentApi(adminToken, id).catch(() => {});
      }
    });

    test('API: POST /batch con 2 filas OPERATIONAL y aparecen en shift-board REPORTED', async () => {
      const batch = await batchCreateAvailability(adminToken, {
        reportDate,
        shift: 'DAY',
        rows: ids.map((equipmentId) => ({
          equipmentId,
          status: 'OPERATIONAL',
        })),
      });
      expect(batch.status, JSON.stringify(batch.body)).toBeLessThan(300);
      expect((batch.body as { committed?: number })?.committed).toBe(2);

      for (const internalId of internalIds) {
        const board = await getShiftBoard(adminToken, {
          date: reportDate,
          shift: 'DAY',
          contractId: contractId!,
          tab: 'REPORTED',
          search: internalId,
        });
        expect(board.status).toBeLessThan(300);
        const rows = (board.body as { rows?: { internalId?: string }[] })?.rows ?? [];
        expect(rows.some((r) => r.internalId === internalId)).toBe(true);
      }
    });
  });

  test('8 — Ajustes empresa: toggles operacionales persisten tras reload', async ({ page }) => {
    await patchOperationalConfig(adminToken, {
      hasNightShift: true,
      blockNegativeStock: false,
    });

    await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, contractId!);
    await page.goto('/app/configuracion/empresa');
    await waitForPageReady(page);

    const nightToggle = page.locator('input[formControlName="hasNightShift"]');
    const blockToggle = page.locator('input[formControlName="blockNegativeStock"]');

    if (await nightToggle.isChecked()) {
      await nightToggle.uncheck({ force: true });
    }
    if (!(await blockToggle.isChecked())) {
      await blockToggle.check({ force: true });
    }

    const saveWait = page.waitForResponse(
      (r) =>
        r.url().includes('/tenant-config/operational') &&
        r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'GUARDAR TURNOS' }).click();
    expect((await saveWait).status()).toBeLessThan(300);

    await expect
      .poll(async () => {
        const cfg = await getOperationalConfig(adminToken);
        return cfg?.hasNightShift === false && cfg?.blockNegativeStock === true;
      })
      .toBe(true);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPageReady(page);
    await expect(nightToggle).not.toBeChecked();
    await expect(blockToggle).toBeChecked();
  });

  test.describe('7 — hasNightShift=false', () => {
    test.beforeAll(async () => {
      const patch = await patchOperationalConfig(adminToken, {
        hasNightShift: false,
        blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      });
      expect(patch.status).toBeLessThan(300);
    });

    test('UI sin selector de turno; API DAY implícito y NIGHT rechazado', async ({
      page,
    }) => {
      const runId = Date.now().toString(36);
      const internalId = `ACT-P1-NS-${runId.slice(-6).toUpperCase()}`;
      const eq = await createEquipmentApi(adminToken, {
        contractId: contractId!,
        internalId,
        initialMeter: 8200,
        currentMeter: 8200,
      });
      expect(eq?.id).toBeTruthy();

      try {
        await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, contractId!);
        const cfgWait = page.waitForResponse(
          (r) =>
            r.url().includes('/tenant-config') &&
            r.request().method() === 'GET' &&
            !r.url().includes('/operational'),
        );
        await page.goto('/app/operaciones/disponibilidad/monitor');
        await cfgWait;
        await waitForPageReady(page);
        await expect(
          page.locator('select option', { hasText: /^Día$/ }),
        ).toHaveCount(0);

        await page.goto('/app/operaciones/disponibilidad/nuevo');
        await waitForPageReady(page);
        await expect(
          page.locator('label').filter({ has: page.getByText(/^Día$/) }),
        ).toHaveCount(0);

        const nightBad = await batchCreateAvailability(adminToken, {
          reportDate,
          shift: 'NIGHT',
          rows: [{ equipmentId: eq!.id, status: 'OPERATIONAL' }],
        });
        expect(nightBad.status).toBeGreaterThanOrEqual(400);
        expect(JSON.stringify(nightBad.body)).toMatch(/noche|NIGHT|turno/i);

        const dayOk = await batchCreateAvailability(adminToken, {
          reportDate,
          rows: [{ equipmentId: eq!.id, status: 'OPERATIONAL' }],
        });
        expect(dayOk.status).toBeLessThan(300);
      } finally {
        if (eq?.id) await deleteEquipmentApi(adminToken, eq.id).catch(() => {});
      }
    });
  });

});
