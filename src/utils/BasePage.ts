/**
 * BasePage.ts
 *
 * Abstract base class for all Page Objects.
 * Wraps Playwright's Page API with resilient, auto-waiting helpers and
 * enforces a consistent interface across the entire test suite.
 *
 * Principle: Page Objects should expose meaningful actions, not raw locators.
 */
import { Page, Locator, expect } from '@playwright/test';
import { AppRoute } from '../constants/Routes';

export abstract class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /**
   * Navigates to a given application route.
   * Waits for the network to be idle before resolving.
   */
  async navigate(route: AppRoute): Promise<void> {
    await this.page.goto(route, { waitUntil: 'load' });
  }

  /**
   * Returns the current page title.
   */
  async getTitle(): Promise<string> {
    return this.page.title();
  }

  // ─── Interactions ──────────────────────────────────────────────────────────

  /**
   * Clicks a locator — auto-waits for it to be visible and stable.
   */
  async click(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    await locator.click();
  }

  /**
   * Fills a text field — clears it first to avoid stale content.
   */
  async fill(locator: Locator, value: string): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    await locator.clear();
    await locator.fill(value);
  }

  /**
   * Selects an option from a dropdown by its visible label.
   */
  async selectOption(locator: Locator, label: string): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    await locator.selectOption({ label });
  }

  /**
   * Checks a checkbox if it is not already checked.
   */
  async check(locator: Locator): Promise<void> {
    await locator.waitFor({ state: 'visible' });
    if (!(await locator.isChecked())) {
      await locator.check();
    }
  }

  // ─── Waits ─────────────────────────────────────────────────────────────────

  /**
   * Waits for the page to reach 'networkidle' state (no pending requests).
   * Use after actions that trigger navigation or heavy API calls.
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Waits for a locator to become visible within the timeout.
   */
  async waitForVisible(locator: Locator, timeout = 15_000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Waits for a locator to disappear (e.g., loading spinners).
   */
  async waitForHidden(locator: Locator, timeout = 15_000): Promise<void> {
    await locator.waitFor({ state: 'hidden', timeout });
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  /**
   * Asserts that the current URL contains the given path fragment.
   */
  async expectUrlContains(fragment: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(fragment));
  }

  /**
   * Retrieves the trimmed inner text of a locator.
   */
  async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.innerText()).trim();
  }
}
