/**
 * TableComponent.ts
 *
 * Represents the data grid/table used throughout OrangeHRM (Employee List, etc.).
 * Provides strongly-typed methods for searching, reading rows, and triggering actions.
 */
import { Page, expect } from '@playwright/test';
import { BaseComponent } from '../utils/BaseComponent';
import { TableAction } from '../constants/Messages';

export class TableComponent extends BaseComponent {
  // ─── Locators ────────────────────────────────────────────────────────────
  private get rows() {
    return this.root.locator('.oxd-table-row:not(.oxd-table-header-row)');
  }

  private get noRecordsText() {
    return this.root.getByText('No Records Found', { exact: true });
  }

  constructor(page: Page) {
    super(page, '.oxd-table');
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * Returns the number of data rows (excluding the header row).
   * Waits for the table to fully settle (rows OR "No Records Found" must appear).
   */
  async getRowCount(): Promise<number> {
    await this.root.waitFor({ state: 'visible' });
    // Wait for table to settle: either rows appear or "No Records Found" message
    await Promise.race([
      this.rows.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
      this.noRecordsText.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
    ]);
    return this.rows.count();
  }

  /**
   * Returns the text content of all cells in a given row (0-indexed).
   */
  async getRowCells(rowIndex: number): Promise<string[]> {
    const row = this.rows.nth(rowIndex);
    const cells = row.locator('.oxd-table-cell');
    return cells.allInnerTexts();
  }

  /**
   * Returns true if the "No Records Found" message is present in the DOM.
   * Waits for the table container first, then polls for the message.
   */
  async hasNoRecords(): Promise<boolean> {
    await this.root.waitFor({ state: 'visible' });
    // Wait for table to settle: either data rows or "No Records Found" must appear
    await Promise.race([
      this.rows.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
      this.noRecordsText.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
    ]);
    // Use count() for immediate snapshot of current DOM state
    return (await this.noRecordsText.count()) > 0;
  }

  // ─── Assertions ───────────────────────────────────────────────────────────

  async expectNoRecords(): Promise<void> {
    await expect(this.noRecordsText).toBeVisible();
  }

  async expectHasRecords(): Promise<void> {
    await expect(this.noRecordsText).toBeHidden();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Clicks an action button by its TableAction enum value in a specific row (0-indexed).
   */
  async clickActionOnRow(rowIndex: number, action: TableAction): Promise<void> {
    const row = this.rows.nth(rowIndex);
    const button = row.locator('button', { hasText: action });
    await button.waitFor({ state: 'visible' });
    await button.click();
  }

  /**
   * Clicks the icon/link button by title or aria-label in a specific row.
   */
  async clickIconOnRow(rowIndex: number, title: string): Promise<void> {
    const row = this.rows.nth(rowIndex);
    const icon = row.locator(`[title="${title}"], [aria-label="${title}"]`);
    await icon.waitFor({ state: 'visible' });
    await icon.click();
  }

  /**
   * Waits until the table has loaded data (at least 1 row visible).
   */
  async waitForData(timeout = 15_000): Promise<void> {
    await this.root.waitFor({ state: 'visible', timeout });
    await this.rows.first().waitFor({ state: 'visible', timeout });
  }
}
