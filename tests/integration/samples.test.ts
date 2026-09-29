import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { Db } from "@ledgerlens/db";
import { LedgerLens, type Principal } from "@ledgerlens/core";
import { ask } from "@ledgerlens/agent";
import { seed } from "../../scripts/seed.js";

// Runs the downloadable sample files in samples/ through the real system.
const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://ledger_owner:owner_dev@localhost/ledgerlens";
const APP = process.env.DATABASE_URL ?? "postgres://ledger_app:ledger_app_dev@localhost/ledgerlens";
const file = (n: string) => readFileSync(`samples/${n}`, "utf8");
let db: Db, svc: LedgerLens, admin: Principal, cfo: Principal;

/** Independent oracle: sum cents straight from the CSV text, no shared code. */
function oracle(csv: string, months: string[], accounts: string[]) {
  const rows = csv.replace(/^﻿/, "").trim().split("\n").slice(1).map((l) => l.split(","));
  const cents = (s: string) => Math.round(Number(s) * 100);
  const by: Record<string, number> = {};
  for (const r of rows) if (months.includes(r[1]!) && accounts.includes(r[4]!)) by[r[3]!] = (by[r[3]!] ?? 0) + cents(r[5]!);
  return by;
}

beforeAll(async () => {
  await seed(ADMIN, APP);
  db = Db.connect(APP); svc = new LedgerLens(db);
  admin = await svc.principalFor("admin"); cfo = await svc.principalFor("cfo");
});
afterAll(() => db.close());

describe("sample files", () => {
  it("03 errors file is rejected with one reason per planted problem, and cannot be published", async () => {
    const r: any = await svc.createImport(admin, { kind: "actual", filename: "03.csv", content: file("03-actuals-with-errors.csv"), control_total: "20000.00" });
    expect(r.status).toBe("failed");
    const codes = r.errors.map((e: any) => e.code);
    for (const c of ["DUPLICATE_ROW", "UNKNOWN_ACCOUNT", "INVALID_AMOUNT", "INVALID_CURRENCY", "INVALID_PERIOD", "UNKNOWN_DEPARTMENT", "CONTROL_TOTAL_MISMATCH"]) expect(codes).toContain(c);
    await expect(svc.publishImport(admin, r.import_id)).rejects.toMatchObject({ code: "UNRECONCILED_SOURCE" });
  });

  it("04 Excel and 01 CSV carry the same data; Excel imports and publishes", async () => {
    const x: any = await svc.createImport(admin, { kind: "actual", filename: "04.xlsx", encoding: "base64", content: readFileSync("samples/04-actuals-ytd-2026.xlsx").toString("base64"), control_total: "416601.25" });
    expect(x.status).toBe("passed");
    expect(x.rows_total).toBe("416601.25");
    await svc.publishImport(admin, x.import_id);
  });

  it("01 CSV with Hebrew headers maps automatically and passes", async () => {
    const r: any = await svc.createImport(admin, { kind: "actual", filename: "01.csv", content: file("01-actuals-ytd-2026.csv"), control_total: "416601.25" });
    expect(r.status).toBe("passed");
    expect(r.periods).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    await svc.publishImport(admin, r.import_id);
  });

  it("02 budget v2 publishes and becomes the comparison version", async () => {
    const r: any = await svc.createImport(admin, { kind: "plan", filename: "02.csv", plan_name: "Budget 2026 v2", content: file("02-budget-2026-v2.csv"), control_total: "792000.00" });
    expect(r.status).toBe("passed");
    await svc.publishImport(admin, r.import_id);
    expect((await svc.dimensions(cfo)).plan_versions[0].name).toBe("Budget 2026 v2");
  });

  it("Q2 answer matches the oracle computed from the files", async () => {
    const q2 = ["2026-04", "2026-05", "2026-06"], opex = ["6000", "6100", "6200"];
    const A = oracle(file("01-actuals-ytd-2026.csv"), q2, opex), B = oracle(file("02-budget-2026-v2.csv"), q2, opex);
    const a = await ask(svc, cfo, "מה החריגה בהוצאות התפעול ברבעון השני?", "he-IL");
    expect(a.status).toBe("answer");
    for (const row of a.table!) {
      expect(Math.round(Number(row.actual) * 100)).toBe(A[row.key]);
      expect(Math.round(Number(row.plan) * 100)).toBe(B[row.key]);
    }
    const ta = Object.values(A).reduce((s, v) => s + v, 0), tb = Object.values(B).reduce((s, v) => s + v, 0);
    expect(a.total!.variance).toBe(((ta - tb) / 100).toFixed(2)); // 3001.25
    expect(a.total!.variance_pct).toBe("5.56");
  });

  it("an account with no budget shows the amount and 'n/a' percent", async () => {
    const r = await svc.query(cfo, { metric: "opex", aggregation: "sum", period: { from: "2026-05", to: "2026-05" }, entity_ids: [], group_by: ["account"], compare_to: { kind: "budget", version_id: "" } });
    const other = r.rows.find((x) => x.group.account === "6200")!;
    expect(other.actual_minor).toBe(125050n);
    expect(other.variance_pct).toBe("n/a");
  });
});
