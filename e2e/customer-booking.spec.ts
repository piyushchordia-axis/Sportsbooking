import { expect, test } from '@playwright/test';
import { futureDate, loginAsCustomer, SEED } from './helpers';

test.describe('Customer booking flow', () => {
  test('browse venue → pick court → book a slot pay-at-venue', async ({ page }) => {
    await loginAsCustomer(page);

    // Discovery lists the seeded venue.
    const venueCard = page.locator('.slot', { hasText: 'Smash Arena' }).first();
    await expect(venueCard).toBeVisible();
    await venueCard.click();

    // Court selector appears; pick a date and load availability.
    await expect(page.getByLabel('Court')).toBeVisible();
    await page.getByLabel('Date').fill(futureDate());
    await page.getByRole('button', { name: 'Load availability' }).click();

    // Select the first open slot and book it.
    const openSlot = page.locator('.slot.open').first();
    await expect(openSlot).toBeVisible();
    await openSlot.click();

    await page.getByRole('button', { name: 'Pay at venue' }).click();

    await expect(
      page.getByText(/Booking .* — confirmed/i),
    ).toBeVisible();
  });

  test('wallet: buy a pack and see the session balance', async ({ page }) => {
    await loginAsCustomer(page);
    await page.getByRole('link', { name: 'Wallet' }).click();
    await expect(page).toHaveURL(/\/wallet$/);

    // Seed offers a "10-Play Flat" pack; buy it and verify the credit lands.
    const buyRow = page.locator('div', { hasText: '10-Play Flat' }).last();
    await buyRow.getByRole('button', { name: 'Buy' }).first().click();

    await expect(page.getByText(/sessions added/i)).toBeVisible();
    await expect(page.getByText('Pack sessions')).toBeVisible();
  });
});
