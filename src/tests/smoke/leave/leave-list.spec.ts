/**
 * leave-list.spec.ts
 *
 * Smoke test suite for the Leave module — Request List.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `leaveListPage` fixture opens /leave/viewLeaveList automatically.
 *  - Tests page load, table, and basic search actions.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Page loads with correct URL and search button visible
 *  ✅ [Positive]   Page title is "Leave List"
 *  ✅ [Positive]   Leave table is visible after load
 *  ✅ [Positive]   Clicking Search without filters returns records
 *  ✅ [Positive]   Reset button clears filters without errors
 *  ❌ [Negative]   Multiple consecutive resets do not break the page
 *  ⚠️  [Edge Case] Search → reset → search cycle keeps the table visible
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { PageTitle } from '../../../constants/Messages';

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('Leave — Request List', () => {

  test.beforeEach(async ({ leaveListPage }) => {
    await leaveListPage.expectPageLoaded();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should load the Leave List page with correct URL and title',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        const title = await leaveListPage.getPageTitle();
        expect(title).toBe(PageTitle.LEAVE_LIST);
      }
    );

    test(
      'should display the leave table after page load',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'should return records when clicking Search with no filters applied',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — default search with no filters
        await leaveListPage.search();

        // Assert — table should remain visible
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'should clear filters without errors when clicking Reset',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — reset with no filters applied
        await leaveListPage.reset();

        // Assert — page remains loaded
        await leaveListPage.expectPageLoaded();
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should not crash the application after multiple consecutive resets',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — three consecutive resets
        await leaveListPage.reset();
        await leaveListPage.reset();
        await leaveListPage.reset();

        // Assert — page remains stable and loaded
        await leaveListPage.expectPageLoaded();
        await leaveListPage.expectTableVisible();
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should keep the table visible after a search and reset cycle',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — search and then reset
        await leaveListPage.search();
        await leaveListPage.reset();

        // Assert — table remains visible
        await leaveListPage.expectTableVisible();
      }
    );
  });
});
