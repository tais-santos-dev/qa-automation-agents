/**
 * EmployeeFactory.ts
 *
 * Factory pattern for generating random, valid employee test data.
 * Uses @faker-js/faker to ensure each test run has unique data,
 * avoiding conflicts on the shared OrangeHRM demo instance.
 */
import { faker } from '@faker-js/faker';

export interface EmployeeData {
  firstName: string;
  middleName: string;
  lastName: string;
  employeeId: string;
  username: string;
  password: string;
  confirmPassword: string;
}

export interface EmployeeOverrides {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  employeeId?: string;
  username?: string;
  password?: string;
}

export class EmployeeFactory {
  /**
   * Generates a complete, randomised employee payload.
   * Optionally accepts overrides to pin specific fields (e.g., in edge-case tests).
   *
   * @example
   * const employee = EmployeeFactory.build();
   * const employeeWithFixedName = EmployeeFactory.build({ firstName: 'Alice' });
   */
  static build(overrides: EmployeeOverrides = {}): EmployeeData {
    const firstName = overrides.firstName ?? faker.person.firstName();
    const lastName = overrides.lastName ?? faker.person.lastName();
    const password = overrides.password ?? this.generateSecurePassword();

    return {
      firstName,
      middleName: overrides.middleName ?? faker.person.middleName(),
      lastName,
      employeeId: overrides.employeeId ?? this.generateEmployeeId(),
      username: overrides.username ?? this.generateUsername(firstName, lastName),
      password,
      confirmPassword: password,
    };
  }

  /**
   * Generates a batch of employee records.
   * Useful for bulk-create or parameterised test scenarios.
   */
  static buildMany(count: number, overrides: EmployeeOverrides = {}): EmployeeData[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private static generateEmployeeId(): string {
    // OrangeHRM auto-assigns IDs but allows manual entry during creation
    return faker.string.numeric(6);
  }

  private static generateUsername(firstName: string, lastName: string): string {
    const base = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
    const suffix = faker.string.numeric(3);
    // Enforce OrangeHRM constraints: 5–40 chars
    return `${base}${suffix}`.slice(0, 40);
  }

  private static generateSecurePassword(): string {
    // OrangeHRM requires: min 7 chars, uppercase, lowercase, number
    return `Auto@${faker.string.alphanumeric(5)}1`;
  }
}
