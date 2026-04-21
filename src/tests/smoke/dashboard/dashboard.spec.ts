/**
 * dashboard.spec.ts
 *
 * Smoke test suite for the OrangeHRM Dashboard.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `dashboardPage` fixture opens /dashboard/index automatically.
 *  - Tests widget load and main screen elements.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Dashboard loads with correct URL
 *  ✅ [Positive]   At least one widget is visible on screen
 *  ✅ [Positive]   "Time at Work" widget is present
 *  ✅ [Positive]   "My Actions" widget is present
 *  ✅ [Positive]   "Quick Launch" widget with shortcut icons is visible
 *  ⚠️  [Edge Case] Dashboard remains stable after reload
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { DashboardWidget, PageTitle } from '../../../constants/Messages';

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('Dashboard — Main Screen', () => {

  test.beforeEach(async ({ dashboardPage }) => {
    await dashboardPage.expectDashboardLoaded();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should load the dashboard with the correct URL after authentication',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        const title = await dashboardPage.getPageTitle();
        expect(title).toBe(PageTitle.DASHBOARD);
      }
    );

    test(
      'should display at least one widget on the dashboard screen',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        const widgetCount = await dashboardPage.getWidgetCount();
        expect(widgetCount).toBeGreaterThan(0);
      }
    );

    test(
      'should display the "Time at Work" widget on the dashboard',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.TIME_AT_WORK);
      }
    );

    test(
      'should display the "My Actions" widget on the dashboard',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.MY_ACTIONS);
      }
    );

    test(
      'should display the "Quick Launch" widget with shortcut icons',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.QUICK_LAUNCH);

        const quickLaunchCount = await dashboardPage.getQuickLaunchCount();
        expect(quickLaunchCount).toBeGreaterThan(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should keep widgets visible after page reload',
      { tag: ['@regression', '@dashboard'] },
      async ({ page, dashboardPage }) => {
        // Act — reload the page
        await page.reload({ waitUntil: 'load' });

        // Assert — dashboard remains loaded with widgets
        await dashboardPage.expectDashboardLoaded();
        const widgetCount = await dashboardPage.getWidgetCount();
        expect(widgetCount).toBeGreaterThan(0);
      }
    );
  });
});
