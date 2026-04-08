/**
 * LoginPage.ts
 *
 * Page Object para a página de Login do OrangeHRM.
 * Encapsula todas as interações em /web/index.php/auth/login.
 *
 * Princípio: expõe ações semânticas, não locators brutos.
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

  // ─── Navegação ────────────────────────────────────────────────────────────

  /** Abre a página de login diretamente via URL. */
  async open(): Promise<void> {
    await this.navigate(AppRoute.LOGIN);
  }

  // ─── Ações ────────────────────────────────────────────────────────────────

  /**
   * Preenche as credenciais e submete o formulário de login.
   * Aguarda networkidle para garantir que o Dashboard esteja carregado.
   */
  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);
    await this.waitForPageLoad();
  }

  /**
   * Submete o formulário sem preencher nenhum campo.
   * Útil para validar erros de campo obrigatório.
   */
  async submitEmpty(): Promise<void> {
    await this.click(this.loginButton);
  }

  /**
   * Preenche apenas o campo username e submete.
   * Útil para testar validação isolada do campo password.
   */
  async fillOnlyUsername(username: string): Promise<void> {
    await this.fill(this.usernameInput, username);
    await this.click(this.loginButton);
  }

  /**
   * Preenche apenas o campo password e submete.
   * Útil para testar validação isolada do campo username.
   */
  async fillOnlyPassword(password: string): Promise<void> {
    await this.fill(this.passwordInput, password);
    await this.click(this.loginButton);
  }

  // ─── Leitores ─────────────────────────────────────────────────────────────

  /**
   * Retorna o texto da mensagem de erro exibida após falha no login.
   */
  async getLoginErrorMessage(): Promise<string> {
    await this.waitForVisible(this.loginErrorAlert);
    return this.getText(this.loginErrorAlert);
  }

  /**
   * Retorna todos os textos de erro inline dos campos (ex: "Required").
   */
  async getInputErrors(): Promise<string[]> {
    await this.inputErrorMessages.first().waitFor({ state: 'visible' });
    return this.inputErrorMessages.allInnerTexts();
  }

  // ─── Asserções ────────────────────────────────────────────────────────────

  /**
   * Asserta que a página de login está carregada (URL + título).
   */
  async expectOnLoginPage(): Promise<void> {
    await expect(this.page).toHaveURL(/auth\/login/);
    await expect(this.page).toHaveTitle(/OrangeHRM/);
  }

  /**
   * Asserta que o usuário foi redirecionado ao Dashboard após o login.
   */
  async expectLoginSuccess(): Promise<void> {
    await this.expectUrlContains('dashboard');
  }

  /**
   * Asserta que o alerta de erro contém a mensagem esperada.
   * Usa web-first assertion com retry automático do Playwright.
   */
  async expectLoginError(expectedMessage: string): Promise<void> {
    await expect(this.loginErrorAlert).toContainText(expectedMessage);
  }

  /**
   * Asserta que os campos de input estão com o estado visual de erro
   * (classe CSS `oxd-input--error` aplicada pelo framework).
   *
   * @param fields - quais campos verificar ('username' | 'password' | 'both')
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
