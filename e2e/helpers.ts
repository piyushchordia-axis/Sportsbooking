import { expect, Page } from '@playwright/test';

/** Seed credentials (apps/api/prisma/seed.ts). */
export const SEED = {
  owner: { email: 'owner@smasharena.local', password: 'owner12345' },
  admin: { email: 'admin@sportsbooking.local', password: 'admin12345' },
  venueName: 'Smash Arena — Indiranagar',
  game: 'Pickleball',
  devOtp: '123456',
};

/** A fresh Indian mobile per run so customer tests stay independent. */
export function randomMobile(): string {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  return `+919${digits}`;
}

/** A random near-future date (yyyy-mm-dd) so booked slots don't collide across runs. */
export function futureDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30 + Math.floor(Math.random() * 300));
  return d.toISOString().slice(0, 10);
}

/** Customer OTP login (player storefront) → lands on the storefront home. */
export async function loginAsCustomer(page: Page, name = 'E2E Player'): Promise<string> {
  const mobile = randomMobile();
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Get my code' }).click();
  await page.getByLabel('6-digit code').fill(SEED.devOtp);
  await page.getByRole('button', { name: 'Verify & play' }).click();
  await expect(page).toHaveURL(/\/$/);
  return mobile;
}

/** Email/password login for owner or admin (console at /admin/login). */
export async function loginWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
