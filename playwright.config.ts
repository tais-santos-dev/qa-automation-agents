import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

const BASE_URL = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
const AUTH_STATE_PATH = 'auth/admin-storage-state.json';

export default defineConfig({
  // ─── Test Discovery ─────────────────────────────────────────────────────────
  testDir: './src/tests',
  testMatch: '**/*.spec.ts',

  // ─── Global Settings ─────────────────────────────────────────────────────────
  fullyParallel: false,       // OrangeHRM demo is shared; serialise to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,                 // Always 1 worker — demo site is shared and has rate limits
  timeout: 45_000,
  expect: { timeout: 10_000 },

  // ─── Global Setup ────────────────────────────────────────────────────────────
  globalSetup: './global-setup.ts',

  // ─── Reporters ───────────────────────────────────────────────────────────────
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['allure-playwright', { outputFolder: 'allure-results' }],
  ],

  // ─── Shared Settings for All Tests ──────────────────────────────────────────
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // ─── Projects (Browsers / Environments) ─────────────────────────────────────
  projects: [
    /**
     * Setup project: runs globalSetup-style auth via API and saves storage state.
     * All projects that need to be pre-authenticated depend on this.
     */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // Chromium — authenticated (most tests)
    {
      name: 'chromium:authenticated',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_PATH,
      },
      dependencies: ['setup'],
      testIgnore: ['**/auth/login.spec.ts', '**/*.setup.ts'],
    },

    // Chromium — unauthenticated (login / auth tests)
    {
      name: 'chromium:unauthenticated',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/auth/login.spec.ts'],
    },

    // Firefox — authenticated (cross-browser smoke)
    {
      name: 'firefox:authenticated',
      use: {
        ...devices['Desktop Firefox'],
        storageState: AUTH_STATE_PATH,
      },
      dependencies: ['setup'],
      testIgnore: ['**/auth/login.spec.ts', '**/*.setup.ts'],
    },
  ],

  // ─── Output ──────────────────────────────────────────────────────────────────
  outputDir: 'test-results',
});
