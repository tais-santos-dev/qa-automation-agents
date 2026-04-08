/**
 * TopbarComponent.ts
 *
 * Represents the top navigation bar in OrangeHRM.
 * Contains the user profile menu and logout functionality.
 */
import { Page } from '@playwright/test';
import { BaseComponent } from '../utils/BaseComponent';

export class TopbarComponent extends BaseComponent {
  // ─── Locators ────────────────────────────────────────────────────────────
  private get userDropdownToggle() {
    return this.root.locator('.oxd-userdropdown-tab');
  }

  // The dropdown menu is rendered as a Vue portal outside .oxd-topbar in the DOM,
  // so it must be located via page scope rather than this.root.
  private get userDropdownMenu() {
    return this.page.locator('.oxd-dropdown-menu');
  }

  private get logoutMenuItem() {
    return this.page.locator('.oxd-dropdown-menu a', { hasText: 'Logout' });
  }

  private get userNameLabel() {
    return this.root.locator('.oxd-userdropdown-name');
  }

  private get breadcrumbTitle() {
    return this.root.locator('.oxd-topbar-header-breadcrumb h6');
  }

  constructor(page: Page) {
    super(page, '.oxd-topbar');
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Returns the name of the currently logged-in user as shown in the topbar.
   */
  async getUserName(): Promise<string> {
    return this.getText(this.userNameLabel);
  }

  /**
   * Returns the current page title from the topbar breadcrumb.
   * Centralizes the title locator — removes duplication across Page Objects.
   */
  async getPageTitle(): Promise<string> {
    return this.getText(this.breadcrumbTitle);
  }

  /**
   * Opens the user dropdown menu.
   */
  async openUserMenu(): Promise<void> {
    await this.userDropdownToggle.click();
    await this.userDropdownMenu.waitFor({ state: 'visible' });
  }

  /**
   * Logs out the current user and waits for navigation to complete.
   * Navigation state is managed here because logout always triggers a redirect —
   * the caller has no meaningful action to perform until the page changes.
   */
  async logout(): Promise<void> {
    await this.openUserMenu();
    await this.logoutMenuItem.click();
    await this.page.waitForLoadState('networkidle');
  }
}
