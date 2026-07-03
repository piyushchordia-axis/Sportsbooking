import { expect, test } from '@playwright/test';
import { loginWithPassword, SEED } from './helpers';

test.describe('Super admin console', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, SEED.admin.email, SEED.admin.password);
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('platform overview shows aggregate stats', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Platform overview' }),
    ).toBeVisible();
    // Stat/section labels on the overview (also appear in detail rows → .first()).
    await expect(page.getByText('Gross revenue').first()).toBeVisible();
    await expect(page.getByText('Capacity utilisation').first()).toBeVisible();
  });

  test('game catalogue lists the seeded game', async ({ page }) => {
    await page.getByRole('link', { name: 'Games' }).click();
    await expect(page).toHaveURL(/\/admin\/games$/);
    // The game renders in both the desktop table and the mobile card list.
    await expect(page.getByText(SEED.game).first()).toBeVisible();
  });

  test('owners directory lists the seed owner', async ({ page }) => {
    await page.getByRole('link', { name: 'Owners' }).click();
    await expect(page).toHaveURL(/\/admin\/owners$/);
    await expect(page.getByText('Smash Arena').first()).toBeVisible();
  });
});
