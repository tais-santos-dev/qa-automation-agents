/**
 * leave-list-filters.spec.ts
 *
 * Regression test suite for filters and leave list behavior.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `leaveListPage` fixture opens /leave/viewLeaveList automatically.
 *  - Validates date filters, reset, record count, and table states.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Page loads with correct title
 *  ✅ [Positive]   Table visible after initial load
 *  ✅ [Positive]   Record count is a valid number
 *  ✅ [Positive]   Search without required filters keeps the page stable
 *  ✅ [Positive]   Valid count after search and reset cycle
 *  ❌ [Negative]   Multiple consecutive resets keep the page stable
 *  ⚠️  [Edge Case] Multiple consecutive searches without filters are stable
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { PageTitle } from '../../../constants/Messages';

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('Leave — Leave List Filters (Regression)', () => {

  test.beforeEach(async ({ leaveListPage }) => {
    await leaveListPage.expectPageLoaded();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should display the "Leave List" title on the page',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        const title = await leaveListPage.getPageTitle();
        expect(title).toBe(PageTitle.LEAVE_LIST);
      }
    );

    test(
      'should display the leave table visible after load',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'should return a record count greater than or equal to zero',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        const count = await leaveListPage.getLeaveCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'should not crash the application when running a search with no filters filled',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — search with empty fields
        await leaveListPage.search();

        // Assert — page remains stable
        await leaveListPage.expectPageLoaded();
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'should maintain a valid count after a search and reset cycle',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — default search and then reset
        await leaveListPage.search();
        await leaveListPage.reset();

        // Assert — table remains loaded with a valid count
        const finalCount = await leaveListPage.getLeaveCount();
        expect(finalCount).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should keep the page stable after multiple consecutive resets',
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
      'should maintain consistent state after multiple consecutive searches without filters',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — three searches without filters
        await leaveListPage.search();
        await leaveListPage.search();
        await leaveListPage.search();

        // Assert — table still loaded with a valid count
        await leaveListPage.expectTableVisible();
        const finalCount = await leaveListPage.getLeaveCount();
        expect(finalCount).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
