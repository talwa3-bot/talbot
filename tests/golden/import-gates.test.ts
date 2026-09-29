import { describe, it, expect } from "vitest";
import fx from "./fixtures/jan2026.json";
import { validateActuals } from "@ledgerlens/adapters";

const base = { accounts: Object.keys(fx.accounts), expectedPeriods: ["2026-01"], currency: "USD" };
const row = (o: object) => ({ source_row_id: "x", period: "2026-01", department: "sales", account: "6000", amount_minor: 100, currency: "USD", ...o });

describe("import gates (negative fixtures)", () => {
  it("clean batch with matching control total passes", () => {
    const r = validateActuals([row({ source_row_id: "1" }), row({ source_row_id: "2", amount_minor: 50 })], { ...base, controlTotalMinor: 150n });
    expect(r.ok).toBe(true);
  });
  it("duplicate source_row_id is rejected", () => {
    const r = validateActuals([row({ source_row_id: "1" }), row({ source_row_id: "1" })], base);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("DUPLICATE_ROW");
  });
  it("unknown account is quarantined and blocks publication", () => {
    const r = validateActuals([row({ source_row_id: "1", account: "9999" })], base);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("UNKNOWN_ACCOUNT");
    expect(r.quarantined).toHaveLength(1);
  });
  it("missing expected period is reported", () => {
    const r = validateActuals([row({ source_row_id: "1" })], { ...base, expectedPeriods: ["2026-01", "2026-02"] });
    expect(r.errors.map((e) => e.code)).toContain("MISSING_PERIOD");
  });
  it("control total mismatch blocks publication", () => {
    const r = validateActuals([row({ source_row_id: "1" })], { ...base, controlTotalMinor: 999n });
    expect(r.errors.map((e) => e.code)).toContain("CONTROL_TOTAL_MISMATCH");
  });
  it("invalid currency and non-integer amounts are rejected", () => {
    const r = validateActuals([row({ source_row_id: "1", currency: "usd1" }), row({ source_row_id: "2", amount_minor: 1.5 })], base);
    expect(r.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["INVALID_CURRENCY", "INVALID_AMOUNT"]));
  });
});
