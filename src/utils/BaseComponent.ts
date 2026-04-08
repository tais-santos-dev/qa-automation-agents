/**
 * BaseComponent.ts
 *
 * Abstract base class for all UI Component Objects.
 * Components represent reusable, self-contained UI fragments
 * (e.g., Sidebar, Topbar, Table) that appear across multiple pages.
 *
 * Each component scopes its locators to a root element, preventing
 * accidental matches outside the component's DOM boundary.
 */
import { Locator, Page } from '@playwright/test';

export abstract class BaseComponent {
  protected readonly root: Locator;
  protected readonly page: Page;

  /**
   * @param page - The Playwright Page instance
   * @param rootSelector - CSS selector that uniquely identifies this component's root
   */
  constructor(page: Page, rootSelector: string) {
    this.page = page;
    this.root = page.locator(rootSelector);
  }

  // ─── Visibility ────────────────────────────────────────────────────────────

  /** Returns true if the component's root element is visible in the viewport. */
  async isVisible(): Promise<boolean> {
    return this.root.isVisible();
  }

  /** Waits for the component's root to be visible. */
  async waitUntilVisible(timeout = 10_000): Promise<void> {
    await this.root.waitFor({ state: 'visible', timeout });
  }

  /** Asserts that the component's root is visible. */
  async expectVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.root).toBeVisible();
  }

  // ─── Text ──────────────────────────────────────────────────────────────────

  /**
   * Returns the trimmed text content of a locator scoped within this component.
   * Waits for the element to be visible before reading.
   */
  protected async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.innerText()).trim();
  }

  // ─── Scoped Locators ───────────────────────────────────────────────────────

  /**
   * Returns a scoped child locator for further chaining.
   * Use this when you need to interact with a child in a non-standard way.
   */
  protected locate(selector: string): Locator {
    return this.root.locator(selector);
  }
}
