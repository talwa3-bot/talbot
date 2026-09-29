import { createHash } from "node:crypto";
import { LedgerError, variance, formatPct, direction, type AccountType, type Direction } from "@ledgerlens/domain";
import { applyScope, canSeeTotal, type Scope } from "@ledgerlens/policy";

/** Allowlists. The model may propose an AST; only these values are ever executed. */
export const METRICS: Record<string, { account_type: AccountType }> = {
  opex: { account_type: "expense" },
  revenue: { account_type: "revenue" },
};
export const DIMENSIONS = ["department", "account", "period", "entity_id"] as const;
type Dimension = (typeof DIMENSIONS)[number];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_ROWS = 100_000;

export interface QueryAst {
  metric: string;
  aggregation: "sum";
  period?: { from: string; to: string };
  entity_ids: string[];
  group_by?: Dimension[];
  compare_to?: { kind: "budget" | "forecast"; version_id: string };
  filters?: { department_ids?: string[] };
}

export interface FactLine {
  source_row_id: string; tenant_id: string; entity_id: string; period: string;
  department: string; account: string; amount_minor: bigint; currency: string;
}

export interface Dataset {
  currency: string;
  snapshot_id: string;
  plan_version_id: string;
  mapping_version: string;
  as_of: string;
  reconciled: boolean;
  /** Periods the actuals snapshot covers; a query outside them is incomplete. */
  periods?: string[];
  accounts: Record<string, { type: AccountType }>;
  actual: FactLine[];
  plan: FactLine[];
}

export interface QueryResult {
  result_id: string;
  metric_id: string;
  group: Record<string, string>;
  actual_minor: bigint;
  plan_minor: bigint;
  variance_minor: bigint;
  variance_pct: string; // "n/a" when plan is 0
  direction: Direction;
  currency: string;
  period_start: string;
  period_end: string;
  entity_ids: string[];
  source_snapshot_ids: string[];
  plan_version_id: string;
  mapping_version: string;
  formula_id: string;
  as_of: string;
  reconciliation_state: "reconciled";
  /** Source rows behind this number. Only rows the caller may see. */
  lineage: { actual_row_ids: string[]; plan_row_ids: string[] };
}

export function validateAst(ast: QueryAst): void {
  if (!METRICS[ast.metric]) throw new LedgerError("UNSUPPORTED_QUERY", `Unknown metric ${ast.metric}`);
  if (ast.aggregation !== "sum") throw new LedgerError("UNSUPPORTED_QUERY", "Only sum is supported");
  if (!ast.period) throw new LedgerError("AMBIGUOUS_PERIOD", "Period is required; ask the user which period");
  const { from, to } = ast.period;
  if (!PERIOD.test(from) || !PERIOD.test(to) || from > to) throw new LedgerError("AMBIGUOUS_PERIOD", `Invalid period ${from}..${to}`);
  if (!ast.entity_ids?.length) throw new LedgerError("UNSUPPORTED_QUERY", "entity_ids is required");
  for (const g of ast.group_by ?? []) if (!(DIMENSIONS as readonly string[]).includes(g)) throw new LedgerError("UNSUPPORTED_QUERY", `Unknown dimension ${g}`);
  if (!ast.compare_to) throw new LedgerError("UNSUPPORTED_QUERY", "compare_to is required for variance queries");
}

export function astHash(ast: QueryAst): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canon(ast))).digest("hex");
}

export function runQuery(ast: QueryAst, ds: Dataset, scope: Scope): { total: QueryResult | null; rows: QueryResult[] } {
  validateAst(ast);
  if (!ds.reconciled) throw new LedgerError("UNRECONCILED_SOURCE", "Snapshot is not reconciled");
  if (ds.plan_version_id !== ast.compare_to!.version_id) throw new LedgerError("STALE_SNAPSHOT", "Requested plan version is not the loaded one");

  const type = METRICS[ast.metric]!.account_type;
  const { from, to } = ast.period!;
  if (ds.periods) {
    for (let m = from; m <= to; m = nextMonth(m)) {
      if (!ds.periods.includes(m)) throw new LedgerError("INCOMPLETE_DATA", `No published actuals for ${m}`);
    }
  }
  const pick = (rows: FactLine[]) => rows.filter((r) =>
    ds.accounts[r.account]?.type === type && r.period >= from && r.period <= to &&
    ast.entity_ids.includes(r.entity_id) &&
    (!ast.filters?.department_ids || ast.filters.department_ids.includes(r.department)));

  const all = [...pick(ds.actual), ...pick(ds.plan)];
  if (all.length > MAX_ROWS) throw new LedgerError("UNSUPPORTED_QUERY", "Query exceeds row limit");
  if (all.some((r) => r.currency !== ds.currency)) throw new LedgerError("MIXED_CURRENCY", "Mixed currencies need an approved FX policy");

  // Tenant-wide departments in scope of the question (before per-user scoping).
  const covered = [...new Set(all.filter((r) => r.tenant_id === scope.tenant_id).map((r) => r.department))];
  const seesAll = canSeeTotal(scope, covered);

  const actual = applyScope(pick(ds.actual), scope);
  const plan = applyScope(pick(ds.plan), scope);
  const dims = ast.group_by ?? [];
  const key = (r: FactLine) => Object.fromEntries(dims.map((d) => [d, String(r[d])]));
  const keyStr = (r: FactLine) => JSON.stringify(key(r));

  const buckets = new Map<string, { group: Record<string, string>; a: FactLine[]; p: FactLine[] }>();
  const slot = (r: FactLine) => {
    const k = keyStr(r);
    if (!buckets.has(k)) buckets.set(k, { group: key(r), a: [], p: [] });
    return buckets.get(k)!;
  };
  actual.forEach((r) => slot(r).a.push(r));
  plan.forEach((r) => slot(r).p.push(r));

  const hash = astHash(ast);
  const build = (group: Record<string, string>, a: FactLine[], p: FactLine[]): QueryResult => {
    const sum = (xs: FactLine[]) => xs.reduce((s, r) => s + r.amount_minor, 0n);
    const v = variance(sum(a), sum(p));
    const t = ds.accounts;
    const types = new Set([...a, ...p].map((r) => t[r.account]?.type));
    return {
      result_id: "res_" + createHash("sha256").update(hash + ds.snapshot_id + JSON.stringify(group)).digest("hex").slice(0, 16),
      metric_id: ast.metric, group, actual_minor: v.actual_minor, plan_minor: v.plan_minor,
      variance_minor: v.variance_minor, variance_pct: formatPct(v.variance_pct),
      direction: direction(v.variance_minor, types.size === 1 ? [...types][0] : undefined),
      currency: ds.currency, period_start: from, period_end: to, entity_ids: ast.entity_ids,
      source_snapshot_ids: [ds.snapshot_id], plan_version_id: ds.plan_version_id,
      mapping_version: ds.mapping_version, formula_id: "variance.v1", as_of: ds.as_of,
      reconciliation_state: "reconciled",
      lineage: { actual_row_ids: a.map((r) => r.source_row_id), plan_row_ids: p.map((r) => r.source_row_id) },
    };
  };

  const rows = [...buckets.values()].sort((x, y) => JSON.stringify(x.group).localeCompare(JSON.stringify(y.group))).map((b) => build(b.group, b.a, b.p));
  // A total that would include hidden departments is withheld: it would let the viewer infer them.
  const total = seesAll ? build({}, actual, plan) : null;
  return { total, rows };
}

export function nextMonth(p: string): string {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
