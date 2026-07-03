import { expect, test } from '@playwright/test';
import { loginWithPassword, SEED } from './helpers';

test.describe('Owner console', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, SEED.owner.email, SEED.owner.password);
    await expect(page).toHaveURL(/\/owner$/);
  });

  test('dashboard shows report stats', async ({ page }) => {
    await expect(page.getByText('Revenue (paid)')).toBeVisible();
    await expect(page.getByText('Players (CRM)')).toBeVisible();
  });

  test('create a membership pack and see it listed', async ({ page }) => {
    // Deep-link rather than click the (collapsible) sidebar group.
    await page.goto('/owner/packs');
    await expect(page).toHaveURL(/\/owner\/packs$/);

    await page.getByRole('button', { name: 'New pack' }).click();
    const name = `E2E Pack ${Date.now()}`;
    await page.getByLabel('Pack name').fill(name);
    await page.getByRole('button', { name: 'Create pack' }).click();

    // The dialog closes and the new pack appears in the list.
    await expect(page.getByText(name)).toBeVisible();
  });

  test('create an offer and see it listed', async ({ page }) => {
    await page.goto('/owner/offers');
    await expect(page).toHaveURL(/\/owner\/offers$/);

    await page.getByRole('button', { name: 'New offer' }).click();
    const name = `E2E Offer ${Date.now()}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    // Unique promo code so the test is re-runnable (code is unique per owner).
    await page.getByLabel('Promo code').fill(`E2E${Date.now()}`);
    await page.getByRole('button', { name: 'Create offer' }).click();

    await expect(page.getByText(name)).toBeVisible();
  });

  test('players CRM directory loads', async ({ page }) => {
    await page.goto('/owner/players');
    await expect(page).toHaveURL(/\/owner\/players$/);
    // Redesign: page title "Players" + a "CRM" badge (was a "Players (CRM)" heading).
    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();
  });
});
