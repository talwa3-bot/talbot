import { LedgerError, Decimal, type AccountType } from "@ledgerlens/domain";
import { canSeeTotal, applyScope, type Scope, type Role } from "@ledgerlens/policy";
import { readCsv, readXlsx, suggestMapping, applyMapping, parseAmountMinor, validateActuals, type ColumnMapping, type CanonicalField } from "@ledgerlens/adapters";
import { runQuery, astHash, nextMonth, type QueryAst, type Dataset, type FactLine, type QueryResult } from "@ledgerlens/query";
import type { Db, Client } from "@ledgerlens/db";
import { ser, canonical, sha256, newCorrelationId, minorToMajor } from "./util.js";

export interface Principal { user_id: string; tenant_id: string; locale: "he-IL" | "en-US"; scope: Scope }

const REQUIRED: CanonicalField[] = ["source_row_id", "period", "entity_id", "department", "account", "amount", "currency"];
const ANALYSTS: Role[] = ["cfo", "fpa", "controller", "department_manager"];

export class LedgerLens {
  constructor(readonly db: Db) {}

  // ---------- identity ----------
  async principalFor(subject: string): Promise<Principal> {
    const u = await this.db.authLookup(subject);
    if (!u) throw new LedgerError("UNAUTHENTICATED", "Unknown or disabled user");
    return this.db.tx(u.tenant_id, async (c) => {
      const m = await c.query("SELECT role, entity_ids, department_ids FROM memberships WHERE user_id=$1 ORDER BY role LIMIT 1", [u.user_id]);
      const r = m.rows[0];
      if (!r) throw new LedgerError("UNAUTHORIZED_SCOPE", "User has no membership");
      const depts: string[] = r.department_ids;
      return {
        user_id: u.user_id, tenant_id: u.tenant_id, locale: u.locale as Principal["locale"],
        scope: { tenant_id: u.tenant_id, role: r.role, entity_ids: r.entity_ids, department_ids: depts.includes("*") ? "*" : depts },
      };
    });
  }

  // ---------- audit ----------
  private async audit(c: Client, p: Principal, action: string, objectIds: string[], decision: "allow" | "deny", result: string, cid: string, input?: unknown, output?: unknown) {
    await c.query(
      `INSERT INTO audit_events (tenant_id, actor, action, object_ids, policy_decision, input_hash, output_hash, tool_version, correlation_id, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ledgerlens/0.1',$8,$9)`,
      [p.tenant_id, p.user_id, action, objectIds, decision, input === undefined ? null : sha256(canonical(input)), output === undefined ? null : sha256(canonical(output)), cid, result],
    );
  }
  /** Denials are audited in their own transaction so the rollback of the caller does not erase them. */
  private async deny(p: Principal, action: string, message: string, objectIds: string[] = [], code: LedgerError["code"] = "UNAUTHORIZED_SCOPE"): Promise<never> {
    await this.db.tx(p.tenant_id, (c) => this.audit(c, p, action, objectIds, "deny", code, newCorrelationId()));
    throw new LedgerError(code, message);
  }
  private async requireRole(p: Principal, action: string, roles: Role[]) {
    if (!roles.includes(p.scope.role)) await this.deny(p, action, `Role ${p.scope.role} may not ${action}`);
  }

  async idempotent<T>(p: Principal, key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key || key.length < 8) throw new LedgerError("VALIDATION_FAILED", "Idempotency-Key header (8+ chars) is required on writes");
    const k = `${p.user_id}:${key}`;
    const hit = await this.db.tx(p.tenant_id, (c) => c.query("SELECT response FROM idempotency_keys WHERE key=$1", [k]));
    if (hit.rows[0]) return hit.rows[0].response as T;
    const out = await fn();
    await this.db.tx(p.tenant_id, (c) => c.query("INSERT INTO idempotency_keys (tenant_id, key, response) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.tenant_id, k, JSON.stringify(ser(out))]));
    return ser(out) as T;
  }

  // ---------- dimensions ----------
  async dimensions(p: Principal) {
    await this.requireRole(p, "list_dimensions", [...ANALYSTS, "admin", "accountant"]);
    return this.db.tx(p.tenant_id, async (c) => {
      const accounts = (await c.query("SELECT code, type, label_he, label_en FROM accounts ORDER BY code")).rows;
      const depts = (await c.query("SELECT code, label_he, label_en FROM departments ORDER BY code")).rows
        .filter((d) => p.scope.department_ids === "*" || p.scope.department_ids.includes(d.code));
      const plans = (await c.query("SELECT plan_version_id, type, name, state, base_currency FROM plan_versions WHERE state='approved' ORDER BY approved_at DESC")).rows;
      const snap = await this.currentSnapshot(c);
      return {
        metrics: [
          { id: "opex", label_he: "הוצאות תפעול", label_en: "Operating expenses" },
          { id: "revenue", label_he: "הכנסות", label_en: "Revenue" },
        ],
        accounts, departments: depts, entities: p.scope.entity_ids, plan_versions: plans,
        current_snapshot: snap ? { snapshot_id: snap.snapshot_id, periods: snap.periods, imported_at: snap.imported_at } : null,
      };
    });
  }

  private async currentSnapshot(c: Client) {
    const r = await c.query("SELECT * FROM snapshots WHERE kind='actual' AND validation_status='published' ORDER BY imported_at DESC LIMIT 1");
    return r.rows[0] as { snapshot_id: string; periods: string[]; imported_at: Date; row_count: number } | undefined;
  }
  private async baseCurrency(c: Client): Promise<string> {
    return (await c.query("SELECT base_currency FROM tenants WHERE tenant_id = current_setting('app.tenant_id')::uuid")).rows[0]?.base_currency ?? "USD";
  }

  // ---------- imports ----------
  async createImport(p: Principal, input: { kind: "actual" | "plan"; filename: string; content: string; encoding?: "text" | "base64"; mapping?: ColumnMapping; control_total: string; expected_periods?: string[]; plan_name?: string }) {
    await this.requireRole(p, "create_import", ["admin"]);
    const isXlsx = input.encoding === "base64";
    const buf = isXlsx ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf8");
    let table;
    try { table = isXlsx ? await readXlsx(buf) : readCsv(input.content); }
    catch (e) { throw new LedgerError("VALIDATION_FAILED", `The file could not be read: ${(e as Error).message}. Check that values containing commas are wrapped in quotes.`); }
    const suggested = suggestMapping(table.headers);
    const mapping = input.mapping ?? suggested.mapping;
    const missing = REQUIRED.filter((f) => !mapping[f] || !table.headers.includes(mapping[f]!));
    if (missing.length) return { status: "needs_mapping" as const, headers: table.headers, suggested: suggested.mapping, missing };
    let controlTotal: bigint;
    try { controlTotal = parseAmountMinor(input.control_total); } catch { throw new LedgerError("VALIDATION_FAILED", "control_total must be a decimal amount from the source export"); }

    const rows = table.rows.map((raw) => {
      const m = applyMapping(raw, mapping);
      let amount: bigint | string;
      try { amount = parseAmountMinor(m.amount ?? ""); } catch { amount = `invalid:${m.amount ?? ""}`; }
      return { source_row_id: m.source_row_id, period: m.period, entity_id: m.entity_id, department: m.department, account: m.account, currency: m.currency?.toUpperCase(), amount_minor: amount };
    });
    const content_sha256 = sha256(buf);
    const cid = newCorrelationId();
    return this.db.tx(p.tenant_id, async (c) => {
      const dup = await c.query("SELECT import_id, status, errors FROM import_jobs WHERE kind=$1 AND content_sha256=$2", [input.kind, content_sha256]);
      if (dup.rows[0]) return { status: dup.rows[0].status, import_id: dup.rows[0].import_id, errors: dup.rows[0].errors, duplicate_of_existing_import: true };
      const accounts = (await c.query("SELECT code FROM accounts")).rows.map((r) => r.code);
      const departments = (await c.query("SELECT code FROM departments")).rows.map((r) => r.code);
      const periods = [...new Set(rows.map((r) => r.period).filter((x): x is string => !!x && /^\d{4}-(0[1-9]|1[0-2])$/.test(x)))].sort();
      const v = validateActuals(rows as never, {
        accounts, departments, currency: await this.baseCurrency(c),
        expectedPeriods: input.expected_periods ?? periods, controlTotalMinor: controlTotal,
      });
      const entityErrors = rows.filter((r) => !p.scope.entity_ids.includes(String(r.entity_id)))
        .map((r) => ({ code: "UNKNOWN_ENTITY", source_row_id: r.source_row_id, message: `Entity ${r.entity_id} is not in scope` }));
      const errors = [...v.errors, ...entityErrors];
      const status = errors.length ? "failed" : "passed";
      const ins = await c.query(
        `INSERT INTO import_jobs (tenant_id, kind, filename, content_sha256, status, rows, errors, control_total_minor, periods, plan_name, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING import_id`,
        [p.tenant_id, input.kind, input.filename, content_sha256, status, JSON.stringify(ser(rows)), JSON.stringify(errors), controlTotal.toString(), periods, input.plan_name ?? null, p.user_id]);
      const import_id = ins.rows[0].import_id;
      await this.audit(c, p, "create_import", [import_id], "allow", status, cid, { sha: content_sha256 });
      return {
        status, import_id, row_count: rows.length, periods, errors, quarantined: v.quarantined.length,
        rows_total: minorToMajor(v.controlTotalMinor), control_total: minorToMajor(controlTotal),
      };
    });
  }

  async importValidation(p: Principal, importId: string) {
    await this.requireRole(p, "view_import", ["admin", "controller", "fpa"]);
    return this.db.tx(p.tenant_id, async (c) => {
      const r = (await c.query("SELECT import_id, kind, filename, status, errors, periods, control_total_minor, jsonb_array_length(rows) AS row_count, published_ref, created_at FROM import_jobs WHERE import_id=$1", [importId])).rows[0];
      if (!r) throw new LedgerError("NOT_FOUND", "Import not found");
      return r;
    });
  }

  /** Publishes an immutable snapshot. A failed import never replaces the current snapshot. */
  async publishImport(p: Principal, importId: string) {
    await this.requireRole(p, "publish_import", ["admin"]);
    const cid = newCorrelationId();
    return this.db.tx(p.tenant_id, async (c) => {
      const job = (await c.query("SELECT * FROM import_jobs WHERE import_id=$1 FOR UPDATE", [importId])).rows[0];
      if (!job) throw new LedgerError("NOT_FOUND", "Import not found");
      if (job.status === "published") return { published: true, ref: job.published_ref, already: true };
      if (job.status !== "passed") throw new LedgerError("UNRECONCILED_SOURCE", "Import failed validation and cannot be published");
      const rows = job.rows as Array<Record<string, string>>;
      const cols = (k: string) => rows.map((r) => r[k]);
      let ref: string;
      if (job.kind === "actual") {
        const prev = await this.currentSnapshot(c);
        ref = (await c.query(
          `INSERT INTO snapshots (tenant_id, kind, period_from, period_to, periods, content_sha256, row_count, control_total_minor, validation_status, supersedes_snapshot_id, uploaded_by)
           VALUES ($1,'actual',$2,$3,$4,$5,$6,$7,'published',$8,$9) RETURNING snapshot_id`,
          [p.tenant_id, job.periods[0], job.periods.at(-1), job.periods, job.content_sha256, rows.length, job.control_total_minor, prev?.snapshot_id ?? null, p.user_id])).rows[0].snapshot_id;
        await c.query(
          `INSERT INTO ledger_lines (tenant_id, snapshot_id, source_row_id, entity_id, period, account, department, amount_minor, currency)
           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::text[])`,
          [p.tenant_id, ref, cols("source_row_id"), cols("entity_id"), cols("period"), cols("account"), cols("department"), cols("amount_minor"), cols("currency")]);
        // A new snapshot for a period invalidates readiness and approvals built on the old one.
        const hit = await c.query(
          `UPDATE close_periods SET state='open' WHERE period = ANY($1) AND state IN ('ready','approved') RETURNING close_id`, [job.periods]);
        if (hit.rowCount) {
          await c.query(
            `UPDATE approval_requests SET status='invalidated' WHERE status IN ('pending','approved')
             AND summary_id IN (SELECT summary_id FROM close_summaries WHERE close_id = ANY($1))`, [hit.rows.map((r) => r.close_id)]);
        }
      } else {
        ref = (await c.query(
          `INSERT INTO plan_versions (tenant_id, type, name, owner, state, approved_at, mapping_version, base_currency)
           VALUES ($1,'budget',$2,$3,'approved',now(),'m1',$4) RETURNING plan_version_id`,
          [p.tenant_id, job.plan_name ?? job.filename, p.user_id, await this.baseCurrency(c)])).rows[0].plan_version_id;
        await c.query(
          `INSERT INTO plan_lines (tenant_id, plan_version_id, source_row_id, entity_id, period, account, department, amount_minor, currency)
           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::text[])`,
          [p.tenant_id, ref, cols("source_row_id"), cols("entity_id"), cols("period"), cols("account"), cols("department"), cols("amount_minor"), cols("currency")]);
      }
      await c.query("UPDATE import_jobs SET status='published', published_ref=$2 WHERE import_id=$1", [importId, ref]);
      await this.audit(c, p, "publish_import", [importId, ref], "allow", "published", cid);
      return { published: true, kind: job.kind, ref };
    });
  }

  // ---------- query ----------
  private async loadDataset(c: Client, planVersionId?: string): Promise<Dataset> {
    const snap = await this.currentSnapshot(c);
    if (!snap) throw new LedgerError("INCOMPLETE_DATA", "No published actuals snapshot");
    const plan = planVersionId
      ? (await c.query("SELECT * FROM plan_versions WHERE plan_version_id=$1 AND state='approved'", [planVersionId])).rows[0]
      : (await c.query("SELECT * FROM plan_versions WHERE state='approved' AND type='budget' ORDER BY approved_at DESC LIMIT 1")).rows[0];
    if (!plan) throw new LedgerError("STALE_SNAPSHOT", "Requested plan version is not approved or does not exist");
    const accounts = Object.fromEntries((await c.query("SELECT code, type FROM accounts")).rows.map((r) => [r.code, { type: r.type as AccountType }]));
    const fact = (r: Record<string, string>): FactLine => ({
      source_row_id: r.source_row_id!, tenant_id: r.tenant_id!, entity_id: r.entity_id!, period: r.period!,
      department: r.department!, account: r.account!, amount_minor: BigInt(r.amount_minor!), currency: r.currency!,
    });
    const actual = (await c.query("SELECT * FROM ledger_lines WHERE snapshot_id=$1", [snap.snapshot_id])).rows.map(fact);
    const planRows = (await c.query("SELECT * FROM plan_lines WHERE plan_version_id=$1", [plan.plan_version_id])).rows.map(fact);
    return {
      currency: plan.base_currency, snapshot_id: snap.snapshot_id, plan_version_id: plan.plan_version_id, mapping_version: plan.mapping_version,
      as_of: new Date(snap.imported_at).toISOString(), reconciled: true, periods: snap.periods, accounts, actual, plan: planRows,
    };
  }

  private async checkAstScope(p: Principal, ast: QueryAst) {
    if (ast.entity_ids?.some((e) => !p.scope.entity_ids.includes(e))) await this.deny(p, "query", "Entity outside your scope");
    const f = ast.filters?.department_ids;
    if (f && p.scope.department_ids !== "*" && f.some((d) => !(p.scope.department_ids as string[]).includes(d))) await this.deny(p, "query", "Department outside your scope");
  }

  async query(p: Principal, astIn: QueryAst): Promise<{ query_run_id: string; total: QueryResult | null; rows: QueryResult[]; plan_version_id: string; snapshot_id: string; as_of: string; currency: string; suppressed_total: boolean }> {
    await this.requireRole(p, "query", ANALYSTS);
    const ast: QueryAst = { ...astIn, entity_ids: astIn.entity_ids?.length ? astIn.entity_ids : p.scope.entity_ids };
    await this.checkAstScope(p, ast);
    const cid = newCorrelationId();
    return this.db.tx(p.tenant_id, async (c) => {
      const ds = await this.loadDataset(c, ast.compare_to?.version_id);
      const full: QueryAst = { ...ast, compare_to: { kind: ast.compare_to?.kind ?? "budget", version_id: ds.plan_version_id } };
      const out = runQuery(full, ds, p.scope);
      const qr = (await c.query(
        "INSERT INTO query_runs (tenant_id, caller, ast, ast_hash, dataset_versions) VALUES ($1,$2,$3,$4,$5) RETURNING query_run_id",
        [p.tenant_id, p.user_id, JSON.stringify(full), astHash(full), JSON.stringify({ snapshot: ds.snapshot_id, plan: ds.plan_version_id })])).rows[0].query_run_id;
      for (const r of [...(out.total ? [out.total] : []), ...out.rows]) {
        await c.query(
          `INSERT INTO metric_results (result_id, tenant_id, query_run_id, metric_id, value_decimal, unit, currency, entity_ids, period_start, period_end, filters,
             source_snapshot_ids, plan_version_id, mapping_version, formula_id, as_of, reconciliation_state, payload, caller)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,'currency',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [p.tenant_id, qr, r.metric_id, minorToMajor(r.variance_minor), r.currency, r.entity_ids, r.period_start, r.period_end,
           JSON.stringify({ group: r.group, ...full.filters }), r.source_snapshot_ids, r.plan_version_id, r.mapping_version, r.formula_id, r.as_of,
           r.reconciliation_state, JSON.stringify(ser(r)), p.user_id]);
      }
      await this.audit(c, p, "query", [qr], "allow", "ok", cid, full, out);
      return { query_run_id: qr, ...out, plan_version_id: ds.plan_version_id, snapshot_id: ds.snapshot_id, as_of: ds.as_of, currency: ds.currency, suppressed_total: out.total === null };
    });
  }

  /** Source rows behind a result. Refused unless the caller may see every contributing row. */
  async evidence(p: Principal, resultId: string) {
    await this.requireRole(p, "evidence", ANALYSTS);
    const row = await this.db.tx(p.tenant_id, (c) => c.query("SELECT payload FROM metric_results WHERE payload->>'result_id' = $1 ORDER BY as_of DESC LIMIT 1", [resultId]));
    const payload = row.rows[0]?.payload as (QueryResult & { lineage: { actual_row_ids: string[]; plan_row_ids: string[] } }) | undefined;
    if (!payload) throw new LedgerError("NOT_FOUND", "Result not found");
    const got = await this.db.tx(p.tenant_id, async (c) => ({
      actual: (await c.query("SELECT tenant_id, entity_id, period, department, account, source_row_id, amount_minor, currency FROM ledger_lines WHERE snapshot_id=$1 AND source_row_id = ANY($2)", [payload.source_snapshot_ids[0], payload.lineage.actual_row_ids])).rows,
      plan: (await c.query("SELECT tenant_id, entity_id, period, department, account, source_row_id, amount_minor, currency FROM plan_lines WHERE plan_version_id=$1 AND source_row_id = ANY($2)", [payload.plan_version_id, payload.lineage.plan_row_ids])).rows,
    }));
    const all = [...got.actual, ...got.plan];
    if (applyScope(all, p.scope).length !== all.length || !canSeeTotal(p.scope, all.map((r) => r.department))) {
      await this.deny(p, "evidence", "Evidence includes rows outside your scope", [resultId]);
    }
    await this.db.tx(p.tenant_id, (c) => this.audit(c, p, "evidence", [resultId], "allow", "ok", newCorrelationId()));
    const fmt = (r: Record<string, string>) => { const { tenant_id: _t, ...rest } = r; return { ...rest, amount: minorToMajor(BigInt(r.amount_minor!)) } as Record<string, string>; };
    return { result: payload, actual_rows: got.actual.map(fmt), plan_rows: got.plan.map(fmt) };
  }

  async approvedNotes(p: Principal, periods: string[], departments: string[]) {
    return this.db.tx(p.tenant_id, async (c) =>
      (await c.query("SELECT note_id, period, department, body FROM notes WHERE approved AND period = ANY($1) AND department = ANY($2)", [periods, departments])).rows as Array<{ note_id: string; period: string; department: string; body: string }>);
  }

  // ---------- close ----------
  private async closeFor(c: Client, entity: string, period: string) {
    const r = (await c.query("SELECT * FROM close_periods WHERE entity_id=$1 AND period=$2", [entity, period])).rows[0];
    if (!r) throw new LedgerError("NOT_FOUND", `No close for ${entity} ${period}`);
    return r;
  }
  async listCloseTasks(p: Principal, period: string, entity = p.scope.entity_ids[0]!) {
    await this.requireRole(p, "list_close_tasks", ["cfo", "controller", "accountant", "fpa"]);
    return this.db.tx(p.tenant_id, async (c) => {
      const close = await this.closeFor(c, entity, period);
      const tasks = (await c.query("SELECT task_id, title, owner, due_date, status, evidence_ref FROM close_tasks WHERE close_id=$1 ORDER BY title", [close.close_id])).rows;
      return { close_id: close.close_id, period, entity_id: entity, state: close.state, snapshot_id: close.snapshot_id, tasks, gates: await this.gates(c, close) };
    });
  }
  private async gates(c: Client, close: { close_id: string; period: string }) {
    const tasks = (await c.query("SELECT title, status, evidence_ref FROM close_tasks WHERE close_id=$1", [close.close_id])).rows;
    const snap = await this.currentSnapshot(c);
    return [
      { gate: "all_tasks_done", ok: tasks.length > 0 && tasks.every((t) => t.status === "done"), detail: tasks.filter((t) => t.status !== "done").map((t) => t.title) },
      { gate: "evidence_attached", ok: tasks.every((t) => t.status !== "done" || !!t.evidence_ref), detail: tasks.filter((t) => t.status === "done" && !t.evidence_ref).map((t) => t.title) },
      { gate: "published_actuals_cover_period", ok: !!snap && snap.periods.includes(close.period), detail: snap ? [snap.snapshot_id] : [] },
    ];
  }
  async updateTask(p: Principal, taskId: string, patch: { status?: string; evidence_ref?: string }) {
    await this.requireRole(p, "update_task", ["controller", "accountant"]);
    const task = (await this.db.tx(p.tenant_id, (c) => c.query("SELECT t.*, cp.state FROM close_tasks t JOIN close_periods cp USING (close_id) WHERE task_id=$1", [taskId]))).rows[0];
    if (!task) throw new LedgerError("NOT_FOUND", "Task not found");
    if (p.scope.role === "accountant" && task.owner !== p.user_id) await this.deny(p, "update_task", "You can only update your own tasks", [taskId]);
    if (patch.status && !["todo", "in_progress", "blocked", "done"].includes(patch.status)) throw new LedgerError("VALIDATION_FAILED", "Invalid status");
    return this.db.tx(p.tenant_id, async (c) => {
      await c.query("UPDATE close_tasks SET status=COALESCE($2,status), evidence_ref=COALESCE($3,evidence_ref) WHERE task_id=$1", [taskId, patch.status ?? null, patch.evidence_ref ?? null]);
      if (task.state !== "open") { // late correction: readiness and approvals no longer hold
        await c.query("UPDATE close_periods SET state='open' WHERE close_id=$1", [task.close_id]);
        await c.query("UPDATE approval_requests SET status='invalidated' WHERE status IN ('pending','approved') AND summary_id IN (SELECT summary_id FROM close_summaries WHERE close_id=$1)", [task.close_id]);
      }
      await this.audit(c, p, "update_task", [taskId], "allow", "ok", newCorrelationId(), patch);
      return { task_id: taskId, ...patch, reopened_close: task.state !== "open" };
    });
  }
  async declareReady(p: Principal, period: string, entity = p.scope.entity_ids[0]!) {
    await this.requireRole(p, "declare_ready", ["controller"]);
    return this.db.tx(p.tenant_id, async (c) => {
      const close = await this.closeFor(c, entity, period);
      const g = await this.gates(c, close);
      if (!g.every((x) => x.ok)) throw new LedgerError("INVALID_STATE", `Close gates not met: ${g.filter((x) => !x.ok).map((x) => x.gate).join(", ")}`);
      const snap = await this.currentSnapshot(c);
      await c.query("UPDATE close_periods SET state='ready', snapshot_id=$2, declared_ready_by=$3, declared_ready_at=now() WHERE close_id=$1", [close.close_id, snap!.snapshot_id, p.user_id]);
      await this.audit(c, p, "declare_ready", [close.close_id], "allow", "ready", newCorrelationId());
      return { close_id: close.close_id, state: "ready", snapshot_id: snap!.snapshot_id, gates: g };
    });
  }
  async draftSummary(p: Principal, period: string, entity = p.scope.entity_ids[0]!) {
    await this.requireRole(p, "draft_summary", ["controller", "cfo", "fpa"]);
    const close = await this.db.tx(p.tenant_id, (c) => this.closeFor(c, entity, period));
    if (close.state === "open") throw new LedgerError("INVALID_STATE", "Close is not declared ready");
    const q = await this.query(p, { metric: "opex", aggregation: "sum", period: { from: period, to: period }, entity_ids: [entity], group_by: ["department"], compare_to: { kind: "budget", version_id: "" } } as QueryAst);
    if (q.snapshot_id !== close.snapshot_id) throw new LedgerError("STALE_SNAPSHOT", "Actuals changed since the close was declared ready");
    const content = {
      kind: "close_summary", period, entity_id: entity, snapshot_id: q.snapshot_id, plan_version_id: q.plan_version_id, currency: q.currency,
      total: q.total && { result_id: q.total.result_id, actual: minorToMajor(q.total.actual_minor), plan: minorToMajor(q.total.plan_minor), variance: minorToMajor(q.total.variance_minor), variance_pct: q.total.variance_pct },
      rows: q.rows.map((r) => ({ result_id: r.result_id, department: r.group.department, actual: minorToMajor(r.actual_minor), plan: minorToMajor(r.plan_minor), variance: minorToMajor(r.variance_minor), variance_pct: r.variance_pct, direction: r.direction })),
      caveats: ["Draft. Not sent anywhere until approved; MVP offers export only."],
    };
    const content_hash = sha256(canonical(content));
    return this.db.tx(p.tenant_id, async (c) => {
      const id = (await c.query("INSERT INTO close_summaries (tenant_id, close_id, snapshot_id, content, content_hash) VALUES ($1,$2,$3,$4,$5) RETURNING summary_id",
        [p.tenant_id, close.close_id, q.snapshot_id, JSON.stringify(content), content_hash])).rows[0].summary_id;
      await this.audit(c, p, "draft_summary", [id], "allow", "draft", newCorrelationId(), undefined, content);
      return { summary_id: id, content_hash, content };
    });
  }
  async requestApproval(p: Principal, summaryId: string, destination: string, idempotencyKey: string) {
    await this.requireRole(p, "request_approval", ["controller", "fpa", "cfo"]);
    if (destination !== "export") throw new LedgerError("VALIDATION_FAILED", "MVP supports destination 'export' only; no Slack or email sends");
    return this.db.tx(p.tenant_id, async (c) => {
      const s = (await c.query("SELECT content_hash FROM close_summaries WHERE summary_id=$1", [summaryId])).rows[0];
      if (!s) throw new LedgerError("NOT_FOUND", "Summary not found");
      const id = (await c.query(`INSERT INTO approval_requests (tenant_id, artifact_hash, requested_by, destination, expires_at, idempotency_key, summary_id)
        VALUES ($1,$2,$3,$4, now() + interval '7 days', $5, $6) RETURNING approval_id`, [p.tenant_id, s.content_hash, p.user_id, destination, idempotencyKey, summaryId])).rows[0].approval_id;
      await this.audit(c, p, "request_approval", [id, summaryId], "allow", "pending", newCorrelationId());
      return { approval_id: id, artifact_hash: s.content_hash, destination, status: "pending" };
    });
  }
  /** Approval binds an exact artifact hash. Anything changed since then makes it fail. */
  async approve(p: Principal, approvalId: string, artifactHash: string) {
    await this.requireRole(p, "approve", ["controller", "cfo"]);
    const a = (await this.db.tx(p.tenant_id, (c) => c.query(
      `SELECT a.*, s.content_hash, s.snapshot_id AS s_snap, s.close_id, cp.state, cp.snapshot_id AS c_snap,
        (SELECT summary_id FROM close_summaries WHERE close_id = s.close_id ORDER BY created_at DESC LIMIT 1) AS latest
       FROM approval_requests a JOIN close_summaries s USING (summary_id) JOIN close_periods cp ON cp.close_id = s.close_id WHERE approval_id=$1`, [approvalId]))).rows[0];
    if (!a) throw new LedgerError("NOT_FOUND", "Approval not found");
    if (a.requested_by === p.user_id) await this.deny(p, "approve", "Requester cannot approve their own request", [approvalId]);
    const problems = [
      a.status !== "pending" && `status is ${a.status}`,
      new Date(a.expires_at) < new Date() && "expired",
      artifactHash !== a.artifact_hash && "artifact hash does not match request",
      a.artifact_hash !== a.content_hash && "summary content changed",
      a.latest !== a.summary_id && "a newer summary exists",
      a.state !== "ready" && `close state is ${a.state}`,
      a.c_snap !== a.s_snap && "actuals snapshot changed",
    ].filter(Boolean);
    if (problems.length) throw new LedgerError("INVALID_STATE", `Cannot approve: ${problems.join("; ")}`);
    return this.db.tx(p.tenant_id, async (c) => {
      await c.query("UPDATE approval_requests SET status='approved', approver=$2, approved_at=now() WHERE approval_id=$1", [approvalId, p.user_id]);
      await c.query("UPDATE close_periods SET state='approved' WHERE close_id=$1", [a.close_id]);
      await this.audit(c, p, "approve", [approvalId, a.summary_id], "allow", "approved", newCorrelationId());
      return { approval_id: approvalId, status: "approved", artifact_hash: artifactHash, destination: a.destination };
    });
  }
  async approvals(p: Principal, period: string, entity = p.scope.entity_ids[0]!) {
    await this.requireRole(p, "list_approvals", ["controller", "cfo", "fpa"]);
    return this.db.tx(p.tenant_id, async (c) => (await c.query(
      `SELECT a.approval_id, a.status, a.artifact_hash, a.destination, a.summary_id, a.requested_by, a.approver, s.content
       FROM approval_requests a JOIN close_summaries s USING (summary_id) JOIN close_periods cp ON cp.close_id = s.close_id
       WHERE cp.period=$1 AND cp.entity_id=$2 ORDER BY s.created_at DESC`, [period, entity])).rows);
  }

  // ---------- scenarios ----------
  async createScenario(p: Principal, input: { name: string; plan_version_id?: string; levers: Array<{ kind: "pct" | "amount"; department: string; account?: string; from_period: string; value: string }> }) {
    await this.requireRole(p, "create_scenario", ANALYSTS);
    if (!input.levers?.length || input.levers.length > 20) throw new LedgerError("VALIDATION_FAILED", "1-20 levers required");
    return this.db.tx(p.tenant_id, async (c) => {
      const snap = await this.currentSnapshot(c);
      const lastActual = snap?.periods.at(-1) ?? "0000-00";
      const plan = input.plan_version_id
        ? (await c.query("SELECT plan_version_id FROM plan_versions WHERE plan_version_id=$1 AND state='approved'", [input.plan_version_id])).rows[0]
        : (await c.query("SELECT plan_version_id FROM plan_versions WHERE state='approved' AND type='budget' ORDER BY approved_at DESC LIMIT 1")).rows[0];
      if (!plan) throw new LedgerError("STALE_SNAPSHOT", "No approved plan version");
      for (const l of input.levers) {
        if (p.scope.department_ids !== "*" && !p.scope.department_ids.includes(l.department)) await this.deny(p, "create_scenario", "Lever department outside your scope");
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(l.from_period)) throw new LedgerError("AMBIGUOUS_PERIOD", "from_period must be YYYY-MM");
        // D7 default: levers apply to future months only, never rewrite history.
        if (l.from_period <= lastActual) throw new LedgerError("VALIDATION_FAILED", `Levers apply only after the last actual month (${lastActual})`);
        let v: Decimal;
        try { v = new Decimal(l.value); } catch { throw new LedgerError("VALIDATION_FAILED", "Lever value must be a decimal"); }
        if (l.kind === "pct" && (v.lt(-100) || v.gt(100))) throw new LedgerError("VALIDATION_FAILED", "Percentage lever must be between -100 and 100");
        if (l.kind === "amount" && v.abs().gt(10_000_000)) throw new LedgerError("VALIDATION_FAILED", "Amount lever exceeds 10,000,000");
        if (l.kind === "amount") parseAmountMinor(l.value);
      }
      const id = (await c.query("INSERT INTO scenario_versions (tenant_id, owner, baseline_snapshot_id, baseline_plan_version_id, name) VALUES ($1,$2,$3,$4,$5) RETURNING scenario_id",
        [p.tenant_id, p.user_id, snap?.snapshot_id ?? null, plan.plan_version_id, input.name])).rows[0].scenario_id;
      for (const l of input.levers) {
        await c.query("INSERT INTO scenario_levers (scenario_id, tenant_id, scope, kind, value_decimal) VALUES ($1,$2,$3,$4,$5)",
          [id, p.tenant_id, JSON.stringify({ department: l.department, account: l.account ?? null, from_period: l.from_period }), l.kind, l.value]);
      }
      await this.audit(c, p, "create_scenario", [id], "allow", "ok", newCorrelationId(), input);
      return { scenario_id: id, hypothetical: true };
    });
  }

  /** Deterministic what-if on the approved plan. Stored separately; never touches actuals or plans. */
  async calculateScenario(p: Principal, scenarioId: string) {
    await this.requireRole(p, "calculate_scenario", ANALYSTS);
    return this.db.tx(p.tenant_id, async (c) => {
      const s = (await c.query("SELECT * FROM scenario_versions WHERE scenario_id=$1", [scenarioId])).rows[0];
      if (!s) throw new LedgerError("NOT_FOUND", "Scenario not found");
      if (s.owner !== p.user_id && s.visibility === "private") { await this.deny(p, "calculate_scenario", "Private scenario"); }
      const levers = (await c.query("SELECT kind, value_decimal, scope FROM scenario_levers WHERE scenario_id=$1", [scenarioId])).rows;
      const accounts = Object.fromEntries((await c.query("SELECT code, type FROM accounts")).rows.map((r) => [r.code, r.type]));
      const lines = applyScope((await c.query("SELECT tenant_id, entity_id, department, account, period, amount_minor FROM plan_lines WHERE plan_version_id=$1", [s.baseline_plan_version_id])).rows
        .filter((r) => accounts[r.account] === "expense"), p.scope);
      const months = new Map<string, { baseline: bigint; delta: bigint }>();
      const bump = (m: string) => months.get(m) ?? (months.set(m, { baseline: 0n, delta: 0n }), months.get(m)!);
      for (const l of lines) bump(l.period).baseline += BigInt(l.amount_minor);
      for (const lv of levers) {
        const sc = lv.scope as { department: string; account: string | null; from_period: string };
        if (lv.kind === "pct") {
          for (const l of lines) {
            if (l.department !== sc.department || (sc.account && l.account !== sc.account) || l.period < sc.from_period) continue;
            const d = new Decimal(l.amount_minor).mul(lv.value_decimal).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
            bump(l.period).delta += BigInt(d.toFixed(0));
          }
        } else {
          bump(sc.from_period).delta += parseAmountMinor(new Decimal(lv.value_decimal).toFixed(2));
        }
      }
      const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({
        period, baseline: minorToMajor(v.baseline), scenario: minorToMajor(v.baseline + v.delta), delta: minorToMajor(v.delta),
      }));
      const tb = [...months.values()].reduce((a, v) => a + v.baseline, 0n);
      const td = [...months.values()].reduce((a, v) => a + v.delta, 0n);
      const out = {
        scenario_id: scenarioId, name: s.name, hypothetical: true, label: "Hypothetical scenario. Not a forecast, not an approved budget.",
        baseline_plan_version_id: s.baseline_plan_version_id, baseline_snapshot_id: s.baseline_snapshot_id,
        levers: levers.map((l) => ({ kind: l.kind, value: String(l.value_decimal), ...l.scope })),
        months: rows, totals: { baseline: minorToMajor(tb), scenario: minorToMajor(tb + td), delta: minorToMajor(td) },
        visible_departments: p.scope.department_ids,
        assumptions: ["Levers apply to approved budget lines of the named department from from_period onward.", "Opex accounts only. No FX conversion."],
      };
      await this.audit(c, p, "calculate_scenario", [scenarioId], "allow", "ok", newCorrelationId(), undefined, out);
      return out;
    });
  }

  // ---------- audit read ----------
  async auditTrail(p: Principal, objectId?: string) {
    await this.requireRole(p, "read_audit", ["admin", "cfo", "controller"]);
    return this.db.tx(p.tenant_id, async (c) => (await c.query(
      `SELECT event_id, at, actor, action, object_ids, policy_decision, result, correlation_id FROM audit_events
       WHERE ($1::text IS NULL OR $1 = ANY(object_ids)) ORDER BY event_id DESC LIMIT 200`, [objectId ?? null])).rows);
  }
}

export { nextMonth };
