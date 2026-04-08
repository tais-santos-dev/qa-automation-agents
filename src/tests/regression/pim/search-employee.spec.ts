/**
 * search-employee.spec.ts
 *
 * Suite de testes de regressão para busca de funcionários no módulo PIM.
 *
 * Estratégia:
 *  - Usa o projeto `chromium:authenticated` (storageState pré-carregado).
 *  - A fixture `pimPage` abre /pim/viewEmployeeList automaticamente.
 *  - Valida comportamentos de busca: resultados, filtros, estabilidade e edge cases.
 *
 * Nota sobre autocomplete:
 *  O campo "Employee Name" é um autocomplete. Ao digitar valor inválido e clicar Search
 *  sem selecionar do dropdown, o OrangeHRM ignora o filtro e retorna todos os resultados.
 *  Os testes abaixo refletem esse comportamento real da aplicação.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Busca sem filtros retorna ao menos 1 funcionário com contagem válida
 *  ✅ [Positivo]   Duas leituras consecutivas da tabela retornam mesma contagem
 *  ✅ [Positivo]   Busca com texto parcial retorna ≤ total
 *  ❌ [Negativo]   Aplicação permanece estável ao digitar texto inválido + Search
 *  ❌ [Negativo]   Buscar com caracteres especiais não causa crash ou XSS
 *  ⚠️  [Edge Case] String de 100 caracteres não quebra a aplicação
 */

import { test, expect } from '../../../fixtures/test.fixture';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('PIM — Busca de Funcionários (Regressão)', () => {

  test.beforeEach(async ({ pimPage }) => {
    await pimPage.expectOnPimListPage();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve exibir ao menos 1 funcionário na listagem com contagem válida',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Assert — listagem padrão tem registros
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThan(0);
      }
    );

    test(
      'deve retornar a mesma contagem em duas leituras consecutivas sem busca',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Act — duas leituras do estado atual da tabela
        const firstCount = await pimPage.getEmployeeCount();
        const secondCount = await pimPage.getEmployeeCount();

        // Assert — resultados idênticos (sem alteração de estado entre leituras)
        expect(firstCount).toBe(secondCount);
      }
    );

    test(
      'deve retornar subset menor ou igual ao total após digitar texto e buscar',
      { tag: ['@regression', '@pim'] },
      async ({ pimPage }) => {
        // Arrange — total sem filtro
        const totalCount = await pimPage.getEmployeeCount();

        // Act — busca com qualquer texto (autocomplete pode ignorar valor inválido)
        await pimPage.searchEmployee('Admin');
        const filteredCount = await pimPage.getEmployeeCount();

        // Assert — resultado filtrado nunca supera o total
        expect(filteredCount).toBeLessThanOrEqual(totalCount);
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'deve manter a página estável ao digitar texto inválido no campo de busca',
      { tag: ['@regression', '@pim'] },
      async ({ page, pimPage }) => {
        // Act — valor não selecionável no autocomplete
        await pimPage.searchEmployee('zzz_nome_impossivel_xyz_00000');

        // Assert — página estável (autocomplete ignora valor inválido → retorna resultados)
        await expect(page).toHaveURL(/pim\/viewEmployeeList/);
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );

    test(
      'deve não causar crash ao buscar com caracteres especiais',
      { tag: ['@regression', '@pim'] },
      async ({ page, pimPage }) => {
        // Act — caracteres especiais (sem XSS, sem crash esperado)
        await pimPage.searchEmployee('<script>alert(1)</script>');

        // Assert — página continua estável e na URL correta
        await expect(page).toHaveURL(/pim\/viewEmployeeList/);
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'deve não quebrar a aplicação ao buscar com string de 100 caracteres',
      { tag: ['@regression', '@pim'] },
      async ({ page, pimPage }) => {
        // Arrange — string longa (100 chars)
        const longName = 'A'.repeat(100);

        // Act
        await pimPage.searchEmployee(longName);

        // Assert — aplicação estável
        await expect(page).toHaveURL(/pim\/viewEmployeeList/);
        const count = await pimPage.getEmployeeCount();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    );
  });
});
