export type Role = "cfo" | "fpa" | "controller" | "accountant" | "department_manager" | "admin";

export interface Scope {
  tenant_id: string;
  role: Role;
  entity_ids: string[];
  /** "*" only when explicitly granted; empty array denies everything. */
  department_ids: string[] | "*";
}

interface Scoped { tenant_id: string; entity_id: string; department: string }

/** Deny by default. Tenant always comes from the authenticated scope, never from the client. */
export function applyScope<T extends Scoped>(rows: T[], scope: Scope): T[] {
  return rows.filter(
    (r) =>
      r.tenant_id === scope.tenant_id &&
      scope.entity_ids.includes(r.entity_id) &&
      (scope.department_ids === "*" || scope.department_ids.includes(r.department)),
  );
}

/**
 * A total may be shown only if every department it covers is visible.
 * Otherwise the viewer could infer hidden departments by subtraction.
 */
export function canSeeTotal(scope: Scope, coveredDepartments: string[]): boolean {
  if (scope.department_ids === "*") return true;
  const allowed = scope.department_ids;
  return coveredDepartments.every((d) => allowed.includes(d));
}
