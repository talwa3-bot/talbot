import { describe, it, expect } from "vitest";
import fx from "./fixtures/jan2026.json";
import { varianceByGroup, variance, formatPct } from "@ledgerlens/domain";

const acct = fx.accounts as Record<string, { type: "expense" | "revenue" }>;

describe("golden: Jan 2026 oracle", () => {
  it("totals reconcile exactly in minor units", () => {
    const r = varianceByGroup({ actual: fx.actual, plan: fx.plan, groupBy: "department", accounts: acct });
    expect(r.total.actual_minor).toBe(BigInt(fx.expected.actual_total_minor));
    expect(r.total.plan_minor).toBe(BigInt(fx.expected.plan_total_minor));
    expect(r.total.variance_minor).toBe(BigInt(fx.expected.variance_minor));
    expect(formatPct(r.total.variance_pct)).toBe(fx.expected.variance_pct_display);
    // cross-foot: visible breakdown sums to the total
    const sum = r.rows.reduce((s, x) => s + x.variance_minor, 0n);
    expect(sum).toBe(r.total.variance_minor);
  });

  it("per-department variances match oracle", () => {
    const r = varianceByGroup({ actual: fx.actual, plan: fx.plan, groupBy: "department", accounts: acct });
    for (const [dept, exp] of Object.entries(fx.expected.departments)) {
      const row = r.rows.find((x) => x.key === dept)!;
      expect(row.variance_minor).toBe(BigInt(exp.variance_minor));
      expect(formatPct(row.variance_pct)).toBe(exp.variance_pct_display);
    }
  });

  it("zero budget: absolute variance shown, percent is null (n/a)", () => {
    const v = variance(50000n, 0n);
    expect(v.variance_minor).toBe(50000n);
    expect(v.variance_pct).toBeNull();
    expect(formatPct(v.variance_pct)).toBe("n/a");
  });

  it("favorable label needs account type; sign alone is never used", () => {
    const exp = varianceByGroup({ actual: fx.actual, plan: fx.plan, groupBy: "department", accounts: acct });
    expect(exp.rows.find((x) => x.key === "sales")!.direction).toBe("unfavorable"); // expense over budget
    expect(exp.rows.find((x) => x.key === "ops")!.direction).toBe("favorable"); // expense under budget
    const noType = varianceByGroup({ actual: fx.actual, plan: fx.plan, groupBy: "department", accounts: {} });
    expect(noType.rows.every((x) => x.direction === "unknown")).toBe(true);
  });

  it("rows with actual but no plan appear (plan 0) and still cross-foot", () => {
    const extra = [...fx.actual, { source_row_id: "a3", department: "legal", account: "6200", amount_minor: 30000 }];
    const r = varianceByGroup({ actual: extra, plan: fx.plan, groupBy: "department", accounts: acct });
    const legal = r.rows.find((x) => x.key === "legal")!;
    expect(legal.plan_minor).toBe(0n);
    expect(legal.variance_pct).toBeNull();
    expect(r.rows.reduce((s, x) => s + x.variance_minor, 0n)).toBe(r.total.variance_minor);
  });
});
