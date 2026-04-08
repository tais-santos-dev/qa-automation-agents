/**
 * admin-users.spec.ts
 *
 * Suite de testes smoke para o módulo Admin — Gestão de Usuários do OrangeHRM.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `adminPage` abre /admin/viewSystemUsers automaticamente.
 *  - Testa carregamento da página, tabela de usuários e fluxos básicos.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Página Admin carrega com tabela e botão "Add" visíveis
 *  ✅ [Positivo]   Tabela de usuários está visível com registros
 *  ✅ [Positivo]   Buscar usuário Admin retorna ao menos 1 resultado
 *  ✅ [Positivo]   Clicar em "Add" redireciona ao formulário de criação
 *  ✅ [Positivo]   Reset limpa a busca e restaura a listagem completa
 *  ❌ [Negativo]   Buscar usuário inexistente exibe "No Records Found"
 *  ⚠️  [Edge Case] Buscar com caracteres especiais não quebra a aplicação
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Dados de teste ───────────────────────────────────────────────────────────

const ADMIN_USERNAME = process.env.ADMIN_USER ?? 'Admin';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('Admin — Gestão de Usuários', () => {

  test.beforeEach(async ({ adminPage }) => {
    await adminPage.expectPageLoaded();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve exibir a tabela de usuários ao carregar a página Admin',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        await adminPage.expectTableVisible();
      }
    );

    test(
      'deve exibir a tabela de usuários com ao menos 1 registro',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        const count = await adminPage.getUserCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'deve encontrar ao menos 1 resultado ao buscar pelo usuário Admin',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        // Act
        await adminPage.searchByUsername(ADMIN_USERNAME);

        // Assert — Admin sempre existe na demo
        const hasNoResults = await adminPage.hasNoResults();
        expect(hasNoResults).toBe(false);

        const count = await adminPage.getUserCount();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    );

    test(
      'deve redirecionar ao formulário de criação ao clicar em "Add"',
      { tag: ['@smoke', '@admin'] },
      async ({ page, adminPage }) => {
        // Act
        await adminPage.clickAddUser();

        // Assert — deve ir para a tela de adição de usuário
        await expect(page).toHaveURL(/admin\/saveSystemUser/);
      }
    );

    test(
      'deve restaurar a listagem completa após clicar em Reset',
      { tag: ['@smoke', '@admin'] },
      async ({ adminPage }) => {
        // Arrange — aplica filtro antes
        await adminPage.searchByUsername(ADMIN_USERNAME);
        const filteredCount = await adminPage.getUserCount();

        // Act — limpa o filtro
        await adminPage.reset();

        // Assert — deve ter igual ou mais resultados que filtrado
        const totalCount = await adminPage.getUserCount();
        expect(totalCount).toBeGreaterThanOrEqual(filteredCount);
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'deve exibir "No Records Found" ao buscar por usuário inexistente',
      { tag: ['@regression', '@admin'] },
      async ({ adminPage }) => {
        // Act
        await adminPage.searchByUsername('usr_zzz_99999_inexistente');

        // Assert
        const hasNoResults = await adminPage.hasNoResults();
        expect(hasNoResults).toBe(true);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'não deve quebrar a aplicação ao buscar com caracteres especiais no Username',
      { tag: ['@regression', '@admin'] },
      async ({ page, adminPage }) => {
        // Act — caracteres especiais não devem causar crash
        await adminPage.searchByUsername('<script>alert(1)</script>');

        // Assert — página continua estável na URL correta
        await expect(page).toHaveURL(/admin\/viewSystemUsers/);
        await adminPage.expectPageLoaded();
      }
    );
  });
});
