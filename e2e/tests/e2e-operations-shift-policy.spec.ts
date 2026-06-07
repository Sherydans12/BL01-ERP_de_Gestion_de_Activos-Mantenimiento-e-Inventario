import { test, expect } from '../fixtures/operaciones.fixture';
import {
  INVENTARIO_USERS,
  apiLogin,
  decodeJwtOperationalConfig,
  seedBrowserSessionWithContract,
} from '../helpers/auth';
import {
  getOperationalConfig,
  patchOperationalConfig,
  type TenantOperationalSnapshot,
} from '../helpers/api-tenant-config';
import {
  batchCreateAvailability,
  exportAvailabilityTemplate,
  getShiftBoard,
  todayIsoDate,
} from '../helpers/api-equipment-availability';
import {
  createEquipmentApi,
  deleteEquipmentApi,
  resolveE2EPrimaryContractId,
} from '../helpers/api-operations-lifecycle';
import { waitForPageReady } from '../helpers/ui';

test.describe('P1b — Política de turnos (JWT + hasNightShift)', () => {
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
    await patchOperationalConfig(adminToken, {
      hasNightShift: operationalSnapshot?.hasNightShift ?? true,
      blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      dayShiftStartTime: operationalSnapshot?.dayShiftStartTime ?? '08:00',
      nightShiftStartTime: operationalSnapshot?.nightShiftStartTime ?? '20:00',
    }).catch(() => {});
  });

  test('API: login JWT incluye operationalConfig alineado con tenant-config', async () => {
    const target = {
      hasNightShift: true,
      blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      dayShiftStartTime: '08:00',
      nightShiftStartTime: '20:00',
    };
    const patch = await patchOperationalConfig(adminToken, target);
    expect(patch.status).toBeLessThan(300);

    const { token, user } = await apiLogin(INVENTARIO_USERS.admin);
    const jwtCfg = decodeJwtOperationalConfig(token);
    const apiCfg = await getOperationalConfig(token);

    expect(jwtCfg?.hasNightShift).toBe(true);
    expect(apiCfg?.hasNightShift).toBe(true);
    expect(jwtCfg?.dayShiftStartTime).toBe('08:00');
    const tenant = user.tenant as { operationalConfig?: TenantOperationalSnapshot } | undefined;
    expect(tenant?.operationalConfig?.hasNightShift).toBe(true);
  });

  test.describe('hasNightShift=false — NIGHT se normaliza a DAY', () => {
    test.beforeAll(async () => {
      const patch = await patchOperationalConfig(adminToken, {
        hasNightShift: false,
        blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      });
      expect(patch.status).toBeLessThan(300);
    });

    test('API: shift-board, batch y export con shift=NIGHT responden OK', async () => {
      const board = await getShiftBoard(adminToken, {
        date: reportDate,
        shift: 'NIGHT',
        contractId,
      });
      expect(board.status).toBeLessThan(300);

      const runId = Date.now().toString(36);
      const eq = await createEquipmentApi(adminToken, {
        contractId,
        internalId: `ACT-SHIFT-${runId.slice(-6).toUpperCase()}`,
        initialMeter: 9000,
        currentMeter: 9000,
      });
      expect(eq?.id).toBeTruthy();

      try {
        const batch = await batchCreateAvailability(adminToken, {
          reportDate,
          shift: 'NIGHT',
          rows: [{ equipmentId: eq!.id, status: 'OPERATIONAL' }],
        });
        expect(batch.status).toBeLessThan(300);

        const exported = await exportAvailabilityTemplate(adminToken, {
          reportDate,
          shift: 'NIGHT',
        });
        expect(exported.status).toBeLessThan(300);
        expect(exported.contentType).toMatch(/spreadsheetml|octet-stream/i);
      } finally {
        if (eq?.id) await deleteEquipmentApi(adminToken, eq.id).catch(() => {});
      }
    });

    test('UI: monitor carga sin selector de turno aunque tenant-config tarde', async ({
      page,
    }) => {
      await seedBrowserSessionWithContract(page, INVENTARIO_USERS.admin, contractId);

      await page.route('**/api/tenant-config', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
        await route.continue();
      });

      const boardWait = page.waitForResponse(
        (r) =>
          r.url().includes('/equipment-availability/shift-board') &&
          r.request().method() === 'GET',
      );

      await page.goto('/app/operaciones/disponibilidad/monitor');
      const boardRes = await boardWait;
      expect(boardRes.status()).toBeLessThan(300);
      expect(boardRes.url()).toMatch(/shift=DAY/);

      await waitForPageReady(page);
      await expect(page.locator('select option', { hasText: /^Día$/ })).toHaveCount(0);
      await expect(page.getByText(/turno noche no está habilitado/i)).toHaveCount(0);
    });
  });

  test.describe('hasNightShift=true — ambos turnos disponibles', () => {
    test.beforeAll(async () => {
      const patch = await patchOperationalConfig(adminToken, {
        hasNightShift: true,
        blockNegativeStock: operationalSnapshot?.blockNegativeStock ?? false,
      });
      expect(patch.status).toBeLessThan(300);
    });

    test('API: shift-board acepta DAY y NIGHT', async () => {
      for (const shift of ['DAY', 'NIGHT'] as const) {
        const board = await getShiftBoard(adminToken, {
          date: reportDate,
          shift,
          contractId,
        });
        expect(board.status, `shift=${shift}`).toBeLessThan(300);
      }
    });
  });
});
