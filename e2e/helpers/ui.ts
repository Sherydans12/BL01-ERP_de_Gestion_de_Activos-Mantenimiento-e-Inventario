import { expect, type Page } from '@playwright/test';

function confirmButtonName(confirmLabel: string | RegExp): string | RegExp {
  if (typeof confirmLabel === 'string') {
    const escaped = confirmLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(\\s*\\(\\d+s\\))?$`, 'i');
  }
  return confirmLabel;
}

/** Cierra modales `<dialog>` de confirmación del design system TPM. */
export async function confirmDialog(page: Page, confirmLabel: string | RegExp = 'Confirmar') {
  const dialog = page.locator('dialog.confirm-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const confirmBtn = dialog.getByRole('button', { name: confirmButtonName(confirmLabel) });
  await expect(confirmBtn).toBeEnabled({ timeout: 20_000 });
  await confirmBtn.click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Espera a que desaparezca el spinner principal de carga de página. */
export async function waitForPageReady(page: Page) {
  const spinner = page.locator('.animate-spin').first();
  if (await spinner.isVisible().catch(() => false)) {
    await spinner.waitFor({ state: 'hidden', timeout: 45_000 }).catch(() => {});
  }
}

export async function selectFirstNonEmptyOption(page: Page, selectLocator: ReturnType<Page['locator']>) {
  const value = await selectLocator.locator('option').evaluateAll((opts) => {
    for (const o of opts) {
      const v = (o as HTMLOptionElement).value;
      if (v && v.trim()) return v;
    }
    return '';
  });
  if (value) await selectLocator.selectOption(value);
}

/** Espera a que un `<select>` esté habilitado y contenga la opción indicada. */
export async function selectOptionWhenReady(
  selectLocator: ReturnType<Page['locator']>,
  value: string,
  timeout = 25_000,
) {
  await expect(selectLocator).toBeEnabled({ timeout });
  await expect
    .poll(async () => selectLocator.locator(`option[value="${value}"]`).count(), { timeout })
    .toBeGreaterThan(0);
  await selectLocator.selectOption(value);
}

/** Select de bodega en Control de Stock (label "Bodega" sin `for=`). */
export function stockDashboardWarehouseSelect(page: Page) {
  return page
    .locator('label')
    .filter({ hasText: /^Bodega$/i })
    .locator('xpath=..')
    .locator('select')
    .first();
}

export function uniqueLabel(prefix: string) {
  return `${prefix} E2E ${Date.now()}`;
}

export async function expectHeadingVisible(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
}
