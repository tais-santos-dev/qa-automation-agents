/**
 * LeaveListPage.ts
 *
 * Page Object for the Leave module — Leave Request List.
 * Encapsulates all interactions at /web/index.php/leave/viewLeaveList.
 *
 * Principle: exposes semantic actions, not raw locators.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { TableComponent } from '../components/TableComponent';
import { AppRoute } from '../constants/Routes';

export class LeaveListPage extends BasePage {
  // ─── Components (private — specs don't access internals) ─────────────────
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

  // ─── Navigation ───────────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.navigate(AppRoute.LEAVE);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async search(): Promise<void> {
    await this.click(this.searchButton);
    await this.waitForPageLoad();
  }

  async reset(): Promise<void> {
    await this.click(this.resetButton);
    await this.waitForPageLoad();
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  async getPageTitle(): Promise<string> {
    return this.getText(this.pageTitle);
  }

  async getLeaveCount(): Promise<number> {
    return this.leaveTable.getRowCount();
  }

  async hasNoResults(): Promise<boolean> {
    return this.leaveTable.hasNoRecords();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────

  async expectPageLoaded(): Promise<void> {
    await this.expectUrlContains('leave/viewLeaveList');
    await expect(this.searchButton).toBeVisible();
  }

  async expectNoResults(): Promise<void> {
    await this.leaveTable.expectNoRecords();
  }

  async expectHasResults(): Promise<void> {
    await this.leaveTable.expectHasRecords();
  }

  async expectTableVisible(): Promise<void> {
    await this.leaveTable.expectVisible();
  }
}
