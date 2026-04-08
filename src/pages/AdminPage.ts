/**
 * AdminPage.ts
 *
 * Page Object para o módulo Admin — Gestão de Usuários do OrangeHRM.
 * Encapsula todas as interações em /web/index.php/admin/viewAdminModule.
 *
 * Princípio: expõe ações semânticas, não locators brutos.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { TableComponent } from '../components/TableComponent';
import { AppRoute } from '../constants/Routes';

export class AdminPage extends BasePage {
  // ─── Components (private — specs não acessam internos) ────────────────────
  private readonly userTable: TableComponent;

  // ─── Locators ─────────────────────────────────────────────────────────────

  private get pageTitle() {
    return this.page.locator('.oxd-topbar-header-breadcrumb h6');
  }

  private get addUserButton() {
    return this.page.locator('button', { hasText: 'Add' });
  }

  private get searchButton() {
    return this.page.locator('button[type="submit"]', { hasText: 'Search' });
  }

  private get resetButton() {
    return this.page.locator('button[type="button"]', { hasText: 'Reset' });
  }

  // Username field has no placeholder — identified by its label in the filter form
  private get usernameInput() {
    return this.page.locator('.oxd-form-row').filter({ hasText: 'Username' }).locator('.oxd-input');
  }

  constructor(page: Page) {
    super(page);
    this.userTable = new TableComponent(page);
  }

  // ─── Navegação ────────────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.navigate(AppRoute.ADMIN);
  }

  // ─── Ações ────────────────────────────────────────────────────────────────

  async searchByUsername(username: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.click(this.searchButton);
    await this.waitForPageLoad();
  }

  async reset(): Promise<void> {
    await this.click(this.resetButton);
    await this.waitForPageLoad();
  }

  async clickAddUser(): Promise<void> {
    await this.click(this.addUserButton);
    await this.waitForPageLoad();
  }

  // ─── Leitores ─────────────────────────────────────────────────────────────

  async getPageTitle(): Promise<string> {
    return this.getText(this.pageTitle);
  }

  async getUserCount(): Promise<number> {
    return this.userTable.getRowCount();
  }

  async hasNoResults(): Promise<boolean> {
    return this.userTable.hasNoRecords();
  }

  // ─── Asserções ────────────────────────────────────────────────────────────

  async expectPageLoaded(): Promise<void> {
    await this.expectUrlContains('admin/view');
    await expect(this.addUserButton).toBeVisible();
  }

  async expectTableVisible(): Promise<void> {
    await this.userTable.expectVisible();
  }
}
