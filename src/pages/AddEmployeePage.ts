/**
 * AddEmployeePage.ts
 *
 * Page Object for the Add Employee form in OrangeHRM PIM module.
 * Handles filling personal details and optionally setting login credentials.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { AppRoute } from '../constants/Routes';
import { SuccessMessage } from '../constants/Messages';
import { EmployeeData } from '../factories/EmployeeFactory';

export class AddEmployeePage extends BasePage {
  // ─── Locators ────────────────────────────────────────────────────────────
  private get firstNameInput() {
    return this.page.locator('input[name="firstName"]');
  }

  private get middleNameInput() {
    return this.page.locator('input[name="middleName"]');
  }

  private get lastNameInput() {
    return this.page.locator('input[name="lastName"]');
  }

  private get employeeIdInput() {
    // Each input group has exactly one label + one input — more precise than form-row
    return this.page.locator('.oxd-input-group').filter({ hasText: 'Employee Id' }).locator('input');
  }

  private get createLoginDetailsToggle() {
    return this.page.locator('.oxd-switch-input');
  }

  private get usernameInput() {
    return this.page.locator('.oxd-input-group')
      .filter({ hasText: 'Username' })
      .locator('input');
  }

  private get passwordInput() {
    return this.page.locator('.oxd-input-group')
      .filter({ hasText: /^Password$/ })
      .locator('input');
  }

  private get confirmPasswordInput() {
    return this.page.locator('.oxd-input-group')
      .filter({ hasText: 'Confirm Password' })
      .locator('input');
  }

  private get saveButton() {
    return this.page.locator('button[type="submit"]', { hasText: 'Save' });
  }

  private get successToast() {
    return this.page.locator('.oxd-toast', { hasText: SuccessMessage.EMPLOYEE_SAVED });
  }

  private get firstValidationErrorLocator() {
    return this.page.locator('.oxd-input-field-error-message').first();
  }

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  async open(): Promise<void> {
    await this.navigate(AppRoute.ADD_EMPLOYEE);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Fills all personal details fields on the Add Employee form.
   * Clears the auto-generated Employee ID and types the factory-generated one.
   */
  async fillPersonalDetails(data: EmployeeData): Promise<void> {
    await this.fill(this.firstNameInput, data.firstName);
    await this.fill(this.middleNameInput, data.middleName);
    await this.fill(this.lastNameInput, data.lastName);

    // OrangeHRM pre-fills the Employee ID — clear and override
    await this.fill(this.employeeIdInput, data.employeeId);
  }

  /**
   * Enables the "Create Login Details" section and fills username/password.
   * Only call this if login credentials should be created for the employee.
   */
  async fillLoginDetails(data: EmployeeData): Promise<void> {
    // Toggle the login details section on using BasePage.check() — idempotent
    await this.check(this.createLoginDetailsToggle);

    await this.usernameInput.waitFor({ state: 'visible' });
    await this.fill(this.usernameInput, data.username);
    await this.fill(this.passwordInput, data.password);
    await this.fill(this.confirmPasswordInput, data.confirmPassword);
  }

  /**
   * Clicks the Save button without waiting for the success toast.
   * Use this in negative/edge-case scenarios where save is expected to fail.
   */
  async clickSave(): Promise<void> {
    await this.click(this.saveButton);
  }

  /**
   * Submits the form and waits for the success toast.
   */
  async save(): Promise<void> {
    await this.clickSave();
    await this.successToast.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /**
   * Complete flow: fill personal details, optionally login details, then save.
   */
  async createEmployee(data: EmployeeData, createLogin = true): Promise<void> {
    await this.fillPersonalDetails(data);
    if (createLogin) {
      await this.fillLoginDetails(data);
    }
    await this.save();
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  /**
   * Returns the current value of the firstName input field.
   */
  async getFirstNameValue(): Promise<string> {
    return this.firstNameInput.inputValue();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────

  /**
   * Asserts that the add employee page is loaded (URL check).
   */
  async expectOnAddEmployeePage(): Promise<void> {
    await expect(this.page).toHaveURL(/pim\/addEmployee/);
  }

  /**
   * Asserts that the success toast contains the expected message.
   */
  async expectSuccessToast(expectedText: string): Promise<void> {
    await expect(this.successToast).toBeVisible({ timeout: 15_000 });
    await expect(this.successToast).toContainText(expectedText);
  }

  /**
   * Returns the text of the first validation error visible on the form.
   */
  async getFirstValidationError(): Promise<string> {
    return this.getText(this.firstValidationErrorLocator);
  }
}
