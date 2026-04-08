/**
 * test.fixture.ts
 *
 * Custom Playwright test fixtures.
 * Extends the base `test` object with pre-instantiated Page Objects and Components
 * so spec files can destructure them directly — no boilerplate in beforeEach needed.
 *
 * Usage:
 *   import { test } from '@fixtures/test.fixture';
 *   test('example', async ({ pimPage, sidebar }) => { ... });
 */
import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { PimPage } from '../pages/PimPage';
import { AddEmployeePage } from '../pages/AddEmployeePage';
import { DashboardPage } from '../pages/DashboardPage';
import { LeaveListPage } from '../pages/LeaveListPage';
import { AdminPage } from '../pages/AdminPage';
import { SidebarComponent } from '../components/SidebarComponent';
import { TopbarComponent } from '../components/TopbarComponent';

// Re-export expect and Page type so spec files only need one import source
export { expect };
export type { Page } from '@playwright/test';

// ─── Fixture Type Definitions ─────────────────────────────────────────────────

type PageFixtures = {
  /** Login page (no auth required) */
  loginPage: LoginPage;

  /** PIM Employee List page (requires auth — use with authenticated project) */
  pimPage: PimPage;

  /** Add Employee form (requires auth) */
  addEmployeePage: AddEmployeePage;

  /** Sidebar navigation component (available on any authenticated page) */
  sidebar: SidebarComponent;

  /** Topbar component with user info and logout */
  topbar: TopbarComponent;

  /** Dashboard page (requires auth) */
  dashboardPage: DashboardPage;

  /** Leave List page (requires auth) */
  leaveListPage: LeaveListPage;

  /** Admin User Management page (requires auth) */
  adminPage: AdminPage;
};

// ─── Extended Test Object ─────────────────────────────────────────────────────

export const test = base.extend<PageFixtures>({
  /**
   * LoginPage fixture — navigates to the login page automatically.
   */
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await use(loginPage);
  },

  /**
   * PimPage fixture — opens the PIM list directly (relies on storageState auth).
   */
  pimPage: async ({ page }, use) => {
    const pimPage = new PimPage(page);
    await pimPage.open();
    await use(pimPage);
  },

  /**
   * AddEmployeePage fixture — opens the Add Employee form directly.
   */
  addEmployeePage: async ({ page }, use) => {
    const addEmployeePage = new AddEmployeePage(page);
    await addEmployeePage.open();
    await use(addEmployeePage);
  },

  /**
   * SidebarComponent fixture — returns a ready-to-use sidebar instance.
   * Does NOT navigate; use with another fixture that opens a page first.
   */
  sidebar: async ({ page }, use) => {
    const sidebar = new SidebarComponent(page);
    await sidebar.waitUntilVisible();
    await use(sidebar);
  },

  /**
   * TopbarComponent fixture — returns a ready-to-use topbar instance.
   */
  topbar: async ({ page }, use) => {
    const topbar = new TopbarComponent(page);
    await topbar.waitUntilVisible();
    await use(topbar);
  },

  /**
   * DashboardPage fixture — opens the Dashboard directly (relies on storageState auth).
   */
  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.open();
    await use(dashboardPage);
  },

  /**
   * LeaveListPage fixture — opens the Leave List directly (relies on storageState auth).
   */
  leaveListPage: async ({ page }, use) => {
    const leaveListPage = new LeaveListPage(page);
    await leaveListPage.open();
    await use(leaveListPage);
  },

  /**
   * AdminPage fixture — opens the Admin User Management page (relies on storageState auth).
   */
  adminPage: async ({ page }, use) => {
    const adminPage = new AdminPage(page);
    await adminPage.open();
    await use(adminPage);
  },
});
