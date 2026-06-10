import { test, expect } from '../../fixtures/inventario.fixture';
import { INVENTARIO_USERS, seedBrowserSession, apiLogin } from '../../helpers/auth';
import {
  getInventoryItem,
  getWarehouseStock,
  getCategoryFamilies,
  getCategoryChildren,
  getUnits,
  getWarehouses,
} from '../../helpers/api-inventario';
import { selectOptionWhenReady, uniqueLabel, waitForPageReady } from '../../helpers/ui';

test.describe('Inventario — catálogo y política flotante', () => {
  test('alta maestro con umbrales pendientes sin fila item_stocks en cero', async ({
    page,
    backendAvailable,
  }) => {
    void backendAvailable;

    const { token, user } = await apiLogin(INVENTARIO_USERS.gestor);
    const contractId =
      user.allowedContracts?.find((c) => c !== 'ALL') ?? user.allowedContracts?.[0];
    const families = await getCategoryFamilies(token);
    test.skip(!families.length, 'Sin familias de categoría en tenant');

    const children = await getCategoryChildren(token, families[0].id);
    test.skip(!children.length, 'Sin subcategorías en familia seed');

    const units = await getUnits(token);
    test.skip(!units.length, 'Sin UoM en tenant');

    const warehouses = contractId
      ? await getWarehouses(token, contractId)
      : await getWarehouses(token);
    test.skip(!warehouses.length, 'Sin bodegas activas en contrato UI');

    const targetWarehouse = warehouses[0];
    const partNumber = `E2E-POL-${Date.now().toString(36).slice(-6)}`;
    const itemName = uniqueLabel('Artículo política flotante');

    await seedBrowserSession(page, INVENTARIO_USERS.gestor);
    await page.goto('/app/articulos/nuevo');
    await waitForPageReady(page);

    await page.locator('input[formControlName="partNumber"]').fill(partNumber);
    await page.locator('input[formControlName="name"]').fill(itemName);
    await page.locator('select[formControlName="familyId"]').selectOption(families[0].id);
    await page.waitForTimeout(500);
    await page.locator('select[formControlName="categoryId"]').selectOption(children[0].id);
    await page.locator('select[formControlName="unitOfMeasureId"]').selectOption(units[0].id);

    await page.locator('details summary').filter({ hasText: 'Umbrales para una bodega' }).click();
    const whSelect = page.locator('select[formControlName="initialWarehouseId"]');
    await selectOptionWhenReady(whSelect, targetWarehouse.id);
    await page.locator('input[formControlName="initialMinStock"]').fill('5');
    await page.locator('input[formControlName="initialMaxStock"]').fill('40');

    const createResp = page.waitForResponse(
      (r) => r.url().includes('/inventory-items') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'GUARDAR ARTÍCULO' }).click();
    const res = await createResp;
    expect(res.status()).toBeLessThan(300);
    const createdBody = (await res.json()) as { id?: string };
    const createdId = createdBody.id ?? '';
    expect(createdId).toBeTruthy();

    await page.waitForURL(/\/app\/articulos/, { timeout: 30_000 });

    const created = await getInventoryItem(token, createdId);
    expect(created).not.toBeNull();
    expect(created!.policyTargetWarehouseId).toBe(targetWarehouse.id);
    expect(Number(created!.policyMinStock)).toBe(5);
    expect(Number(created!.policyMaxStock)).toBe(40);

    const stockRows = await getWarehouseStock(token, targetWarehouse.id);
    const ghost = stockRows.find(
      (r) => r.itemId === created!.id && Number(r.quantity) === 0,
    );
    expect(ghost).toBeUndefined();
  });
});
