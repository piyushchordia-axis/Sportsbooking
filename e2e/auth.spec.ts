import { expect, test } from '@playwright/test';
import { loginAsCustomer, loginWithPassword, SEED } from './helpers';

test.describe('Authentication & role routing', () => {
  test('customer logs in via OTP and lands on booking', async ({ page }) => {
    await loginAsCustomer(page);
    // role-adaptive nav for a customer
    await expect(page.getByRole('link', { name: 'Wallet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tournaments' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
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

  test('bad password shows an error and stays on login', async ({ page }) => {
    await loginWithPassword(page, SEED.owner.email, 'wrong-password');
    await expect(page.getByText(/Invalid credentials|Unauthorized|failed/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('unauthenticated access to an owner route redirects to login', async ({ page }) => {
    await page.goto('/owner/packs');
    await expect(page).toHaveURL(/\/login$/);
  });
});
