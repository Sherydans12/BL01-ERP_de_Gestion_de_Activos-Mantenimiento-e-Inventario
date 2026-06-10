import { expect, type Page } from '@playwright/test';
import { pickCatalogItem } from './item-picker';
import { selectFirstNonEmptyOption, selectOptionWhenReady, waitForPageReady } from './ui';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toLocalDatetimeInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type FillOtFormOptions = {
  equipmentId?: string;
  equipmentLabel?: string | RegExp;
  warehouseId?: string;
  initialMeter: number;
  finalMeter?: number;
  symptomsText?: string;
  workDescription?: string;
};

/** Completa el formulario mínimo de creación OT en pestaña Datos OT. */
export async function fillOtCreateForm(page: Page, opts: FillOtFormOptions) {
  await page.goto('/app/ots/nueva');
  await waitForPageReady(page);

  const eqSelect = page.locator('select[formControlName="equipmentId"]');
  await expect(eqSelect).toBeEnabled({ timeout: 25_000 });
  if (opts.equipmentId) {
    await eqSelect.selectOption(opts.equipmentId);
  } else if (opts.equipmentLabel) {
    if (typeof opts.equipmentLabel === 'string') {
      await eqSelect.selectOption({
        label: new RegExp(opts.equipmentLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      });
    } else {
      await eqSelect.selectOption({ label: opts.equipmentLabel });
    }
  }
  await page.waitForTimeout(800);

  const whSelect = page
    .locator('label')
    .filter({ hasText: /^Bodega de consumo$/i })
    .locator('xpath=..')
    .locator('select')
    .first();
  await expect(whSelect).toBeEnabled({ timeout: 20_000 });
  if (opts.warehouseId) {
    await selectOptionWhenReady(whSelect, opts.warehouseId);
  } else {
    await selectFirstNonEmptyOption(page, whSelect);
  }

  const now = new Date();
  const detStart = new Date(now.getTime() - 5 * 3600_000);
  const detEnd = new Date(now.getTime() - 2 * 3600_000);
  const mechStart = new Date(now.getTime() - 4 * 3600_000);
  const mechEnd = new Date(now.getTime() - 2 * 3600_000);

  await page.locator('input[formControlName="detentionStartedAt"]').fill(toLocalDatetimeInput(detStart));
  await page.locator('input[formControlName="detentionEndedAt"]').fill(toLocalDatetimeInput(detEnd));
  await page.locator('input[formControlName="detentionInitialMeter"]').fill(String(opts.initialMeter));
  if (opts.finalMeter != null) {
    await page.locator('input[formControlName="detentionFinalMeter"]').fill(String(opts.finalMeter));
  }

  await page.locator('input[formControlName="mechanicAttentionStartedAt"]').fill(toLocalDatetimeInput(mechStart));
  await page.locator('input[formControlName="mechanicAttentionEndedAt"]').fill(toLocalDatetimeInput(mechEnd));

  await page.getByRole('radio', { name: 'Operativo' }).click();
  await page.getByRole('radio', { name: 'No programada' }).click();
  await page.getByRole('radio', { name: 'Correctivo' }).click();

  await page.locator('textarea[formControlName="symptomsText"]').fill(
    opts.symptomsText ?? 'E2E — falla en sistema de filtración de aire',
  );
  await page.locator('textarea[formControlName="workPerformedDescription"]').fill(
    opts.workDescription ?? 'E2E — reemplazo parcial de filtros según consumo real en terreno',
  );
  await page.locator('input[formControlName="responsibleMechanicName"]').fill('PBAC · Mecánico OT');

  await page.getByRole('button', { name: '+ Agregar desde catálogo' }).click();
  const systemDialog = page.locator('dialog.ot-catalog-systems-dialog').filter({ hasText: 'Sistemas intervenidos' });
  await expect(systemDialog).toBeVisible({ timeout: 15_000 });
  await systemDialog.locator('button').filter({ has: page.locator('span.text-sm') }).first().click();
  await expect(systemDialog).toBeHidden({ timeout: 10_000 });
}

export async function addPartLineWithPicker(page: Page, searchHint: string, quantity: number) {
  await page.getByRole('tab', { name: /Repuestos y stock/i }).click();
  await page.getByRole('button', { name: '+ Línea repuesto' }).click();
  await page.getByRole('button', { name: 'Buscar catálogo' }).last().click();
  await pickCatalogItem(page, searchHint);
  const qtyInput = page.locator('input[formControlName="quantity"]').last();
  await qtyInput.fill(String(quantity));
}

export async function saveOtForm(page: Page, creating = true) {
  const datosTab = page.getByRole('tab', { name: /^Datos OT/i });
  if (await datosTab.isVisible()) {
    await datosTab.click();
  }

  const submitBtn = page.getByRole('button', { name: creating ? 'Registrar OT' : 'Guardar cambios' });
  await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/work-orders') && ['POST', 'PATCH'].includes(r.request().method()),
      { timeout: 30_000 },
    ),
    submitBtn.click(),
  ]);
  if (res.status() >= 300) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Work order save HTTP ${res.status()}: ${errBody.slice(0, 800)}`);
  }
  expect(res.status()).toBeLessThan(300);
  if (creating) {
    await page.waitForURL(/\/app\/ots\/[0-9a-f-]+/i, { timeout: 30_000 });
  }
  return res;
}

export async function closeOtFromForm(page: Page, operational = true) {
  await page.getByRole('tab', { name: /^Datos OT/i }).click();
  await page.locator('input[formControlName="detentionStartedAt"]').click();
  const closeBtn = page.getByRole('button', { name: 'Firmar y cerrar OT' });
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    const dialog = page.locator('dialog').filter({ hasText: 'Cerrar OT' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: operational ? 'Sí, operativo' : 'No operativo' })
      .click();
    return;
  }
  throw new Error('Botón "Firmar y cerrar OT" no visible — use cierre vía API');
}
