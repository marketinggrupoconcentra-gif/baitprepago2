import { defineConfig, devices } from '@playwright/test';

/**
 * E2E real contra una aplicación desplegada (o local con `next start`).
 * Base URL: E2E_BASE_URL, por defecto el alias productivo real de Vercel.
 *
 * Los flujos autenticados requieren además:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  (cuenta de test con admin_profile activo)
 * Si no están definidos, esos tests se marcan como skipped (no fallan la suite).
 */
const BASE_URL =
  process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,

  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  // E2E golpea funciones serverless reales; 1 reintento absorbe cold-starts.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
