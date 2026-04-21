/**
 * DashboardPage.ts
 *
 * Page Object for the OrangeHRM Dashboard page.
 * Encapsulates all interactions at /web/index.php/dashboard/index.
 *
 * Principle: exposes semantic actions, not raw locators.
 */
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { AppRoute } from '../constants/Routes';
import { DashboardWidget } from '../constants/Messages';

export class DashboardPage extends BasePage {
  // ─── Locators ─────────────────────────────────────────────────────────────

  private get pageTitle() {
    return this.page.locator('.oxd-topbar-header-breadcrumb h6');
  }

  private get dashboardWidgets() {
    return this.page.locator('.orangehrm-dashboard-widget');
  }

  private get quickLaunchIcons() {
    return this.page.locator('.orangehrm-quick-launch-icon');
  }

  private get timeAtWorkWidget() {
    return this.page.locator('.orangehrm-dashboard-widget', { hasText: 'Time at Work' }).first();
  }

  private get myActionsWidget() {
    return this.page.locator('.orangehrm-dashboard-widget', { hasText: 'My Actions' }).first();
  }

  private get quickLaunchWidget() {
    return this.page.locator('.orangehrm-dashboard-widget', { hasText: 'Quick Launch' }).first();
  }

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.navigate(AppRoute.DASHBOARD);
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  async getWidgetCount(): Promise<number> {
    await this.dashboardWidgets.first().waitFor({ state: 'visible' });
    return this.dashboardWidgets.count();
  }

  async getQuickLaunchCount(): Promise<number> {
    await this.quickLaunchIcons.first().waitFor({ state: 'visible' });
    return this.quickLaunchIcons.count();
  }

  async getPageTitle(): Promise<string> {
    return this.getText(this.pageTitle);
  }

  // ─── Assertions ───────────────────────────────────────────────────────────

  async expectDashboardLoaded(): Promise<void> {
    await this.expectUrlContains(AppRoute.DASHBOARD);
    await expect(this.dashboardWidgets.first()).toBeVisible();
  }

  async expectWidgetVisible(widget: DashboardWidget): Promise<void> {
    const widgetMap: Record<DashboardWidget, Locator> = {
      [DashboardWidget.TIME_AT_WORK]: this.timeAtWorkWidget,
      [DashboardWidget.MY_ACTIONS]: this.myActionsWidget,
      [DashboardWidget.QUICK_LAUNCH]: this.quickLaunchWidget,
    };
    await expect(widgetMap[widget]).toBeVisible();
  }
}
