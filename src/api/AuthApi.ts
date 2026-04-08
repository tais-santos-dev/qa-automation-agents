/**
 * AuthApi.ts
 *
 * Handles API-level authentication for OrangeHRM.
 * Used in globalSetup to create a stored browser state (cookies) so
 * individual tests can skip the UI login flow entirely.
 */
import { BrowserContext, APIRequestContext, request } from '@playwright/test';

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

export class AuthApi {
  private readonly context: BrowserContext;
  private readonly baseUrl: string;

  constructor(context: BrowserContext, baseUrl: string) {
    this.context = context;
    this.baseUrl = baseUrl;
  }

  /**
   * Logs in via OrangeHRM's REST endpoint and returns the resulting
   * browser storage state (cookies), which can then be serialised and
   * reused by every test that does not test authentication itself.
   *
   * @param username - Admin username (default: 'Admin')
   * @param password - Admin password (default: 'admin123')
   */
  async login(username: string, password: string): Promise<StorageState> {
    const apiContext: APIRequestContext = await request.newContext({
      baseURL: this.baseUrl,
      ignoreHTTPSErrors: true,
    });

    // Step 1: GET login page to obtain the CSRF token stored in cookies
    const loginPage = await apiContext.get('/web/index.php/auth/login');
    const setCookieHeader: string = loginPage.headers()['set-cookie'] ?? '';

    // Extract _token from cookie (OrangeHRM uses it as CSRF)
    const tokenCookie: string | undefined = setCookieHeader
      .split(';')
      .map((c: string) => c.trim())
      .find((c: string) => c.startsWith('orangehrm='));

    const csrfToken: string = tokenCookie?.split('=')[1] ?? '';

    // Step 2: POST credentials to validate endpoint
    const loginResponse = await apiContext.post('/web/index.php/auth/validate', {
      form: {
        _username: username,
        _password: password,
        _csrf_token: csrfToken,
      },
    });

    if (!loginResponse.ok() && loginResponse.status() !== 302) {
      throw new Error(
        `API Login failed. Status: ${loginResponse.status()} — ${await loginResponse.text()}`
      );
    }

    // Step 3: Load the session into a real browser context page so we can
    //         extract the full storage state (cookies + localStorage)
    const allCookies = await apiContext.storageState();
    await this.context.addCookies(allCookies.cookies);

    // Navigate to dashboard to populate any localStorage items the SPA needs
    const page = await this.context.newPage();
    await page.goto(`${this.baseUrl}/web/index.php/dashboard/index`, {
      waitUntil: 'networkidle',
    });
    await page.close();

    const storageState = await this.context.storageState();
    await apiContext.dispose();

    return storageState as StorageState;
  }
}
