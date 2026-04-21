/**
 * add-employee.spec.ts
 *
 * Test suite for the employee creation flow in the PIM module.
 *
 * Strategy:
 *  - Uses `chromium:authenticated` (pre-authenticated session via storageState).
 *  - The `addEmployeePage` fixture opens /pim/addEmployee automatically.
 *  - Uses EmployeeFactory to generate unique data per run, avoiding
 *    conflicts on the shared demo instance.
 *
 * Scenarios covered:
 *  ✅ [Positive]   Create employee with full data → success toast
 *  ✅ [Positive]   Create employee without login details → saves personal data only
 *  ❌ [Negative]   Submit empty form → required field errors
 *  ❌ [Negative]   Create with mismatched passwords → confirmation error
 *  ⚠️  [Edge Case] Name at maximum length → field accepts without truncating
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { EmployeeFactory } from '../../../factories/EmployeeFactory';
import { ErrorMessage, SuccessMessage } from '../../../constants/Messages';

// ─── Test Constants ───────────────────────────────────────────────────────────

const KNOWN_PASSWORD = 'SenhaCorreta@1';
const MISMATCHED_PASSWORD = 'SenhaDiferente@2';
const MAX_FIRST_NAME_LENGTH = 30;

// ─── Main Suite ───────────────────────────────────────────────────────────

test.describe('PIM — Add Employee', () => {

  test.beforeEach(async ({ addEmployeePage }) => {
    await addEmployeePage.expectOnAddEmployeePage();
  });

  // ─── Positive Scenarios ───────────────────────────────────────────────────

  test.describe('Positive', () => {

    test(
      'should create an employee with full data and display a success toast',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange
        const employee = EmployeeFactory.build();

        // Act
        await addEmployeePage.createEmployee(employee, true);

        // Assert — success toast and redirect to the profile
        await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
      }
    );

    test(
      'should create an employee without login details and save personal data only',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange
        const employee = EmployeeFactory.build();

        // Act — createEmployee with createLogin = false
        await addEmployeePage.createEmployee(employee, false);

        // Assert
        await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
      }
    );
  });

  // ─── Negative Scenarios ───────────────────────────────────────────────────

  test.describe('Negative', () => {

    test(
      'should display required field errors when submitting an empty form',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Act — attempt to save without filling anything
        await addEmployeePage.clickSave();

        // Assert — at least one required field error
        const firstError = await addEmployeePage.getFirstValidationError();
        expect(firstError).toContain(ErrorMessage.REQUIRED_FIELD);
      }
    );

    test(
      'should display a confirmation error when filling mismatched passwords',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange — data with mismatched password and confirmation
        const employee = EmployeeFactory.build({ password: KNOWN_PASSWORD });
        const employeeWithWrongConfirm = { ...employee, confirmPassword: MISMATCHED_PASSWORD };

        // Act
        await addEmployeePage.fillPersonalDetails(employeeWithWrongConfirm);
        await addEmployeePage.fillLoginDetails(employeeWithWrongConfirm);
        await addEmployeePage.clickSave();

        // Assert — specific password mismatch message
        const error = await addEmployeePage.getFirstValidationError();
        expect(error).toContain(ErrorMessage.PASSWORD_MISMATCH);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'should accept a firstName near the maximum allowed length',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange — name with MAX_FIRST_NAME_LENGTH characters (near OrangeHRM limit)
        const longName = 'A'.repeat(MAX_FIRST_NAME_LENGTH);
        const employee = EmployeeFactory.build({ firstName: longName });

        // Act
        await addEmployeePage.fillPersonalDetails(employee);

        // Assert — field should accept the value without truncating
        const value = await addEmployeePage.getFirstNameValue();
        expect(value).toBe(longName);
      }
    );
  });
});
