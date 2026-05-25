import { expect, type Page } from '@playwright/test';

/** Abre el picker global, busca y elige la primera fila con resultados. */
export async function pickCatalogItem(page: Page, searchHint: string) {
  const dialog = page.locator('dialog.app-global-item-picker-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const search = dialog.getByPlaceholder(/Cód\. inventario|QR|nombre/i);
  const q = searchHint.length >= 2 ? searchHint : `${searchHint}xx`;
  await search.fill(q);
  await search.press('Enter');

  const dataRow = dialog.locator('tbody tr:has(td)').first();
  await expect(dataRow).toBeVisible({ timeout: 20_000 });
  await dataRow.click();

  await expect(dialog).toBeHidden({ timeout: 15_000 });
}
