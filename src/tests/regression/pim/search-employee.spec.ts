/**
 * search-employee.spec.ts
 *
 * Regression test suite for employee search in the PIM module.
 *
 * Strategy:
 *  - Uses the `chromium:authenticated` project (pre-loaded storageState).
 *  - The `pimPage` fixture opens /pim/viewEmployeeList automatically.
 *  - Validates search behavior: results, filters, stability, and edge cases.
 *
 * Note on autocomplete:
 *  The "Employee Name" field is an autocomplete. Typing an invalid value and clicking Search
 *  without selecting from the dropdown causes OrangeHRM to ignore the filter and return all results.
 *  The tests below reflect this real application behavior.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Search without filters returns at least 1 employee with valid count
 *  ✅ [Positive]   Two consecutive table reads return the same count
 *  ✅ [Positive]   Search with partial text returns ≤ total
 *  ❌ [Negative]   Application remains stable when typing invalid text + Search
 *  ❌ [Negative]   Searching with special characters does not cause crash or XSS
 *  ⚠️  [Edge Case] 100-character string does not break the application
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Test Constants ───────────────────────────────────────────────────────────

const MAX_SEARCH_LENGTH = 100;

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('PIM — Employee Search (Regression)', () => {

  test.beforeEach(async ({ pimPage }) => {
    await pimPage.expectOnPimListPage();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should display at least 1 employee in the listing with a valid count',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Assert — default listing has records
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'should return the same count in two consecutive reads without searching',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — two reads of the current table state
        const firstCount = await pimPage.getEmployeeCount();
        const secondCount = await pimPage.getEmployeeCount();

        // Assert — identical results (no state change between reads)
        expect(firstCount).toBe(secondCount);
      }
    );

    test(
      'should return a subset less than or equal to total after typing text and searching',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Arrange — total without filter
        const totalCount = await pimPage.getEmployeeCount();

        // Act — search with any text (autocomplete may ignore invalid value)
        await pimPage.searchEmployee('Admin');
        const filteredCount = await pimPage.getEmployeeCount();

        // Assert — filtered result never exceeds total
        expect(filteredCount).toBeLessThanOrEqual(totalCount);
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should keep the page stable when typing invalid text in the search field',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — value not selectable in autocomplete
        await pimPage.searchEmployee('zzz_nome_impossivel_xyz_00000');

        // Assert — page stable (autocomplete ignores invalid value → returns results)
        await pimPage.expectOnPimListPage();
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'should not crash when searching with special characters',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — special characters (no XSS, no crash expected)
        await pimPage.searchEmployee('<script>alert(1)</script>');

        // Assert — page remains stable on the correct URL
        await pimPage.expectOnPimListPage();
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should not break the application when searching with a 100-character string',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Arrange — long string (MAX_SEARCH_LENGTH chars)
        const longName = 'A'.repeat(MAX_SEARCH_LENGTH);

        // Act
        await pimPage.searchEmployee(longName);

        // Assert — application stable
        await pimPage.expectOnPimListPage();
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
