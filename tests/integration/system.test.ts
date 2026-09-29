import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Db } from "@ledgerlens/db";
import { LedgerLens, type Principal } from "@ledgerlens/core";
import { ask, type ModelGateway } from "@ledgerlens/agent";
import { LedgerError } from "@ledgerlens/domain";
import { seed } from "../../scripts/seed.js";

const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://ledger_owner:owner_dev@localhost/ledgerlens";
const APP = process.env.DATABASE_URL ?? "postgres://ledger_app:ledger_app_dev@localhost/ledgerlens";
let db: Db, svc: LedgerLens, own: pg.Pool;
const P: Record<string, Principal> = {};
const code = async (f: () => Promise<unknown>) => { try { await f(); return "none"; } catch (e) { return (e as LedgerError).code ?? (e as Error).message; } };
const Q1 = { metric: "opex", aggregation: "sum" as const, period: { from: "2026-01", to: "2026-03" }, entity_ids: ["ent_demo"], group_by: ["department" as const], compare_to: { kind: "budget" as const, version_id: "" } };

beforeAll(async () => {
  await seed(ADMIN, APP);
  db = Db.connect(APP); svc = new LedgerLens(db); own = new pg.Pool({ connectionString: ADMIN });
  for (const s of ["cfo", "controller", "fpa", "accountant", "mgr-sales", "admin", "other-cfo"]) P[s] = await svc.principalFor(s);
});
afterAll(async () => { await db.close(); await own.end(); });

describe("golden SQL oracle vs API", () => {
  it("Q1 opex totals equal an independent SQL computation", async () => {
    const sql = (await own.query(`
      SELECT (SELECT sum(amount_minor) FROM ledger_lines l JOIN accounts a ON a.code=l.account AND a.tenant_id=l.tenant_id WHERE a.type='expense' AND period BETWEEN '2026-01' AND '2026-03') AS actual,
             (SELECT sum(amount_minor) FROM plan_lines l JOIN accounts a ON a.code=l.account AND a.tenant_id=l.tenant_id WHERE a.type='expense' AND period BETWEEN '2026-01' AND '2026-03') AS plan`)).rows[0];
    const r = await svc.query(P.cfo!, Q1);
    expect(r.total!.actual_minor).toBe(BigInt(sql.actual));
    expect(r.total!.plan_minor).toBe(BigInt(sql.plan));
    expect(r.total!.variance_minor).toBe(310000n);
    expect(r.total!.variance_pct).toBe("5.74");
    expect(r.rows.reduce((s, x) => s + x.variance_minor, 0n)).toBe(r.total!.variance_minor);
  });
  it("Jan oracle from the spec reproduces through the database", async () => {
    const r = await svc.query(P.cfo!, { ...Q1, period: { from: "2026-01", to: "2026-01" } });
    expect(r.total!.variance_minor).toBe(150000n);
    expect(r.total!.variance_pct).toBe("8.33");
  });
  it("a month with no published actuals is refused, not guessed", async () => {
    expect(await code(() => svc.query(P.cfo!, { ...Q1, period: { from: "2026-04", to: "2026-04" } }))).toBe("INCOMPLETE_DATA");
  });
});

describe("tenant isolation and RBAC", () => {
  it("RLS: app role sees nothing without a tenant, and nothing of another tenant", async () => {
    const c = new pg.Pool({ connectionString: APP });
    expect((await c.query("SELECT count(*) FROM ledger_lines")).rows[0].count).toBe("0");
    await c.end();
    expect(await code(() => svc.query(P["other-cfo"]!, Q1))).toBe("INCOMPLETE_DATA");
  });
  it("app role cannot rewrite audit or ledger history", async () => {
    const c = new pg.Pool({ connectionString: APP });
    expect(await code(() => c.query("UPDATE audit_events SET result='x'"))).toMatch(/42501|permission denied/);
    expect(await code(() => c.query("DELETE FROM ledger_lines"))).toMatch(/42501|permission denied|append-only/);
    await c.end();
  });
  it("manager sees own department, no total, and evidence of other results is refused and audited", async () => {
    const m = await svc.query(P["mgr-sales"]!, Q1);
    expect(m.rows.map((r) => r.group.department)).toEqual(["sales"]);
    expect(m.total).toBeNull();
    const cfo = await svc.query(P.cfo!, Q1);
    expect(await code(() => svc.evidence(P["mgr-sales"]!, cfo.total!.result_id))).toBe("UNAUTHORIZED_SCOPE");
    expect(await code(() => svc.query(P["mgr-sales"]!, { ...Q1, filters: { department_ids: ["ops"] } }))).toBe("UNAUTHORIZED_SCOPE");
    const denied = await svc.auditTrail(P.admin!);
    expect(denied.some((e) => e.policy_decision === "deny" && e.action === "evidence")).toBe(true);
  });
  it("evidence returns the exact source rows for authorized users", async () => {
    const r = await svc.query(P.cfo!, { ...Q1, period: { from: "2026-01", to: "2026-01" } });
    const sales = r.rows.find((x) => x.group.department === "sales")!;
    const ev = await svc.evidence(P.cfo!, sales.result_id);
    expect(ev.actual_rows.map((x) => x.source_row_id)).toEqual(["A-0001"]);
    expect(ev.actual_rows[0]!.amount).toBe("12000.00");
  });
  it("roles are enforced: accountant cannot query, manager cannot publish", async () => {
    expect(await code(() => svc.query(P.accountant!, Q1))).toBe("UNAUTHORIZED_SCOPE");
    expect(await code(() => svc.publishImport(P["mgr-sales"]!, "x"))).toBe("UNAUTHORIZED_SCOPE");
  });
});

describe("imports", () => {
  it("bad file fails, cannot publish, and keeps the current snapshot", async () => {
    const before = (await svc.dimensions(P.cfo!)).current_snapshot!.snapshot_id;
    const bad = await svc.createImport(P.admin!, { kind: "actual", filename: "bad.csv", control_total: "1.00",
      content: "source_row_id,period,entity_id,department,account,amount,currency\n1,2026-01,ent_demo,sales,9999,5.00,USD\n1,2026-01,ent_demo,sales,6000,5.00,USD\n" });
    expect(bad.status).toBe("failed");
    const codes = ("errors" in bad ? bad.errors : []).map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["UNKNOWN_ACCOUNT", "DUPLICATE_ROW", "CONTROL_TOTAL_MISMATCH"]));
    expect(await code(() => svc.publishImport(P.admin!, (bad as { import_id: string }).import_id))).toBe("UNRECONCILED_SOURCE");
    expect((await svc.dimensions(P.cfo!)).current_snapshot!.snapshot_id).toBe(before);
  });
  it("Hebrew headers are mapped; missing columns ask for a mapping", async () => {
    const r = await svc.createImport(P.admin!, { kind: "actual", filename: "x.csv", control_total: "1", content: "foo,bar\n1,2\n" });
    expect(r.status).toBe("needs_mapping");
  });
});

describe("variance agent", () => {
  it("Hebrew and English questions give the same AST and numbers", async () => {
    const he = await ask(svc, P.cfo!, "מה החריגה בהוצאות התפעול ברבעון הראשון?", "he-IL");
    const en = await ask(svc, P.cfo!, "What is the Q1 operating-expense variance?", "en-US");
    expect(he.status).toBe("answer");
    expect(he.ast).toEqual(en.ast);
    expect(he.total!.variance).toBe("3100.00");
    expect(he.total!.result_id).toBe(en.total!.result_id);
    expect(he.table!.map((r) => r.variance)).toEqual(en.table!.map((r) => r.variance));
  });
  it("relative period asks a clarifying question", async () => {
    expect((await ask(svc, P.cfo!, "What was the opex variance last quarter?", "en-US")).status).toBe("clarify");
    expect((await ask(svc, P.cfo!, "מה הסטייה בהוצאות ברבעון הקודם?", "he-IL")).status).toBe("clarify");
  });
  it("a model that fabricates a number or a citation is rejected", async () => {
    const liar: ModelGateway = { name: "liar", narrate: async (i) => JSON.stringify({ sentences: [{ text: "Variance was 999999.00", cites: [i.results[0]!.result_id] }] }) };
    const fake: ModelGateway = { name: "fake", narrate: async () => JSON.stringify({ sentences: [{ text: "All good.", cites: ["res_fake"] }] }) };
    const causal: ModelGateway = { name: "causal", narrate: async (i) => JSON.stringify({ sentences: [{ text: `Spend rose because of hiring, ${i.results[0]!.variance}`, cites: [i.results[0]!.result_id] }] }) };
    for (const m of [liar, fake, causal]) {
      const a = await ask(svc, P.cfo!, "Q1 2026 opex variance", "en-US", m);
      expect(a.narrative_source).toBe("template");
      expect(a.model_rejected!.length).toBeGreaterThan(0);
      expect(JSON.stringify(a.narrative)).not.toContain("999999");
    }
  });
  it("prompt injection in a note cannot put its number into the answer", async () => {
    const a = await ask(svc, P.cfo!, "January 2026 opex variance", "en-US");
    expect(JSON.stringify(a.narrative)).not.toContain("999999");
  });
  it("restricted manager gets no total and no other department in the answer", async () => {
    const a = await ask(svc, P["mgr-sales"]!, "What is the Q1 operating-expense variance?", "en-US");
    expect(a.total).toBeNull();
    expect(a.table!.map((r) => r.key)).toEqual(["sales"]);
    expect(JSON.stringify(a)).not.toMatch(/"ops"|Operations/);
  });
});

describe("close", () => {
  it("blocked close cannot be marked ready; only controller declares; approval binds exact hash; correction invalidates", async () => {
    expect(await code(() => svc.declareReady(P.controller!, "2026-01"))).toBe("INVALID_STATE");
    const list = await svc.listCloseTasks(P.controller!, "2026-01");
    const mine = list.tasks.filter((t) => t.owner === P.accountant!.user_id);
    const notMine = list.tasks.find((t) => t.owner !== P.accountant!.user_id)!;
    expect(await code(() => svc.updateTask(P.accountant!, notMine.task_id, { status: "done" }))).toBe("UNAUTHORIZED_SCOPE");
    for (const t of mine) await svc.updateTask(P.accountant!, t.task_id, { status: "done", evidence_ref: `doc://${t.title}` });
    await svc.updateTask(P.controller!, notMine.task_id, { status: "done" });
    expect(await code(() => svc.declareReady(P.controller!, "2026-01"))).toBe("INVALID_STATE"); // evidence missing
    await svc.updateTask(P.controller!, notMine.task_id, { evidence_ref: "doc://payroll" });
    expect(await code(() => svc.declareReady(P.cfo!, "2026-01"))).toBe("UNAUTHORIZED_SCOPE");
    expect((await svc.declareReady(P.controller!, "2026-01")).state).toBe("ready");
    const d = await svc.draftSummary(P.controller!, "2026-01");
    expect(d.content.total!.variance).toBe("1500.00");
    expect(await code(() => svc.requestApproval(P.controller!, d.summary_id, "slack:#finance", "k-slack-1"))).toBe("VALIDATION_FAILED");
    const req = await svc.requestApproval(P.controller!, d.summary_id, "export", "k-appr-1");
    expect(await code(() => svc.approve(P.controller!, req.approval_id, d.content_hash))).toBe("UNAUTHORIZED_SCOPE"); // self-approval
    expect(await code(() => svc.approve(P.cfo!, req.approval_id, "0".repeat(64)))).toBe("INVALID_STATE");
    expect((await svc.approve(P.cfo!, req.approval_id, d.content_hash)).status).toBe("approved");
    await svc.updateTask(P.controller!, notMine.task_id, { evidence_ref: "doc://payroll-v2" }); // late correction
    const after = await svc.approvals(P.controller!, "2026-01");
    expect(after[0].status).toBe("invalidated");
    expect((await svc.listCloseTasks(P.controller!, "2026-01")).state).toBe("open");
  });
});

describe("scenarios", () => {
  it("deterministic levers on future months; history rejected; actuals untouched", async () => {
    const before = await svc.query(P.cfo!, Q1);
    expect(await code(() => svc.createScenario(P.fpa!, { name: "bad", levers: [{ kind: "pct", department: "sales", from_period: "2026-02", value: "5" }] }))).toBe("VALIDATION_FAILED");
    expect(await code(() => svc.createScenario(P.fpa!, { name: "big", levers: [{ kind: "pct", department: "sales", from_period: "2026-04", value: "500" }] }))).toBe("VALIDATION_FAILED");
    const s = await svc.createScenario(P.fpa!, { name: "Q2 +5% sales, one-off", levers: [
      { kind: "pct", department: "sales", from_period: "2026-04", value: "5" }, { kind: "amount", department: "ops", from_period: "2026-05", value: "20000" }] });
    const r = await svc.calculateScenario(P.fpa!, s.scenario_id);
    expect(r.hypothetical).toBe(true);
    expect(r.months.find((m) => m.period === "2026-04")!.delta).toBe("500.00");
    expect(r.months.find((m) => m.period === "2026-05")!.delta).toBe("20500.00");
    expect(r.totals.delta).toBe("21500.00");
    expect((await svc.query(P.cfo!, Q1)).total!.actual_minor).toBe(before.total!.actual_minor);
    expect(await code(() => svc.calculateScenario(P.cfo!, s.scenario_id))).toBe("UNAUTHORIZED_SCOPE"); // private
  });
  it("manager scenarios cannot touch or reveal other departments", async () => {
    expect(await code(() => svc.createScenario(P["mgr-sales"]!, { name: "x", levers: [{ kind: "pct", department: "ops", from_period: "2026-04", value: "5" }] }))).toBe("UNAUTHORIZED_SCOPE");
    const s = await svc.createScenario(P["mgr-sales"]!, { name: "mine", levers: [{ kind: "pct", department: "sales", from_period: "2026-04", value: "10" }] });
    const r = await svc.calculateScenario(P["mgr-sales"]!, s.scenario_id);
    expect(r.months.find((m) => m.period === "2026-04")!.baseline).toBe("10000.00"); // sales only, ops hidden
  });
});
