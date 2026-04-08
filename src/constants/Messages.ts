/**
 * Messages.ts — Enums for UI messages used in assertions.
 * Centralises all test assertion strings to avoid magic values.
 */
export enum ErrorMessage {
  INVALID_CREDENTIALS = 'Invalid credentials',
  REQUIRED_FIELD = 'Required',
  PASSWORD_MISMATCH = 'Passwords do not match',
  DUPLICATE_EMPLOYEE_ID = 'Employee Id already exists',
}

export enum SuccessMessage {
  EMPLOYEE_SAVED = 'Successfully Saved',
  EMPLOYEE_UPDATED = 'Successfully Updated',
  EMPLOYEE_DELETED = 'Successfully Deleted',
}

export enum ToastType {
  SUCCESS = 'success',
  ERROR = 'error',
  WARNING = 'warn',
}

export enum PageTitle {
  ADMIN = 'User Management',
  LEAVE_LIST = 'Leave List',
  DASHBOARD = 'Dashboard',
}

export enum TableAction {
  EDIT = 'Edit',
  DELETE = 'Delete',
  VIEW = 'View',
}

export enum DashboardWidget {
  TIME_AT_WORK = 'timeAtWork',
  MY_ACTIONS = 'myActions',
  QUICK_LAUNCH = 'quickLaunch',
}
