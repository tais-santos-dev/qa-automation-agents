/**
 * leave-list.spec.ts
 *
 * Suite de testes smoke para o módulo Leave — Lista de Solicitações.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `leaveListPage` abre /leave/viewLeaveList automaticamente.
 *  - Testa carregamento da página, tabela e ações básicas de busca.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Página carrega com URL correta e botão de busca visível
 *  ✅ [Positivo]   Título da página é "Leave List"
 *  ✅ [Positivo]   Tabela de licenças está visível após carregamento
 *  ✅ [Positivo]   Clicar em Search sem filtros retorna registros
 *  ✅ [Positivo]   Botão Reset limpa os filtros sem erros
 *  ❌ [Negativo]   Múltiplos resets consecutivos não quebram a página
 *  ⚠️  [Edge Case] Ciclo search → reset → search mantém tabela visível
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { PageTitle } from '../../../constants/Messages';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('Leave — Lista de Solicitações', () => {

  test.beforeEach(async ({ leaveListPage }) => {
    await leaveListPage.expectPageLoaded();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve carregar a página Leave List com URL e título corretos',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        const title = await leaveListPage.getPageTitle();
        expect(title).toBe(PageTitle.LEAVE_LIST);
      }
    );

    test(
      'deve exibir a tabela de licenças após carregamento da página',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'deve retornar registros ao clicar em Search sem filtros aplicados',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — busca padrão sem filtros
        await leaveListPage.search();

        // Assert — tabela deve permanecer visível
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'deve limpar filtros sem erros ao clicar no botão Reset',
      { tag: ['@smoke', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — reset sem filtros aplicados
        await leaveListPage.reset();

        // Assert — página permanece carregada
        await leaveListPage.expectPageLoaded();
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'não deve quebrar a aplicação após múltiplos resets consecutivos',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — três resets consecutivos
        await leaveListPage.reset();
        await leaveListPage.reset();
        await leaveListPage.reset();

        // Assert — página permanece estável e carregada
        await leaveListPage.expectPageLoaded();
        await leaveListPage.expectTableVisible();
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'deve manter a tabela visível após ciclo de search e reset',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — busca e depois reset
        await leaveListPage.search();
        await leaveListPage.reset();

        // Assert — tabela continua visível
        await leaveListPage.expectTableVisible();
      }
    );
  });
});
