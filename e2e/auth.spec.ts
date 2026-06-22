import { expect, test } from '@playwright/test';
import { loginAsCustomer, loginWithPassword, SEED } from './helpers';

test.describe('Authentication & role routing', () => {
  test('customer logs in via OTP and can reach a player-only route', async ({ page }) => {
    await loginAsCustomer(page);
    // The session grants access to customer-only areas without bouncing to login.
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/wallet$/);
  });

  test('owner logs in and sees the dashboard', async ({ page }) => {
    await loginWithPassword(page, SEED.owner.email, SEED.owner.password);
    await expect(page).toHaveURL(/\/owner$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Packs' })).toBeVisible();
  });

  test('super admin logs in and sees the platform overview', async ({ page }) => {
    await loginWithPassword(page, SEED.admin.email, SEED.admin.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Owners' })).toBeVisible();
  });

  test('bad password shows an error and stays on the console login', async ({ page }) => {
    await loginWithPassword(page, SEED.owner.email, 'wrong-password');
    await expect(page.getByText(/Invalid credentials|Unauthorized|failed/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('unauthenticated access to an owner route redirects to the console login', async ({ page }) => {
    await page.goto('/owner/packs');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
