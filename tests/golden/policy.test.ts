import { describe, it, expect } from "vitest";
import { applyScope, canSeeTotal, type Scope } from "@ledgerlens/policy";

const rows = [
  { tenant_id: "t1", entity_id: "e1", department: "sales", v: 1 },
  { tenant_id: "t1", entity_id: "e1", department: "ops", v: 2 },
  { tenant_id: "t2", entity_id: "e1", department: "sales", v: 3 },
];
const mgr: Scope = { tenant_id: "t1", role: "department_manager", entity_ids: ["e1"], department_ids: ["sales"] };
const cfo: Scope = { tenant_id: "t1", role: "cfo", entity_ids: ["e1"], department_ids: "*" };

describe("policy", () => {
  it("never returns other tenants", () => { expect(applyScope(rows, cfo).map((r) => r.v)).toEqual([1, 2]); });
  it("manager sees only entitled departments", () => { expect(applyScope(rows, mgr).map((r) => r.v)).toEqual([1]); });
  it("restricted viewer cannot see a consolidated total that includes hidden rows", () => {
    expect(canSeeTotal(mgr, ["sales", "ops"])).toBe(false);
    expect(canSeeTotal(cfo, ["sales", "ops"])).toBe(true);
    expect(canSeeTotal(mgr, ["sales"])).toBe(true);
  });
  it("empty scope denies by default", () => {
    expect(applyScope(rows, { tenant_id: "t1", role: "department_manager", entity_ids: [], department_ids: [] })).toEqual([]);
  });
});
