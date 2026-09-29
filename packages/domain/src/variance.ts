import { Decimal } from "./money.js";
import { assertMinor } from "./money.js";

export type AccountType = "expense" | "revenue";
export type Direction = "favorable" | "unfavorable" | "neutral" | "unknown";

export interface Variance {
  actual_minor: bigint;
  plan_minor: bigint;
  /** actual - plan */
  variance_minor: bigint;
  /** (actual - plan) / abs(plan) * 100, or null when plan is 0 */
  variance_pct: Decimal | null;
}

export function variance(actual: bigint, plan: bigint): Variance {
  const diff = actual - plan;
  const pct = plan === 0n ? null : new Decimal(diff.toString()).div(new Decimal(plan.toString()).abs()).mul(100);
  return { actual_minor: actual, plan_minor: plan, variance_minor: diff, variance_pct: pct };
}

export function formatPct(p: Decimal | null, places = 2): string {
  return p === null ? "n/a" : p.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN).toFixed(places);
}

/** Favorable/unfavorable depends on account type, never on sign alone. */
export function direction(diffMinor: bigint, type: AccountType | undefined): Direction {
  if (type === undefined) return "unknown";
  if (diffMinor === 0n) return "neutral";
  const over = diffMinor > 0n;
  if (type === "expense") return over ? "unfavorable" : "favorable";
  return over ? "favorable" : "unfavorable";
}

export interface Line { source_row_id: string; account: string; amount_minor: number | bigint; [k: string]: unknown }
export interface GroupRow extends Variance { key: string; direction: Direction }

export interface VarianceInput {
  actual: Line[];
  plan: Line[];
  groupBy: string;
  accounts: Record<string, { type: AccountType }>;
}

export function varianceByGroup(input: VarianceInput): { rows: GroupRow[]; total: Variance } {
  const acts = new Map<string, bigint>();
  const plans = new Map<string, bigint>();
  const types = new Map<string, Set<AccountType | undefined>>();
  const add = (m: Map<string, bigint>, l: Line) => {
    const k = String(l[input.groupBy]);
    m.set(k, (m.get(k) ?? 0n) + assertMinor(l.amount_minor));
    const s = types.get(k) ?? new Set();
    s.add(input.accounts[l.account]?.type);
    types.set(k, s);
  };
  input.actual.forEach((l) => add(acts, l));
  input.plan.forEach((l) => add(plans, l));

  const keys = [...new Set([...acts.keys(), ...plans.keys()])].sort();
  const rows: GroupRow[] = keys.map((key) => {
    const v = variance(acts.get(key) ?? 0n, plans.get(key) ?? 0n);
    const ts = types.get(key)!;
    // A group mixing account types (or with an unmapped one) has no single sign meaning.
    const t = ts.size === 1 ? [...ts][0] : undefined;
    return { key, ...v, direction: direction(v.variance_minor, t) };
  });
  const totalActual = rows.reduce((s, r) => s + r.actual_minor, 0n);
  const totalPlan = rows.reduce((s, r) => s + r.plan_minor, 0n);
  return { rows, total: variance(totalActual, totalPlan) };
}
