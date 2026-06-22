import { expect, test } from '@playwright/test';
import { futureDate, loginAsCustomer } from './helpers';

test.describe('Customer booking flow', () => {
  test('browse venue → pick court → book a slot pay-at-venue', async ({ page }) => {
    await loginAsCustomer(page);

    // Discovery lists the seeded venue as a card linking to its storefront.
    await page.goto('/browse');
    // Target the Indiranagar ground specifically — it has "Court A" + ₹600 slots
    // (the other Smash Arena ground has turf courts with different names).
    const venueLink = page
      .getByRole('link', { name: /Indiranagar/i })
      .first();
    await expect(venueLink).toBeVisible();

    // Open the venue on a far-future date (URL param) so open slots exist and
    // don't collide with other runs — avoids driving the date-picker popup.
    const href = (await venueLink.getAttribute('href')) ?? '';
    const venuePath = href.split('?')[0];
    await page.goto(`${venuePath}?date=${futureDate()}`);

    // Pick a court, load availability, select the first OPEN slot. Open slots
    // show a price (e.g. "06:00₹600"); booked/unavailable ones show "Taken" — so
    // match on the rupee amount to avoid clicking an already-booked time.
    await page.getByRole('button', { name: /Court A/i }).click();
    await page.getByRole('button', { name: 'Load availability' }).click();
    const slot = page.getByRole('button', { name: /\d{1,2}:\d{2}.*₹/ }).first();
    await expect(slot).toBeVisible();
    await slot.click();

    // Two-step: the sticky cart bar advances to the "Review & book" step.
    await page.getByRole('button', { name: /review.*book/i }).click();
    // Pay-at-venue (qualified so it doesn't match the "…Pay at venue only" toggle).
    await page.getByRole('button', { name: /pay at venue.*settle/i }).click();
    await expect(
      page.getByRole('heading', { name: /booking confirmed/i }),
    ).toBeVisible();
  });

  test('wallet: buy a pack and see the session balance', async ({ page }) => {
    await loginAsCustomer(page);
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole('heading', { name: 'My wallet' })).toBeVisible();

    // The first operator (seed: Smash Arena) is auto-selected and has seeded
    // packs. Buy the first one and verify the session credit lands.
    await page.getByRole('button', { name: 'Buy' }).first().click();
    await expect(page.getByText(/sessions added/i)).toBeVisible();
  });
});
