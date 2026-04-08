/**
 * SidebarComponent.ts
 *
 * Represents the left-hand navigation sidebar in OrangeHRM.
 * Extends BaseComponent to scope all locators within the sidebar's DOM root.
 */
import { Page } from '@playwright/test';
import { BaseComponent } from '../utils/BaseComponent';
import { SidebarMenu } from '../constants/SidebarMenu';

export class SidebarComponent extends BaseComponent {
  // ─── Locators ────────────────────────────────────────────────────────────
  private get menuItems() {
    return this.root.locator('.oxd-main-menu-item');
  }

  private get brandLogo() {
    return this.root.locator('.oxd-brand-logo');
  }

  constructor(page: Page) {
    super(page, '.oxd-sidepanel');
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Clicks on a top-level sidebar menu item by its visible text label.
   * Waits for Vue hydration to complete before interacting.
   *
   * Note: waitForLoadState('load') is called here because sidebar navigation
   * always triggers a full page transition — the caller cannot act until
   * the next page is ready.
   *
   * @example
   * await sidebar.navigateTo(SidebarMenu.PIM);
   */
  async navigateTo(menuItem: SidebarMenu): Promise<void> {
    // Wait for at least one nav item to be rendered (Vue hydration complete)
    await this.menuItems.first().waitFor({ state: 'visible', timeout: 30_000 });
    const item = this.menuItems.filter({ hasText: menuItem });
    await item.waitFor({ state: 'visible' });
    await item.click();
    await this.page.waitForLoadState('load');
  }

  /**
   * Returns the text labels of all visible top-level menu items.
   * Useful for asserting which menu items are available for a given role.
   */
  async getMenuLabels(): Promise<string[]> {
    await this.menuItems.first().waitFor({ state: 'visible' });
    return this.menuItems.allInnerTexts();
  }

  /**
   * Returns true if the given menu item is currently highlighted (active).
   */
  async isMenuActive(menuItem: SidebarMenu): Promise<boolean> {
    const item = this.root.locator('.oxd-main-menu-item.active', { hasText: menuItem });
    return item.isVisible();
  }

  /**
   * Clicks the brand logo to navigate back to the Dashboard.
   * waitForLoadState is intentional — logo click always triggers navigation.
   */
  async clickLogo(): Promise<void> {
    await this.brandLogo.click();
    await this.page.waitForLoadState('networkidle');
  }
}
