import { expect, test } from '@playwright/test';
import { loginWithPassword, SEED } from './helpers';

test.describe('Super admin console', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, SEED.admin.email, SEED.admin.password);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('platform overview shows aggregate stats', async ({ page }) => {
    // Scope to the stat tiles (.slot) — "Owners" also appears as a nav link.
    await expect(page.locator('.slot', { hasText: 'Owners' })).toBeVisible();
    await expect(page.locator('.slot', { hasText: 'Venues' })).toBeVisible();
    await expect(page.locator('.slot', { hasText: 'Gross revenue' })).toBeVisible();
  });

  test('game catalogue lists the seeded game', async ({ page }) => {
    await page.getByRole('link', { name: 'Games' }).click();
    await expect(page).toHaveURL(/\/admin\/games$/);
    await expect(page.getByText(SEED.game)).toBeVisible();
  });

  test('owners directory lists the seed owner', async ({ page }) => {
    await page.getByRole('link', { name: 'Owners' }).click();
    await expect(page).toHaveURL(/\/admin\/owners$/);
    await expect(page.getByText('Smash Arena')).toBeVisible();
  });
});
