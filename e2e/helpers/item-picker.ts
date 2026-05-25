import { expect, type Page } from '@playwright/test';

/** Abre el picker global, busca y elige la primera fila con resultados. */
export async function pickCatalogItem(page: Page, searchHint: string) {
  const dialog = page.locator('dialog.app-global-item-picker-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const search = dialog.getByPlaceholder(/Cód\. inventario|QR|nombre/i);
  const q = searchHint.trim().length >= 2 ? searchHint.trim() : `${searchHint.trim()}xx`;
  await search.fill(q);

  const pickerFetch = page.waitForResponse(
    (r) => r.url().includes('/inventory-items/picker') && r.request().method() === 'GET',
    { timeout: 25_000 },
  );
  await search.press('Enter');
  const res = await pickerFetch;
  let total = -1;
  if (res) {
    try {
      const body = (await res.json()) as { total?: number };
      total = Number(body.total ?? -1);
    } catch {
      total = -1;
    }
  }

  if (total === 1) {
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    return;
  }

  const dataRow = dialog.locator('tbody tr.cursor-pointer').first();
  await expect(dataRow).toBeVisible({ timeout: 25_000 });
  await dataRow.click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}
