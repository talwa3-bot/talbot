import { describe, it, expect } from "vitest";
import fx from "./fixtures/jan2026.json";
import { runQuery, type Dataset, type QueryAst, type FactLine } from "@ledgerlens/query";
import { LedgerError } from "@ledgerlens/domain";
import type { Scope } from "@ledgerlens/policy";

const mk = (rows: typeof fx.actual): FactLine[] =>
  rows.map((r) => ({ ...r, tenant_id: "t1", entity_id: "ent_demo", period: "2026-01", currency: "USD", amount_minor: BigInt(r.amount_minor) }));
const ds: Dataset = {
  currency: "USD", snapshot_id: "snap1", plan_version_id: "bud1", mapping_version: "m1", as_of: "2026-02-03T00:00:00Z",
  reconciled: true, accounts: fx.accounts as Dataset["accounts"], actual: mk(fx.actual), plan: mk(fx.plan),
};
const ast: QueryAst = {
  metric: "opex", aggregation: "sum", period: { from: "2026-01", to: "2026-01" }, entity_ids: ["ent_demo"],
  group_by: ["department"], compare_to: { kind: "budget", version_id: "bud1" },
};
const cfo: Scope = { tenant_id: "t1", role: "cfo", entity_ids: ["ent_demo"], department_ids: "*" };
const mgr: Scope = { tenant_id: "t1", role: "department_manager", entity_ids: ["ent_demo"], department_ids: ["sales"] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as LedgerError).code; } return "none"; };

describe("query service", () => {
  it("matches the oracle and carries lineage on every result", () => {
    const r = runQuery(ast, ds, cfo);
    expect(r.total!.variance_minor).toBe(BigInt(fx.expected.variance_minor));
    expect(r.total!.variance_pct).toBe("8.33");
    const sales = r.rows.find((x) => x.group.department === "sales")!;
    expect(sales.variance_minor).toBe(200000n);
    for (const x of [r.total!, ...r.rows]) {
      expect(x.result_id).toMatch(/^res_/);
      expect(x.lineage.actual_row_ids.length + x.lineage.plan_row_ids.length).toBeGreaterThan(0);
    }
    expect(sales.lineage.actual_row_ids).toEqual(["a1"]);
  });
  it("is deterministic: same query, same result IDs", () => {
    expect(runQuery(ast, ds, cfo).total!.result_id).toBe(runQuery(ast, ds, cfo).total!.result_id);
  });
  it("restricted manager sees own department only and no consolidated total", () => {
    const r = runQuery(ast, ds, mgr);
    expect(r.rows.map((x) => x.group.department)).toEqual(["sales"]);
    expect(r.total).toBeNull();
    expect(JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("750000");
  });
  it("manager filtered to own department gets a total", () => {
    const r = runQuery({ ...ast, filters: { department_ids: ["sales"] } }, ds, mgr);
    expect(r.total!.variance_minor).toBe(200000n);
  });
  it("rejects unknown metric and dimension (no raw SQL path)", () => {
    expect(code(() => runQuery({ ...ast, metric: "DROP TABLE" }, ds, cfo))).toBe("UNSUPPORTED_QUERY");
    expect(code(() => runQuery({ ...ast, group_by: ["password" as never] }, ds, cfo))).toBe("UNSUPPORTED_QUERY");
  });
  it("missing period asks instead of guessing", () => {
    expect(code(() => runQuery({ ...ast, period: undefined }, ds, cfo))).toBe("AMBIGUOUS_PERIOD");
  });
  it("blocks unreconciled, stale plan version, and mixed currency", () => {
    expect(code(() => runQuery(ast, { ...ds, reconciled: false }, cfo))).toBe("UNRECONCILED_SOURCE");
    expect(code(() => runQuery({ ...ast, compare_to: { kind: "budget", version_id: "old" } }, ds, cfo))).toBe("STALE_SNAPSHOT");
    expect(code(() => runQuery(ast, { ...ds, actual: [{ ...ds.actual[0]!, currency: "ILS" }, ...ds.actual.slice(1)] }, cfo))).toBe("MIXED_CURRENCY");
  });
  it("changing a source row changes the total (mutation check)", () => {
    const mutated = { ...ds, actual: [{ ...ds.actual[0]!, amount_minor: 1300000n }, ...ds.actual.slice(1)] };
    expect(runQuery(ast, mutated, cfo).total!.variance_minor).toBe(250000n);
  });
  it("other tenants' rows never leak", () => {
    const leak = { ...ds, actual: [...ds.actual, { ...ds.actual[0]!, tenant_id: "t2", source_row_id: "z9", amount_minor: 999999n }] };
    expect(runQuery(ast, leak, cfo).total!.actual_minor).toBe(1950000n);
  });
});
