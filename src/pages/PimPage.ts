/**
 * PimPage.ts
 *
 * Page Object for the PIM (Personnel Information Module) Employee List page.
 * Composes SidebarComponent and TableComponent for navigation and data reading.
 */
import { Page } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { SidebarComponent } from '../components/SidebarComponent';
import { TableComponent } from '../components/TableComponent';
import { AppRoute } from '../constants/Routes';
import { SidebarMenu } from '../constants/SidebarMenu';

export class PimPage extends BasePage {
  // ─── Composed Components (private — specs don't access internals) ──────────
  private readonly sidebar: SidebarComponent;
  private readonly employeeTable: TableComponent;

  // ─── Locators ────────────────────────────────────────────────────────────
  private get addEmployeeButton() {
    return this.page.locator('a', { hasText: 'Add Employee' });
  }

  private get searchNameInput() {
    // Scoped by the field container to avoid positional selectors
    return this.page.locator('.oxd-input-group')
      .filter({ hasText: 'Employee Name' })
      .locator('input');
  }

  private get searchButton() {
    return this.page.locator('button[type="submit"]', { hasText: 'Search' });
  }

  constructor(page: Page) {
    super(page);
    this.sidebar = new SidebarComponent(page);
    this.employeeTable = new TableComponent(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  /**
   * Opens the PIM employee list directly via URL.
   */
  async open(): Promise<void> {
    await this.navigate(AppRoute.PIM_LIST);
  }

  /**
   * Navigates to PIM via the sidebar (tests the navigation flow).
   */
  async openViaSidebar(): Promise<void> {
    await this.sidebar.waitUntilVisible();
    await this.sidebar.navigateTo(SidebarMenu.PIM);
    await this.expectUrlContains(AppRoute.PIM_LIST);
  }

  /**
   * Clicks the "Add Employee" button to open the add form.
   */
  async goToAddEmployee(): Promise<void> {
    await this.click(this.addEmployeeButton);
    await this.waitForPageLoad();
    await this.expectUrlContains('addEmployee');
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /**
   * Searches for an employee by name and waits for results.
   */
  async searchEmployee(fullName: string): Promise<void> {
    await this.fill(this.searchNameInput, fullName);
    await this.click(this.searchButton);
    await this.waitForPageLoad();
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  /**
   * Returns the number of records shown in the filtered/unfiltered table.
   */
  async getEmployeeCount(): Promise<number> {
    return this.employeeTable.getRowCount();
  }

  /**
   * Returns true if the "No Records Found" state is shown.
   */
  async hasNoResults(): Promise<boolean> {
    return this.employeeTable.hasNoRecords();
  }

  async expectNoResults(): Promise<void> {
    await this.employeeTable.expectNoRecords();
  }

  async expectHasResults(): Promise<void> {
    await this.employeeTable.expectHasRecords();
  }

  /**
   * Asserts that the current URL matches the PIM employee list page.
   */
  async expectOnPimListPage(): Promise<void> {
    await this.expectUrlContains(AppRoute.PIM_LIST);
  }
}
