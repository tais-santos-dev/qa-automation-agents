/**
 * Routes.ts — Enum of all application URL paths.
 * Usage: await page.goto(AppRoute.PIM_LIST)
 */
export enum AppRoute {
  LOGIN = '/web/index.php/auth/login',
  DASHBOARD = '/web/index.php/dashboard/index',
  PIM_LIST = '/web/index.php/pim/viewEmployeeList',
  ADD_EMPLOYEE = '/web/index.php/pim/addEmployee',
  LEAVE = '/web/index.php/leave/viewLeaveList',
  RECRUITMENT = '/web/index.php/recruitment/viewCandidates',
  MY_INFO = '/web/index.php/pim/viewMyDetails',
  ADMIN = '/web/index.php/admin/viewAdminModule',
}
