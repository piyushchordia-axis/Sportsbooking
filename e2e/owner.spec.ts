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
    await page.getByRole('link', { name: 'Packs' }).click();
    await expect(page).toHaveURL(/\/owner\/packs$/);

    const name = `E2E Pack ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create pack' }).click();

    await expect(page.getByText('Pack created.')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('create an offer and see it listed', async ({ page }) => {
    await page.getByRole('link', { name: 'Offers' }).click();
    await expect(page).toHaveURL(/\/owner\/offers$/);

    const name = `E2E Offer ${Date.now()}`;
    await page.getByLabel('Name').fill(name);
    // Unique promo code so the test is re-runnable (code is unique per owner).
    await page.getByLabel('Code').fill(`E2E${Date.now()}`);
    await page.getByRole('button', { name: 'Create offer' }).click();

    await expect(page.getByText('Offer created.')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('players CRM directory loads', async ({ page }) => {
    await page.getByRole('link', { name: 'Players' }).click();
    await expect(page).toHaveURL(/\/owner\/players$/);
    await expect(page.getByRole('heading', { name: 'Players (CRM)' })).toBeVisible();
  });
});
