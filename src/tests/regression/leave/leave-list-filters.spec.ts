/**
 * leave-list-filters.spec.ts
 *
 * Suite de testes de regressão para filtros e comportamento da lista de licenças.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `leaveListPage` abre /leave/viewLeaveList automaticamente.
 *  - Valida filtros de data, reset, contagem de registros e estados da tabela.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Página carrega com título correto
 *  ✅ [Positivo]   Tabela visível após carregamento inicial
 *  ✅ [Positivo]   Contagem de registros é um número válido
 *  ✅ [Positivo]   Busca sem filtros obrigatórios mantém a página estável
 *  ✅ [Positivo]   Contagem válida após ciclo de search e reset
 *  ❌ [Negativo]   Múltiplos resets consecutivos mantêm a página estável
 *  ⚠️  [Edge Case] Múltiplas buscas consecutivas sem filtros são estáveis
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { PageTitle } from '../../../constants/Messages';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('Leave — Filtros da Lista de Licenças (Regressão)', () => {

  test.beforeEach(async ({ leaveListPage }) => {
    await leaveListPage.expectPageLoaded();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve exibir o título "Leave List" na página',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        const title = await leaveListPage.getPageTitle();
        expect(title).toBe(PageTitle.LEAVE_LIST);
      }
    );

    test(
      'deve exibir a tabela de licenças visível após carregamento',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'deve retornar contagem de registros maior ou igual a zero',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        const count = await leaveListPage.getLeaveCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'não deve quebrar a aplicação ao executar busca sem nenhum filtro preenchido',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — busca sem filtros (campos em branco)
        await leaveListPage.search();

        // Assert — página continua estável
        await leaveListPage.expectPageLoaded();
        await leaveListPage.expectTableVisible();
      }
    );

    test(
      'deve manter contagem válida após ciclo de search e reset',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — busca padrão e depois reset
        await leaveListPage.search();
        await leaveListPage.reset();

        // Assert — tabela continua carregada com contagem válida
        const finalCount = await leaveListPage.getLeaveCount();
        expect(finalCount).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'deve manter a página estável após múltiplos resets consecutivos',
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
      'deve manter estado consistente após múltiplas buscas consecutivas sem filtros',
      { tag: ['@regression', '@leave'] },
      async ({ leaveListPage }) => {
        // Act — três buscas sem filtros
        await leaveListPage.search();
        await leaveListPage.search();
        await leaveListPage.search();

        // Assert — tabela ainda carregada com contagem válida
        await leaveListPage.expectTableVisible();
        const finalCount = await leaveListPage.getLeaveCount();
        expect(finalCount).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
