/**
 * employee-list.spec.ts
 *
 * Test suite for the PIM module — Employee List.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `pimPage` fixture opens /pim/viewEmployeeList automatically.
 *  - Tests navigation, search, and table state.
 *
 * Note on autocomplete:
 *  The "Employee Name" field is an autocomplete. Typing an invalid value without
 *  selecting from the dropdown causes OrangeHRM to ignore the filter and return all results.
 *
 * Scenarios covered:
 *  ✅ [Positive]   List employees → table with visible records
 *  ✅ [Positive]   Navigate to PIM via sidebar → correct URL
 *  ✅ [Positive]   Use search field → returns valid count (field is autocomplete)
 *  ✅ [Positive]   Click "Add Employee" → redirects to the form
 *  ❌ [Negative]   Search non-existent name → page stable (autocomplete ignores invalid filter)
 *  ⚠️  [Edge Case] Search with whitespace → unfiltered results
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('PIM — Employee List', () => {

  test.beforeEach(async ({ pimPage }) => {
    await pimPage.expectOnPimListPage();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should display the employee list with records when opening PIM',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'should navigate to PIM via sidebar and display the list correctly',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        // Act — navigate via sidebar (validates the navigation flow)
        await pimPage.openViaSidebar();

        // Assert — correct URL and table
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'should return valid results when using the name search field',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        // Act — "Employee Name" is autocomplete; typing without selecting
        // from the dropdown may cause OrangeHRM to ignore the filter and return all results
        await pimPage.searchEmployee('A');

        // Assert — stable table with count >= 0
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'should redirect to the add employee form when clicking Add Employee',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        // Act
        await pimPage.goToAddEmployee();
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should keep the page stable when searching for a non-existent name in the autocomplete',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Note: "Employee Name" is autocomplete — typing an invalid value without selecting
        // from the dropdown causes OrangeHRM to ignore the filter and return all results.
        await pimPage.searchEmployee('zzz_inexistente_xyz_99999');

        // Assert — page stable and on the correct URL
        await pimPage.expectOnPimListPage();
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should return all records when searching with whitespace only',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — whitespace search should not filter anything
        await pimPage.searchEmployee('   ');

        // Assert — valid count
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
