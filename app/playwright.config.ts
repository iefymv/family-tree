// E2E на ЛОКАЛЬНОМ стеке: supabase (уже запущен), `supabase functions serve`, vite preview со сборкой под локальный стек.
// Люди — только вымышленные Ивановы из seed.sql. Трассы и снимки остаются в test-results/ и playwright-report/ (gitignored).
import { defineConfig } from '@playwright/test';
import { localEnv } from './tests/e2e/support/env';

localEnv(); // адрес и ключи — в process.env, не печатаются
const PORT = Number(process.env.E2E_PORT ?? 4174);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/support/global-setup.ts',
  globalTeardown: './tests/e2e/support/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Приветствие на дереве уже закрыто; сценарий 13 проверяет его со свежим хранилищем.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'family-tree.welcome-dismissed', value: '1' }] }] },
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'node tests/e2e/support/serve-functions.mjs',
      wait: { stdout: /E2E functions ready/ },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: `node scripts/with-local-env.mjs npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
