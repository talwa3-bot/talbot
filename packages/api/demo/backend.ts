// In-browser demo backend for the static site. Same deterministic packages as the server
// (query, policy, import gates, intent parser, citation validator); state lives in memory
// and resets on reload. Synthetic data only.
import { parse } from "csv-parse/sync";
import { LedgerError, Decimal } from "../../domain/src/index.js";
import { applyScope, canSeeTotal, type Scope, type Role } from "../../policy/src/index.js";
import { runQuery, astHash, type QueryAst, type FactLine, type Dataset } from "../../query/src/index.js";
import { validateActuals } from "../../adapters/src/validate.js";
import { suggestMapping, applyMapping, type CanonicalField } from "../../adapters/src/mapping.js";
import { parseAmountMinor } from "../../adapters/src/amount.js";
import { actualsTemplateCsv, planTemplateCsv, csvSafeCell } from "../../adapters/src/templates.js";
import { ask } from "../../agent/src/ask.js";
import { minorToMajor, ser, canonical, sha256 } from "../../core/src/util.js";
import ACTUALS from "../../db/fixtures/demo-actuals.csv";
import BUDGET from "../../db/fixtures/demo-budget.csv";

type P = { user_id: string; tenant_id: string; locale: "he-IL" | "en-US"; scope: Scope };
const T = "demo";
const USERS: Record<string, { role: Role; depts: string[] | "*"; locale: "he-IL" | "en-US" }> = {
  cfo: { role: "cfo", depts: "*", locale: "he-IL" }, controller: { role: "controller", depts: "*", locale: "he-IL" },
  fpa: { role: "fpa", depts: "*", locale: "en-US" }, accountant: { role: "accountant", depts: [], locale: "he-IL" },
  "mgr-sales": { role: "department_manager", depts: ["sales"], locale: "he-IL" }, admin: { role: "admin", depts: [], locale: "en-US" },
};
const principal = (u: string): P => {
  const x = USERS[u]; if (!x) throw new LedgerError("UNAUTHENTICATED", "Sign in required");
  return { user_id: u, tenant_id: T, locale: x.locale, scope: { tenant_id: T, role: x.role, entity_ids: ["ent_demo"], department_ids: x.depts } };
};
const ACCOUNTS: Record<string, { type: "expense" | "revenue" }> = { "4000": { type: "revenue" }, "6000": { type: "expense" }, "6100": { type: "expense" }, "6200": { type: "expense" } };
const DEPTS = [{ code: "sales", label_he: "מכירות", label_en: "Sales" }, { code: "ops", label_he: "אופרציה", label_en: "Operations" }];
const ANALYSTS: Role[] = ["cfo", "fpa", "controller", "department_manager"];
const REQUIRED: CanonicalField[] = ["source_row_id", "period", "entity_id", "department", "account", "amount", "currency"];
const uuid = () => crypto.randomUUID();

// ---------------- state ----------------
const S = {
  snapshots: [] as Array<{ snapshot_id: string; periods: string[]; imported_at: string; lines: FactLine[] }>,
  plans: [] as Array<{ plan_version_id: string; name: string; approved_at: string; base_currency: string; lines: FactLine[] }>,
  imports: new Map<string, any>(),
  results: new Map<string, any>(),
  closes: new Map<string, { close_id: string; period: string; state: "open" | "ready" | "approved"; snapshot_id: string | null; tasks: any[] }>(),
  summaries: new Map<string, any>(),
  approvals: new Map<string, any>(),
  scenarios: new Map<string, any>(),
  notes: [{ note_id: uuid(), period: "2026-01", department: "sales", body: "Trade show in January (approved by FP&A)." }],
  audit: [] as any[],
  idem: new Map<string, unknown>(),
};
const audit = (p: P, action: string, objectIds: string[], decision: "allow" | "deny", result: string) =>
  S.audit.unshift({ event_id: S.audit.length + 1, at: new Date().toISOString(), actor: p.user_id, action, object_ids: objectIds, policy_decision: decision, result });
const deny = (p: P, action: string, msg: string, ids: string[] = []): never => { audit(p, action, ids, "deny", "UNAUTHORIZED_SCOPE"); throw new LedgerError("UNAUTHORIZED_SCOPE", msg); };
const requireRole = (p: P, action: string, roles: Role[]) => { if (!roles.includes(p.scope.role)) deny(p, action, `Role ${p.scope.role} may not ${action}`); };
const current = () => S.snapshots.at(-1);

function readCsv(text: string) {
  const rows = parse(text.replace(/^﻿/, ""), { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return { headers: rows[0] ? Object.keys(rows[0]) : [], rows };
}

// ---------------- operations (mirror packages/core/src/service.ts) ----------------
function dimensions(p: P) {
  const snap = current();
  return {
    metrics: [{ id: "opex", label_he: "הוצאות תפעול", label_en: "Operating expenses" }, { id: "revenue", label_he: "הכנסות", label_en: "Revenue" }],
    accounts: Object.entries(ACCOUNTS).map(([code, a]) => ({ code, type: a.type })),
    departments: DEPTS.filter((d) => p.scope.department_ids === "*" || p.scope.department_ids.includes(d.code)),
    entities: p.scope.entity_ids,
    plan_versions: [...S.plans].reverse().map(({ lines: _l, ...x }) => ({ ...x, type: "budget", state: "approved" })),
    current_snapshot: snap ? { snapshot_id: snap.snapshot_id, periods: snap.periods, imported_at: snap.imported_at } : null,
  };
}

function createImport(p: P, input: any) {
  requireRole(p, "create_import", ["admin"]);
  if (input.encoding === "base64") throw new LedgerError("VALIDATION_FAILED", "The online demo accepts CSV only. Excel works in the full system.");
  let table;
  try { table = readCsv(input.content); }
  catch (e) { throw new LedgerError("VALIDATION_FAILED", `The file could not be read: ${(e as Error).message}. Check that values containing commas are wrapped in quotes.`); }
  const suggested = suggestMapping(table.headers);
  const mapping = input.mapping ?? suggested.mapping;
  const missing = REQUIRED.filter((f) => !mapping[f] || !table.headers.includes(mapping[f]));
  if (missing.length) return { status: "needs_mapping", headers: table.headers, suggested: suggested.mapping, missing };
  let control: bigint;
  try { control = parseAmountMinor(String(input.control_total ?? "")); } catch { throw new LedgerError("VALIDATION_FAILED", "control_total must be a decimal amount from the source export"); }
  const rows = table.rows.map((raw) => {
    const m = applyMapping(raw, mapping); let amount: bigint | string;
    try { amount = parseAmountMinor(m.amount ?? ""); } catch { amount = `invalid:${m.amount ?? ""}`; }
    return { source_row_id: m.source_row_id, period: m.period, entity_id: m.entity_id, department: m.department, account: m.account, currency: m.currency?.toUpperCase(), amount_minor: amount };
  });
  const sha = sha256(input.content);
  for (const j of S.imports.values()) if (j.kind === input.kind && j.sha === sha) return { status: j.status, import_id: j.import_id, errors: j.errors, duplicate_of_existing_import: true };
  const periods = [...new Set(rows.map((r) => r.period).filter((x) => !!x && /^\d{4}-(0[1-9]|1[0-2])$/.test(x)) as string[])].sort();
  const v = validateActuals(rows as never, { accounts: Object.keys(ACCOUNTS), departments: DEPTS.map((d) => d.code), currency: "USD", expectedPeriods: input.expected_periods ?? periods, controlTotalMinor: control });
  const errors = [...v.errors, ...rows.filter((r) => r.entity_id !== "ent_demo").map((r) => ({ code: "UNKNOWN_ENTITY", source_row_id: r.source_row_id, message: `Entity ${r.entity_id} is not in scope` }))];
  const job = { import_id: uuid(), kind: input.kind, sha, status: errors.length ? "failed" : "passed", rows, errors, periods, plan_name: input.plan_name, filename: input.filename };
  S.imports.set(job.import_id, job);
  audit(p, "create_import", [job.import_id], "allow", job.status);
  return { status: job.status, import_id: job.import_id, row_count: rows.length, periods, errors, quarantined: v.quarantined.length, rows_total: minorToMajor(v.controlTotalMinor), control_total: minorToMajor(control) };
}

function publishImport(p: P, id: string) {
  requireRole(p, "publish_import", ["admin"]);
  const job = S.imports.get(id); if (!job) throw new LedgerError("NOT_FOUND", "Import not found");
  if (job.status === "published") return { published: true, ref: job.ref, already: true };
  if (job.status !== "passed") throw new LedgerError("UNRECONCILED_SOURCE", "Import failed validation and cannot be published");
  const lines: FactLine[] = job.rows.map((r: any) => ({ ...r, tenant_id: T, amount_minor: BigInt(r.amount_minor) }));
  const ref = uuid();
  if (job.kind === "actual") {
    S.snapshots.push({ snapshot_id: ref, periods: job.periods, imported_at: new Date().toISOString(), lines });
    for (const c of S.closes.values()) if (job.periods.includes(c.period) && c.state !== "open") {
      c.state = "open";
      for (const a of S.approvals.values()) if (S.summaries.get(a.summary_id)?.close_id === c.close_id && ["pending", "approved"].includes(a.status)) a.status = "invalidated";
    }
  } else {
    S.plans.push({ plan_version_id: ref, name: job.plan_name || job.filename, approved_at: new Date().toISOString(), base_currency: "USD", lines });
  }
  job.status = "published"; job.ref = ref;
  audit(p, "publish_import", [id, ref], "allow", "published");
  return { published: true, kind: job.kind, ref };
}

function query(p: P, astIn: QueryAst) {
  requireRole(p, "query", ANALYSTS);
  const ast: QueryAst = { ...astIn, entity_ids: astIn.entity_ids?.length ? astIn.entity_ids : p.scope.entity_ids };
  if (ast.entity_ids.some((e) => !p.scope.entity_ids.includes(e))) deny(p, "query", "Entity outside your scope");
  const f = ast.filters?.department_ids;
  if (f && p.scope.department_ids !== "*" && f.some((d) => !(p.scope.department_ids as string[]).includes(d))) deny(p, "query", "Department outside your scope");
  const snap = current(); if (!snap) throw new LedgerError("INCOMPLETE_DATA", "No published actuals snapshot");
  const plan = ast.compare_to?.version_id ? S.plans.find((x) => x.plan_version_id === ast.compare_to!.version_id) : S.plans.at(-1);
  if (!plan) throw new LedgerError("STALE_SNAPSHOT", "Requested plan version is not approved or does not exist");
  const ds: Dataset = { currency: "USD", snapshot_id: snap.snapshot_id, plan_version_id: plan.plan_version_id, mapping_version: "m1", as_of: snap.imported_at, reconciled: true, periods: snap.periods, accounts: ACCOUNTS, actual: snap.lines, plan: plan.lines };
  const full: QueryAst = { ...ast, compare_to: { kind: "budget", version_id: plan.plan_version_id } };
  const out = runQuery(full, ds, p.scope);
  for (const r of [...(out.total ? [out.total] : []), ...out.rows]) S.results.set(r.result_id, r);
  audit(p, "query", [astHash(full).slice(0, 12)], "allow", "ok");
  return { query_run_id: uuid(), ...out, plan_version_id: plan.plan_version_id, snapshot_id: snap.snapshot_id, as_of: snap.imported_at, currency: "USD", suppressed_total: out.total === null };
}

function evidence(p: P, id: string) {
  requireRole(p, "evidence", ANALYSTS);
  const r = S.results.get(id); if (!r) throw new LedgerError("NOT_FOUND", "Result not found");
  const snap = S.snapshots.find((s) => s.snapshot_id === r.source_snapshot_ids[0]); const plan = S.plans.find((x) => x.plan_version_id === r.plan_version_id);
  const a = (snap?.lines ?? []).filter((l) => r.lineage.actual_row_ids.includes(l.source_row_id));
  const b = (plan?.lines ?? []).filter((l) => r.lineage.plan_row_ids.includes(l.source_row_id));
  const all = [...a, ...b];
  if (applyScope(all, p.scope).length !== all.length || !canSeeTotal(p.scope, all.map((x) => x.department))) deny(p, "evidence", "Evidence includes rows outside your scope", [id]);
  audit(p, "evidence", [id], "allow", "ok");
  const fmt = ({ tenant_id: _t, ...x }: FactLine) => ({ ...x, amount: minorToMajor(x.amount_minor) });
  return { result: r, actual_rows: a.map(fmt), plan_rows: b.map(fmt) };
}

const closeFor = (period: string) => { const c = S.closes.get(period); if (!c) throw new LedgerError("NOT_FOUND", `No close for ${period}`); return c; };
function gates(c: { period: string; tasks: any[] }) {
  const snap = current();
  return [
    { gate: "all_tasks_done", ok: c.tasks.length > 0 && c.tasks.every((t) => t.status === "done"), detail: [] },
    { gate: "evidence_attached", ok: c.tasks.every((t) => t.status !== "done" || !!t.evidence_ref), detail: [] },
    { gate: "published_actuals_cover_period", ok: !!snap && snap.periods.includes(c.period), detail: [] },
  ];
}
function listClose(p: P, period: string) {
  requireRole(p, "list_close_tasks", ["cfo", "controller", "accountant", "fpa"]);
  const c = closeFor(period);
  return { close_id: c.close_id, period, entity_id: "ent_demo", state: c.state, snapshot_id: c.snapshot_id, tasks: c.tasks, gates: gates(c) };
}
function invalidate(c: { close_id: string }) {
  for (const a of S.approvals.values()) if (S.summaries.get(a.summary_id)?.close_id === c.close_id && ["pending", "approved"].includes(a.status)) a.status = "invalidated";
}
function updateTask(p: P, b: any) {
  requireRole(p, "update_task", ["controller", "accountant"]);
  const c = [...S.closes.values()].find((x) => x.tasks.some((t) => t.task_id === b.task_id)); if (!c) throw new LedgerError("NOT_FOUND", "Task not found");
  const t = c.tasks.find((x) => x.task_id === b.task_id);
  if (p.scope.role === "accountant" && t.owner !== p.user_id) deny(p, "update_task", "You can only update your own tasks", [b.task_id]);
  if (b.status && !["todo", "in_progress", "blocked", "done"].includes(b.status)) throw new LedgerError("VALIDATION_FAILED", "Invalid status");
  if (b.status) t.status = b.status; if (b.evidence_ref) t.evidence_ref = b.evidence_ref;
  const reopened = c.state !== "open"; if (reopened) { c.state = "open"; invalidate(c); }
  audit(p, "update_task", [b.task_id], "allow", "ok");
  return { task_id: b.task_id, reopened_close: reopened };
}
function declareReady(p: P, period: string) {
  requireRole(p, "declare_ready", ["controller"]);
  const c = closeFor(period), g = gates(c);
  if (!g.every((x) => x.ok)) throw new LedgerError("INVALID_STATE", `Close gates not met: ${g.filter((x) => !x.ok).map((x) => x.gate).join(", ")}`);
  c.state = "ready"; c.snapshot_id = current()!.snapshot_id;
  audit(p, "declare_ready", [c.close_id], "allow", "ready");
  return { close_id: c.close_id, state: "ready", snapshot_id: c.snapshot_id, gates: g };
}
function draftSummary(p: P, period: string) {
  requireRole(p, "draft_summary", ["controller", "cfo", "fpa"]);
  const c = closeFor(period); if (c.state === "open") throw new LedgerError("INVALID_STATE", "Close is not declared ready");
  const q = query(p, { metric: "opex", aggregation: "sum", period: { from: period, to: period }, entity_ids: ["ent_demo"], group_by: ["department"], compare_to: { kind: "budget", version_id: "" } });
  if (q.snapshot_id !== c.snapshot_id) throw new LedgerError("STALE_SNAPSHOT", "Actuals changed since the close was declared ready");
  const content = {
    kind: "close_summary", period, entity_id: "ent_demo", snapshot_id: q.snapshot_id, plan_version_id: q.plan_version_id, currency: q.currency,
    total: q.total && { result_id: q.total.result_id, actual: minorToMajor(q.total.actual_minor), plan: minorToMajor(q.total.plan_minor), variance: minorToMajor(q.total.variance_minor), variance_pct: q.total.variance_pct },
    rows: q.rows.map((r) => ({ result_id: r.result_id, department: r.group.department, actual: minorToMajor(r.actual_minor), plan: minorToMajor(r.plan_minor), variance: minorToMajor(r.variance_minor), variance_pct: r.variance_pct, direction: r.direction })),
    caveats: ["Draft. Not sent anywhere until approved; export only."],
  };
  const s = { summary_id: uuid(), close_id: c.close_id, snapshot_id: q.snapshot_id, content, content_hash: sha256(canonical(content)), created_at: Date.now() };
  S.summaries.set(s.summary_id, s);
  audit(p, "draft_summary", [s.summary_id], "allow", "draft");
  return { summary_id: s.summary_id, content_hash: s.content_hash, content };
}
function requestApproval(p: P, b: any) {
  requireRole(p, "request_approval", ["controller", "fpa", "cfo"]);
  if (b.destination !== "export") throw new LedgerError("VALIDATION_FAILED", "Only 'export' is supported; no Slack or email sends");
  const s = S.summaries.get(b.summary_id); if (!s) throw new LedgerError("NOT_FOUND", "Summary not found");
  const a = { approval_id: uuid(), summary_id: s.summary_id, artifact_hash: s.content_hash, destination: "export", requested_by: p.user_id, approver: null, status: "pending", expires_at: Date.now() + 7 * 864e5 };
  S.approvals.set(a.approval_id, a);
  audit(p, "request_approval", [a.approval_id], "allow", "pending");
  return { approval_id: a.approval_id, artifact_hash: a.artifact_hash, destination: "export", status: "pending" };
}
function approve(p: P, id: string, hash: string) {
  requireRole(p, "approve", ["controller", "cfo"]);
  const a = S.approvals.get(id); if (!a) throw new LedgerError("NOT_FOUND", "Approval not found");
  if (a.requested_by === p.user_id) deny(p, "approve", "Requester cannot approve their own request", [id]);
  const s = S.summaries.get(a.summary_id), c = [...S.closes.values()].find((x) => x.close_id === s.close_id)!;
  const latest = [...S.summaries.values()].filter((x) => x.close_id === c.close_id).sort((x, y) => y.created_at - x.created_at)[0];
  const problems = [a.status !== "pending" && `status is ${a.status}`, a.expires_at < Date.now() && "expired", hash !== a.artifact_hash && "artifact hash does not match request",
    latest.summary_id !== s.summary_id && "a newer summary exists", c.state !== "ready" && `close state is ${c.state}`, c.snapshot_id !== s.snapshot_id && "actuals snapshot changed"].filter(Boolean);
  if (problems.length) throw new LedgerError("INVALID_STATE", `Cannot approve: ${problems.join("; ")}`);
  a.status = "approved"; a.approver = p.user_id; c.state = "approved";
  audit(p, "approve", [id], "allow", "approved");
  return { approval_id: id, status: "approved", artifact_hash: hash, destination: "export" };
}
function approvalsFor(p: P, period: string) {
  requireRole(p, "list_approvals", ["controller", "cfo", "fpa"]);
  const c = closeFor(period);
  return [...S.approvals.values()].filter((a) => S.summaries.get(a.summary_id)?.close_id === c.close_id).reverse().map((a) => ({ ...a, content: S.summaries.get(a.summary_id).content }));
}
function createScenario(p: P, input: any) {
  requireRole(p, "create_scenario", ANALYSTS);
  if (!input.levers?.length || input.levers.length > 20) throw new LedgerError("VALIDATION_FAILED", "1-20 levers required");
  const last = current()?.periods.at(-1) ?? "0000-00";
  for (const l of input.levers) {
    if (p.scope.department_ids !== "*" && !p.scope.department_ids.includes(l.department)) deny(p, "create_scenario", "Lever department outside your scope");
    if (l.from_period <= last) throw new LedgerError("VALIDATION_FAILED", `Levers apply only after the last actual month (${last})`);
    let v: Decimal; try { v = new Decimal(l.value); } catch { throw new LedgerError("VALIDATION_FAILED", "Lever value must be a decimal"); }
    if (l.kind === "pct" && (v.lt(-100) || v.gt(100))) throw new LedgerError("VALIDATION_FAILED", "Percentage lever must be between -100 and 100");
    if (l.kind === "amount" && v.abs().gt(10_000_000)) throw new LedgerError("VALIDATION_FAILED", "Amount lever exceeds 10,000,000");
    if (l.kind === "amount") parseAmountMinor(l.value);
  }
  const s = { scenario_id: uuid(), name: input.name, owner: p.user_id, plan: S.plans.at(-1)!, snapshot_id: current()?.snapshot_id, levers: input.levers };
  S.scenarios.set(s.scenario_id, s);
  audit(p, "create_scenario", [s.scenario_id], "allow", "ok");
  return { scenario_id: s.scenario_id, hypothetical: true };
}
function calculateScenario(p: P, id: string) {
  requireRole(p, "calculate_scenario", ANALYSTS);
  const s = S.scenarios.get(id); if (!s) throw new LedgerError("NOT_FOUND", "Scenario not found");
  if (s.owner !== p.user_id) deny(p, "calculate_scenario", "Private scenario");
  const lines = applyScope(s.plan.lines.filter((l: FactLine) => ACCOUNTS[l.account]?.type === "expense"), p.scope);
  const months = new Map<string, { baseline: bigint; delta: bigint }>();
  const bump = (m: string) => months.get(m) ?? (months.set(m, { baseline: 0n, delta: 0n }), months.get(m)!);
  for (const l of lines) bump(l.period).baseline += l.amount_minor;
  for (const lv of s.levers) {
    if (lv.kind === "pct") {
      for (const l of lines) {
        if (l.department !== lv.department || (lv.account && l.account !== lv.account) || l.period < lv.from_period) continue;
        bump(l.period).delta += BigInt(new Decimal(l.amount_minor.toString()).mul(lv.value).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0));
      }
    } else bump(lv.from_period).delta += parseAmountMinor(new Decimal(lv.value).toFixed(2));
  }
  const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, baseline: minorToMajor(v.baseline), scenario: minorToMajor(v.baseline + v.delta), delta: minorToMajor(v.delta) }));
  const tb = [...months.values()].reduce((a, v) => a + v.baseline, 0n), td = [...months.values()].reduce((a, v) => a + v.delta, 0n);
  audit(p, "calculate_scenario", [id], "allow", "ok");
  return {
    scenario_id: id, name: s.name, hypothetical: true, baseline_plan_version_id: s.plan.plan_version_id, levers: s.levers, months: rows,
    totals: { baseline: minorToMajor(tb), scenario: minorToMajor(tb + td), delta: minorToMajor(td) },
    assumptions: ["Levers apply to approved budget lines of the named department from from_period onward.", "Opex accounts only. No FX conversion."],
  };
}

// The agent's ask() only needs these three service methods.
const svcFor = { dimensions: async (p: P) => dimensions(p), query: async (p: P, ast: QueryAst) => query(p, ast),
  approvedNotes: async (_p: P, periods: string[], depts: string[]) => S.notes.filter((n) => periods.includes(n.period) && depts.includes(n.department)) };

// ---------------- seed ----------------
function seed() {
  const admin = principal("admin");
  const a = createImport(admin, { kind: "actual", filename: "demo-actuals.csv", content: ACTUALS, control_total: "107100.00" }) as any;
  const b = createImport(admin, { kind: "plan", filename: "demo-budget.csv", plan_name: "Budget 2026 v1", content: BUDGET, control_total: "156000.00" }) as any;
  publishImport(admin, a.import_id); publishImport(admin, b.import_id);
  for (const period of ["2026-01", "2026-02", "2026-03"]) {
    S.closes.set(period, { close_id: uuid(), period, state: "open", snapshot_id: null, tasks: [
      { task_id: uuid(), title: "task_accruals_review", owner: "accountant", status: "todo", evidence_ref: null },
      { task_id: uuid(), title: "task_bank_reconciliation", owner: "accountant", status: "todo", evidence_ref: null },
      { task_id: uuid(), title: "task_payroll_reconciliation", owner: "controller", status: "todo", evidence_ref: null },
    ] });
  }
  S.audit.length = 0;
}
seed();

// ---------------- routing ----------------
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, UNAUTHORIZED_SCOPE: 403, NOT_FOUND: 404, INVALID_STATE: 409, UNRECONCILED_SOURCE: 409, STALE_SNAPSHOT: 409 };
type H = (p: P, b: any, m: string[]) => unknown;
const routes: Array<[string, RegExp, H, boolean?]> = [
  ["GET", /^\/me$/, (p) => ({ user_id: p.user_id, locale: p.locale, role: p.scope.role, entity_ids: p.scope.entity_ids, department_ids: p.scope.department_ids, model: "template" })],
  ["GET", /^\/dimensions$/, (p) => dimensions(p)],
  ["POST", /^\/imports$/, (p, b) => createImport(p, b), true],
  ["POST", /^\/imports\/([\w-]+)\/publish$/, (p, _b, [id]) => publishImport(p, id!), true],
  ["POST", /^\/analysis\/query$/, (p, b) => query(p, b)],
  ["POST", /^\/analysis\/ask$/, (p, b) => ask(svcFor as any, p as any, String(b.question ?? ""), b.locale === "en-US" ? "en-US" : "he-IL")],
  ["GET", /^\/analysis\/([\w-]+)\/evidence$/, (p, _b, [id]) => evidence(p, id!)],
  ["GET", /^\/close\/(\d{4}-\d{2})\/tasks$/, (p, _b, [period]) => listClose(p, period!)],
  ["POST", /^\/close\/(\d{4}-\d{2})\/tasks$/, (p, b) => updateTask(p, b), true],
  ["POST", /^\/close\/(\d{4}-\d{2})\/ready$/, (p, _b, [period]) => declareReady(p, period!), true],
  ["POST", /^\/close\/(\d{4}-\d{2})\/summary-draft$/, (p, _b, [period]) => draftSummary(p, period!), true],
  ["GET", /^\/close\/(\d{4}-\d{2})\/approvals$/, (p, _b, [period]) => approvalsFor(p, period!)],
  ["POST", /^\/approvals$/, (p, b) => requestApproval(p, b), true],
  ["POST", /^\/approvals\/([\w-]+)\/approve$/, (p, b, [id]) => approve(p, id!, b.artifact_hash), true],
  ["POST", /^\/scenarios$/, (p, b) => createScenario(p, b), true],
  ["POST", /^\/scenarios\/([\w-]+)\/calculate$/, (p, _b, [id]) => calculateScenario(p, id!)],
  ["GET", /^\/audit$/, (p) => { requireRole(p, "read_audit", ["admin", "cfo", "controller"]); return S.audit.slice(0, 200); }],
];

async function handle(url: URL, init: RequestInit): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(ser(body)), { status, headers: { "content-type": "application/json" } });
  const text = (body: string, type = "text/csv; charset=utf-8") => new Response(body, { status: 200, headers: { "content-type": type } });
  try {
    if (url.pathname.endsWith("/api/v1/demo-users")) return json(200, Object.keys(USERS));
    const tpl = /\/api\/v1\/templates\/(actuals|plan)\.csv$/.exec(url.pathname);
    if (tpl) return text(tpl[1] === "actuals" ? actualsTemplateCsv() : planTemplateCsv());
    const headers = new Headers(init.headers);
    const m = /^Bearer demo:([\w-]+)$/.exec(headers.get("authorization") ?? "");
    const p = principal(m?.[1] ?? "");
    if (url.pathname.endsWith("/export/summary.csv")) {
      const rows = approvalsFor(p, url.searchParams.get("period") ?? "").filter((a) => a.status === "approved");
      if (!rows[0]) throw new LedgerError("INVALID_STATE", "No approved summary for this period");
      const c = rows[0].content;
      const lines = [["department", "actual", "plan", "variance", "variance_pct", "result_id"], ...c.rows.map((r: any) => [r.department, r.actual, r.plan, r.variance, r.variance_pct, r.result_id])];
      return text(lines.map((l: string[]) => l.map((x) => csvSafeCell(String(x))).join(",")).join("\n"));
    }
    const sub = url.pathname.slice(url.pathname.indexOf("/api/v1") + "/api/v1".length);
    const method = (init.method ?? "GET").toUpperCase();
    const route = routes.find(([rm, re]) => rm === method && re.test(sub));
    if (!route) return json(404, { code: "NOT_FOUND", message: "No such endpoint" });
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const key = headers.get("idempotency-key");
    if (route[3]) {
      if (!key) throw new LedgerError("VALIDATION_FAILED", "Idempotency-Key header is required on writes");
      const k = `${p.user_id}:${key}`; if (S.idem.has(k)) return json(200, S.idem.get(k));
      const out = ser(await route[2](p, body, route[1].exec(sub)!.slice(1))); S.idem.set(k, out); return json(200, out);
    }
    return json(200, await route[2](p, body, route[1].exec(sub)!.slice(1)));
  } catch (e) {
    if (e instanceof LedgerError) return json(STATUS[e.code] ?? 400, { code: e.code, message: e.message });
    return json(500, { code: "INTERNAL", message: (e as Error).message });
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.includes("/api/v1/") || url.pathname.endsWith("/export/summary.csv")) return handle(url, init);
  return realFetch(input as RequestInfo, init);
};
(window as any).LEDGERLENS_DEMO = true;
