/**
 * global-setup.ts
 *
 * Runs once before the entire test suite (via `globalSetup` in playwright.config.ts).
 * Performs a UI-based login and saves the authenticated browser storage state,
 * so individual tests can skip the UI login flow entirely.
 *
 * Optimization: reuses an existing auth state if it was saved within the last 30 minutes.
 */
import { chromium, FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const AUTH_DIR = path.resolve(__dirname, 'auth');
const AUTH_STATE_PATH = path.join(AUTH_DIR, 'admin-storage-state.json');
const AUTH_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function isAuthStateFresh(): boolean {
  if (!fs.existsSync(AUTH_STATE_PATH)) return false;
  const stats = fs.statSync(AUTH_STATE_PATH);
  return Date.now() - stats.mtimeMs < AUTH_MAX_AGE_MS;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  if (isAuthStateFresh()) {
    console.log('\n♻️  Reusing existing auth state (< 30 min old)\n');
    return;
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
  const username = process.env.ADMIN_USER ?? 'Admin';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: baseUrl,
    // Increase timeouts for slow demo site
  });
  const page = await context.newPage();

  try {
    // Navigate to login page
    await page.goto('/web/index.php/auth/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    // Wait for the form to be interactive
    await page.locator('input[name="username"]').waitFor({ state: 'visible', timeout: 60_000 });

    // Fill credentials
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();

    // Wait for successful redirect to dashboard
    await page.waitForURL('**/dashboard/index', { timeout: 60_000 });

    // Save the authenticated storage state
    const storageState = await context.storageState();
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(storageState, null, 2));
    console.log(`\n✅ Auth state saved to: ${AUTH_STATE_PATH}\n`);
  } catch (error) {
    throw new Error(`Global setup failed — could not authenticate: ${error}`);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

export default globalSetup;
