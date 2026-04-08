/**
 * dashboard.spec.ts
 *
 * Suite de testes smoke para o Dashboard do OrangeHRM.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `dashboardPage` abre /dashboard/index automaticamente.
 *  - Testa carregamento dos widgets e elementos principais da tela.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Dashboard carrega com URL correta
 *  ✅ [Positivo]   Pelo menos um widget visível na tela
 *  ✅ [Positivo]   Widget "Time at Work" está presente
 *  ✅ [Positivo]   Widget "My Actions" está presente
 *  ✅ [Positivo]   Widget "Quick Launch" com ícones de atalho visíveis
 *  ⚠️  [Edge Case] Dashboard permanece estável após reload
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { DashboardWidget, PageTitle } from '../../../constants/Messages';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('Dashboard — Tela Principal', () => {

  test.beforeEach(async ({ dashboardPage }) => {
    await dashboardPage.expectDashboardLoaded();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve carregar o dashboard com a URL correta após autenticação',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        const title = await dashboardPage.getPageTitle();
        expect(title).toBe(PageTitle.DASHBOARD);
      }
    );

    test(
      'deve exibir ao menos um widget na tela do dashboard',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        const widgetCount = await dashboardPage.getWidgetCount();
        expect(widgetCount).toBeGreaterThan(0);
      }
    );

    test(
      'deve exibir o widget "Time at Work" no dashboard',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.TIME_AT_WORK);
      }
    );

    test(
      'deve exibir o widget "My Actions" no dashboard',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.MY_ACTIONS);
      }
    );

    test(
      'deve exibir o widget "Quick Launch" com ícones de atalho',
      { tag: ['@smoke', '@dashboard'] },
      async ({ dashboardPage }) => {
        await dashboardPage.expectWidgetVisible(DashboardWidget.QUICK_LAUNCH);

        const quickLaunchCount = await dashboardPage.getQuickLaunchCount();
        expect(quickLaunchCount).toBeGreaterThan(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'deve manter widgets visíveis após recarregamento da página',
      { tag: ['@regression', '@dashboard'] },
      async ({ page, dashboardPage }) => {
        // Act — recarrega a página
        await page.reload({ waitUntil: 'load' });

        // Assert — dashboard continua carregado com widgets
        await dashboardPage.expectDashboardLoaded();
        const widgetCount = await dashboardPage.getWidgetCount();
        expect(widgetCount).toBeGreaterThan(0);
      }
    );
  });
});
