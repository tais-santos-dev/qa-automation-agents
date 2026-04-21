/**
 * LoginPage.ts
 *
 * Page Object for the OrangeHRM Login page.
 * Encapsulates all interactions at /web/index.php/auth/login.
 *
 * Principle: exposes semantic actions, not raw locators.
 */
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { AppRoute } from '../constants/Routes';

export class LoginPage extends BasePage {
  // ─── Locators ────────────────────────────────────────────────────────────
  private get usernameInput() {
    return this.page.locator('input[name="username"]');
  }

  private get passwordInput() {
    return this.page.locator('input[name="password"]');
  }

  private get loginButton() {
    return this.page.locator('button[type="submit"]');
  }

  private get loginErrorAlert() {
    return this.page.getByRole('alert');
  }

  private get inputErrorMessages() {
    return this.page.locator('.oxd-input-field-error-message');
  }

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  /** Opens the login page directly via URL. */
  async open(): Promise<void> {
    await this.navigate(AppRoute.LOGIN);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Fills in credentials and submits the login form.
   * Waits for networkidle to ensure the Dashboard is loaded.
   */
  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);
    await this.waitForPageLoad();
  }

  /**
   * Submits the form without filling in any fields.
   * Useful to validate required field errors.
   */
  async submitEmpty(): Promise<void> {
    await this.click(this.loginButton);
  }

  /**
   * Fills only the username field and submits.
   * Useful to test isolated validation of the password field.
   */
  async fillOnlyUsername(username: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.click(this.loginButton);
  }

  /**
   * Fills only the password field and submits.
   * Useful to test isolated validation of the username field.
   */
  async fillOnlyPassword(password: string): Promise<void> {
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  /**
   * Returns the error message text displayed after a failed login.
   */
  async getLoginErrorMessage(): Promise<string> {
    await this.waitForVisible(this.loginErrorAlert);
    return this.getText(this.loginErrorAlert);
  }

  /**
   * Returns all inline field error texts (e.g., "Required").
   */
  async getInputErrors(): Promise<string[]> {
    await this.inputErrorMessages.first().waitFor({ state: 'visible' });
    return this.inputErrorMessages.allInnerTexts();
  }

  // ─── Assertions ───────────────────────────────────────────────────────────

  /**
   * Asserts the login page is loaded (URL + title).
   */
  async expectOnLoginPage(): Promise<void> {
    await expect(this.page).toHaveURL(/auth\/login/);
    await expect(this.page).toHaveTitle(/OrangeHRM/);
  }

  /**
   * Asserts the user was redirected to the Dashboard after login.
   */
  async expectLoginSuccess(): Promise<void> {
    await this.expectUrlContains('dashboard');
  }

  /**
   * Asserts the error alert contains the expected message.
   * Uses Playwright's web-first assertion with automatic retry.
   */
  async expectLoginError(expectedMessage: string): Promise<void> {
    await expect(this.loginErrorAlert).toContainText(expectedMessage);
  }

  /**
   * Asserts the input fields are in the visual error state
   * (CSS class `oxd-input--error` applied by the framework).
   *
   * @param fields - which fields to check ('username' | 'password' | 'both')
   */
  async expectInputsHaveErrorState(fields: 'username' | 'password' | 'both' = 'both'): Promise<void> {
    if (fields === 'username' || fields === 'both') {
      await expect(this.usernameInput).toHaveClass(/oxd-input--error/);
    }
    if (fields === 'password' || fields === 'both') {
      await expect(this.passwordInput).toHaveClass(/oxd-input--error/);
    }
  }
}
