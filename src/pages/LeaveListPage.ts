/**
 * LeaveListPage.ts
 *
 * Page Object para o módulo de Leave — Lista de Solicitações de Licença.
 * Encapsula todas as interações em /web/index.php/leave/viewLeaveList.
 *
 * Princípio: expõe ações semânticas, não locators brutos.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { TableComponent } from '../components/TableComponent';
import { AppRoute } from '../constants/Routes';

export class LeaveListPage extends BasePage {
  // ─── Components (private — specs não acessam internos) ────────────────────
  private readonly leaveTable: TableComponent;

  // ─── Locators ─────────────────────────────────────────────────────────────

  private get pageTitle() {
    return this.page.locator('.oxd-topbar-header-breadcrumb h6');
  }

  private get searchButton() {
    return this.page.locator('button[type="submit"]', { hasText: 'Search' });
  }

  private get resetButton() {
    return this.page.locator('button', { hasText: 'Reset' });
  }

  constructor(page: Page) {
    super(page);
    this.leaveTable = new TableComponent(page);
  }

  // ─── Navegação ────────────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.navigate(AppRoute.LEAVE);
  }

  // ─── Ações ────────────────────────────────────────────────────────────────

  async search(): Promise<void> {
    await this.click(this.searchButton);
    await this.waitForPageLoad();
  }

  async reset(): Promise<void> {
    await this.click(this.resetButton);
    await this.waitForPageLoad();
  }

  // ─── Leitores ─────────────────────────────────────────────────────────────

  async getPageTitle(): Promise<string> {
    return this.getText(this.pageTitle);
  }

  async getLeaveCount(): Promise<number> {
    return this.leaveTable.getRowCount();
  }

  async hasNoResults(): Promise<boolean> {
    return this.leaveTable.hasNoRecords();
  }

  // ─── Asserções ────────────────────────────────────────────────────────────

  async expectPageLoaded(): Promise<void> {
    await this.expectUrlContains('leave/viewLeaveList');
    await expect(this.searchButton).toBeVisible();
  }

  async expectTableVisible(): Promise<void> {
    await this.leaveTable.expectVisible();
  }
}
