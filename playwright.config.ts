import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real React app against a live API + Postgres.
 *
 * Prerequisites (see e2e/README.md): Postgres up, schema migrated, RLS applied
 * and the database seeded (`pnpm db:seed`). The `webServer` block boots the full
 * stack via `pnpm dev` (API :3001 + web :5173); set CI=1 to force a fresh start.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Allow pointing at a preinstalled Chromium (e.g. air-gapped CI) without
    // changing the bundled-browser default.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
