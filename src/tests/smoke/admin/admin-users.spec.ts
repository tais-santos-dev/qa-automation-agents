/**
 * admin-users.spec.ts
 *
 * Smoke test suite for the Admin module — User Management.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `adminPage` fixture opens /admin/viewSystemUsers automatically.
 *  - Tests page load, user table, and basic flows.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Admin page loads with table and "Add" button visible
 *  ✅ [Positive]   User table is visible with records
 *  ✅ [Positive]   Searching for Admin user returns at least 1 result
 *  ✅ [Positive]   Clicking "Add" redirects to the creation form
 *  ✅ [Positive]   Reset clears the search and restores the full listing
 *  ❌ [Negative]   Searching for a non-existent user shows "No Records Found"
 *  ⚠️  [Edge Case] Searching with special characters does not crash the application
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Test Data ────────────────────────────────────────────────────────────────

const ADMIN_USERNAME = process.env.ADMIN_USER ?? 'Admin';

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('Admin — User Management', () => {

  test.beforeEach(async ({ adminPage }) => {
    await adminPage.expectPageLoaded();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should display the user table when loading the Admin page',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        await adminPage.expectTableVisible();
      }
    );

    test(
      'should display the user table with at least 1 record',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        const count = await adminPage.getUserCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'should find at least 1 result when searching for the Admin user',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        // Act
        await adminPage.searchByUsername(ADMIN_USERNAME);

        // Assert — Admin always exists in the demo
        await adminPage.expectHasResults();

        const count = await adminPage.getUserCount();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    );

    test(
      'should redirect to the creation form when clicking "Add"',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        // Act
        await adminPage.clickAddUser();

        // Assert — should navigate to the add user screen
        await adminPage.expectNavigatedToAddUserForm();
      }
    );

    test(
      'should restore the full listing after clicking Reset',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        // Arrange — apply filter first
        await adminPage.searchByUsername(ADMIN_USERNAME);
        const filteredCount = await adminPage.getUserCount();

        // Act — clear the filter
        await adminPage.reset();

        // Assert — should have equal or more results than filtered
        const totalCount = await adminPage.getUserCount();
        expect(totalCount).toBeGreaterThanOrEqual(filteredCount);
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should show "No Records Found" when searching for a non-existent user',
      { tag: ['@regression', '@admin'] },
      async ({ adminPage }) => {
        // Act
        await adminPage.searchByUsername('usr_zzz_99999_inexistente');

        // Assert
        await adminPage.expectNoResults();
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should not crash the application when searching with special characters in Username',
      { tag: ['@regression', '@admin'] },
      async ({ adminPage }) => {
        // Act — special characters should not cause a crash
        await adminPage.searchByUsername('<script>alert(1)</script>');

        // Assert — page remains stable on the correct URL
        await adminPage.expectPageLoaded();
      }
    );
  });
});
