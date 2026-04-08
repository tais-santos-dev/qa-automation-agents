/**
 * add-employee.spec.ts
 *
 * Suite de testes para o fluxo de criação de funcionário no módulo PIM.
 *
 * Estratégia:
 *  - Usa `chromium:authenticated` (sessão pré-autenticada via storageState).
 *  - A fixture `addEmployeePage` abre /pim/addEmployee automaticamente.
 *  - Usa EmployeeFactory para gerar dados únicos por execução, evitando
 *    conflitos na instância demo compartilhada.
 *
 * Cenários cobertos:
 *  ✅ [Positivo]   Criar funcionário com dados completos → toast de sucesso
 *  ✅ [Positivo]   Criar funcionário sem login details → salva apenas dados pessoais
 *  ❌ [Negativo]   Submeter formulário vazio → erros de campo obrigatório
 *  ❌ [Negativo]   Criar com senhas diferentes → erro de confirmação
 *  ⚠️  [Edge Case] Nome com comprimento máximo → campo aceita sem truncar
 */

import { test, expect } from '../../../fixtures/test.fixture';
import { EmployeeFactory } from '../../../factories/EmployeeFactory';
import { ErrorMessage, SuccessMessage } from '../../../constants/Messages';

// ─── Constantes de teste ─────────────────────────────────────────────────────

const KNOWN_PASSWORD = 'SenhaCorreta@1';

// ─── Suite Principal ──────────────────────────────────────────────────────

test.describe('PIM — Adicionar Funcionário', () => {

  test.beforeEach(async ({ addEmployeePage }) => {
    await addEmployeePage.expectOnAddEmployeePage();
  });

  // ─── Cenários Positivos ───────────────────────────────────────────────────

  test.describe('Positivo', () => {

    test(
      'deve criar funcionário com dados completos e exibir toast de sucesso',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange
        const employee = EmployeeFactory.build();

        // Act
        await addEmployeePage.createEmployee(employee, true);

        // Assert — toast de sucesso e redirecionamento para o perfil
        await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
      }
    );

    test(
      'deve criar funcionário sem login details e salvar somente dados pessoais',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange
        const employee = EmployeeFactory.build();

        // Act — createEmployee com createLogin = false
        await addEmployeePage.createEmployee(employee, false);

        // Assert
        await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
      }
    );
  });

  // ─── Cenários Negativos ───────────────────────────────────────────────────

  test.describe('Negativo', () => {

    test(
      'deve exibir erros de campo obrigatório ao submeter formulário vazio',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Act — tenta salvar sem preencher nada
        await addEmployeePage.clickSave();

        // Assert — ao menos um erro de campo obrigatório
        const firstError = await addEmployeePage.getFirstValidationError();
        expect(firstError).toContain(ErrorMessage.REQUIRED_FIELD);
      }
    );

    test(
      'deve exibir erro de confirmação ao preencher senhas diferentes',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange — dados com senha e confirmação divergentes
        const employee = EmployeeFactory.build({ password: KNOWN_PASSWORD });
        const employeeWithWrongConfirm = { ...employee, confirmPassword: 'SenhaDiferente@2' };

        // Act
        await addEmployeePage.fillPersonalDetails(employeeWithWrongConfirm);
        await addEmployeePage.fillLoginDetails(employeeWithWrongConfirm);
        await addEmployeePage.clickSave();

        // Assert — mensagem específica de senhas não coincidentes
        const error = await addEmployeePage.getFirstValidationError();
        expect(error).toContain(ErrorMessage.PASSWORD_MISMATCH);
      }
    );
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  test.describe('Edge Cases', () => {

    test(
      'deve aceitar firstName com comprimento próximo do máximo permitido',
      { tag: ['@regression', '@pim'] },
      async ({ addEmployeePage }) => {
        // Arrange — nome com 30 caracteres (próximo do limite do OrangeHRM)
        const longName = 'A'.repeat(30);
        const employee = EmployeeFactory.build({ firstName: longName });

        // Act
        await addEmployeePage.fillPersonalDetails(employee);

        // Assert — campo deve aceitar o valor sem truncar
        const value = await addEmployeePage.getFirstNameValue();
        expect(value).toBe(longName);
      }
    );
  });
});
