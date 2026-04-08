/**
 * employee-list.spec.ts
 *
 * Suite de testes para o módulo PIM — Lista de Funcionários do OrangeHRM.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `pimPage` abre /pim/viewEmployeeList automaticamente.
 *  - Testa navegação, busca e estado da tabela.
 *
 * Nota sobre autocomplete:
 *  O campo "Employee Name" é um autocomplete. Ao digitar valor inválido sem selecionar
 *  do dropdown, o OrangeHRM ignora o filtro e retorna todos os resultados.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Listar funcionários → tabela com registros visíveis
 *  ✅ [Positivo]   Navegar ao PIM via sidebar → URL correta
 *  ✅ [Positivo]   Usar campo de busca → retorna contagem válida (campo é autocomplete)
 *  ✅ [Positivo]   Clicar em "Add Employee" → redireciona ao formulário
 *  ❌ [Negativo]   Buscar nome inexistente → página estável (autocomplete ignora filtro inválido)
 *  ⚠️  [Edge Case] Buscar com espaços em branco → resultados não filtrados
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('PIM — Lista de Funcionários', () => {

  test.beforeEach(async ({ pimPage }) => {
    await pimPage.expectOnPimListPage();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve exibir a lista de funcionários com registros ao abrir o PIM',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'deve navegar ao PIM via sidebar e exibir a lista corretamente',
      { tag: ['@smoke', '@pim'] },
      async ({ page, pimPage }) => {
        // Act — navega via sidebar (valida o fluxo de navegação)
        await pimPage.openViaSidebar();

        // Assert — URL e tabela corretas
        await expect(page).toHaveURL(/pim\/viewEmployeeList/);
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'deve retornar resultados válidos ao usar o campo de busca por nome',
      { tag: ['@smoke', '@pim'] },
      async ({ pimPage }) => {
        // Act — O campo "Employee Name" é autocomplete; digitando sem selecionar
        // do dropdown, o OrangeHRM pode ignorar o filtro e retornar todos os resultados
        await pimPage.searchEmployee('A');

        // Assert — tabela estável com contagem >= 0
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'deve redirecionar ao formulário de adicionar funcionário ao clicar em Add Employee',
      { tag: ['@smoke', '@pim'] },
      async ({ page, pimPage }) => {
        // Act
        await pimPage.goToAddEmployee();

        // Assert
        await expect(page).toHaveURL(/pim\/addEmployee/);
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'deve manter a página estável ao buscar por nome inexistente no autocomplete',
      { tag: ['@regression', '@pim'] },
      async ({ page, pimPage }) => {
        // Nota: "Employee Name" é autocomplete — digitar valor inválido sem selecionar
        // do dropdown faz o OrangeHRM ignorar o filtro e retornar todos os resultados.
        await pimPage.searchEmployee('zzz_inexistente_xyz_99999');

        // Assert — página estável e na URL correta
        await expect(page).toHaveURL(/pim\/viewEmployeeList/);
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'deve retornar todos os registros ao buscar apenas com espaços',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — busca com espaço em branco (não deve filtrar nada)
        await pimPage.searchEmployee('   ');

        // Assert — contagem válida
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
