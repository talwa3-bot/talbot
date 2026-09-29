import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LedgerError } from "@ledgerlens/domain";
import { Db } from "@ledgerlens/db";
import { LedgerLens, ser, type Principal } from "@ledgerlens/core";
import { ask, gatewayFromEnv } from "@ledgerlens/agent";
import { actualsTemplateCsv, planTemplateCsv, csvSafeCell } from "@ledgerlens/adapters";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "..", "public");
const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401, UNAUTHORIZED_SCOPE: 403, NOT_FOUND: 404, INVALID_STATE: 409, UNRECONCILED_SOURCE: 409, STALE_SNAPSHOT: 409,
};
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const DEMO_USERS = ["cfo", "controller", "fpa", "accountant", "mgr-sales", "admin"];

type Handler = (p: Principal, body: any, params: string[], req: http.IncomingMessage) => Promise<unknown>;

export function createServer(svc: LedgerLens) {
  const model = gatewayFromEnv();
  const routes: Array<[string, RegExp, Handler, boolean?]> = [
    ["GET", /^\/me$/, async (p) => ({ user_id: p.user_id, locale: p.locale, role: p.scope.role, entity_ids: p.scope.entity_ids, department_ids: p.scope.department_ids, model: model.name })],
    ["GET", /^\/dimensions$/, (p) => svc.dimensions(p)],
    ["POST", /^\/imports$/, (p, b) => svc.createImport(p, b), true],
    ["GET", /^\/imports\/([\w-]+)\/validation$/, (p, _b, [id]) => svc.importValidation(p, id!)],
    ["POST", /^\/imports\/([\w-]+)\/publish$/, (p, _b, [id]) => svc.publishImport(p, id!), true],
    ["POST", /^\/analysis\/query$/, (p, b) => svc.query(p, b)],
    ["POST", /^\/analysis\/ask$/, (p, b) => ask(svc, p, String(b.question ?? ""), b.locale === "en-US" ? "en-US" : "he-IL", model)],
    ["GET", /^\/analysis\/([\w-]+)\/evidence$/, (p, _b, [id]) => svc.evidence(p, id!)],
    ["GET", /^\/close\/(\d{4}-\d{2})\/tasks$/, (p, _b, [period]) => svc.listCloseTasks(p, period!)],
    ["POST", /^\/close\/(\d{4}-\d{2})\/tasks$/, (p, b) => svc.updateTask(p, b.task_id, { status: b.status, evidence_ref: b.evidence_ref }), true],
    ["POST", /^\/close\/(\d{4}-\d{2})\/ready$/, (p, _b, [period]) => svc.declareReady(p, period!), true],
    ["POST", /^\/close\/(\d{4}-\d{2})\/summary-draft$/, (p, _b, [period]) => svc.draftSummary(p, period!), true],
    ["GET", /^\/close\/(\d{4}-\d{2})\/approvals$/, (p, _b, [period]) => svc.approvals(p, period!)],
    ["POST", /^\/approvals$/, (p, b, _x, req) => svc.requestApproval(p, b.summary_id, b.destination, String(req.headers["idempotency-key"])), true],
    ["POST", /^\/approvals\/([\w-]+)\/approve$/, (p, b, [id]) => svc.approve(p, id!, b.artifact_hash), true],
    ["POST", /^\/scenarios$/, (p, b) => svc.createScenario(p, b), true],
    ["POST", /^\/scenarios\/([\w-]+)\/calculate$/, (p, _b, [id]) => svc.calculateScenario(p, id!)],
    ["GET", /^\/audit$/, (p, _b, _x, req) => svc.auditTrail(p, new URL(req.url!, "http://x").searchParams.get("object_id") ?? undefined)],
  ];

  async function principal(req: http.IncomingMessage): Promise<Principal> {
    const auth = req.headers.authorization ?? "";
    // Demo login only, for synthetic data. Production must sit behind SSO/OIDC.
    if (process.env.LEDGERLENS_DEMO_AUTH !== "1") throw new LedgerError("UNAUTHENTICATED", "SSO is not configured; demo auth is disabled");
    const m = /^Bearer demo:([\w-]+)$/.exec(auth);
    if (!m) throw new LedgerError("UNAUTHENTICATED", "Sign in required");
    return svc.principalFor(m[1]!);
  }

  const send = (res: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") => {
    res.writeHead(status, {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
      "cache-control": "no-store",
    });
    res.end(typeof body === "string" ? body : JSON.stringify(ser(body)));
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (url.pathname === "/api/v1/demo-users") return send(res, 200, process.env.LEDGERLENS_DEMO_AUTH === "1" ? DEMO_USERS : []);
      const tpl = /^\/api\/v1\/templates\/(actuals|plan)\.csv$/.exec(url.pathname);
      if (tpl) return send(res, 200, "﻿" + (tpl[1] === "actuals" ? actualsTemplateCsv() : planTemplateCsv()), "text/csv; charset=utf-8");
      if (url.pathname.startsWith("/api/v1/")) {
        const sub = url.pathname.slice("/api/v1".length);
        const route = routes.find(([m, re]) => m === req.method && re.test(sub));
        if (!route) return send(res, 404, { code: "NOT_FOUND", message: "No such endpoint" });
        const p = await principal(req);
        let body: any = {};
        if (req.method === "POST") {
          const chunks: Buffer[] = []; let size = 0;
          for await (const ch of req) { size += (ch as Buffer).length; if (size > 8_000_000) throw new LedgerError("VALIDATION_FAILED", "Body too large"); chunks.push(ch as Buffer); }
          body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        }
        const params = route[1].exec(sub)!.slice(1);
        const run = () => route[2](p, body, params, req);
        const out = route[3] ? await svc.idempotent(p, req.headers["idempotency-key"] as string | undefined, run) : await run();
        return send(res, 200, out);
      }
      if (url.pathname === "/export/summary.csv") {
        // CSV export of an approved close summary, spreadsheet-safe.
        const p = await principal(req);
        const rows = (await svc.approvals(p, url.searchParams.get("period") ?? "")).filter((a: any) => a.status === "approved");
        if (!rows[0]) throw new LedgerError("INVALID_STATE", "No approved summary for this period");
        const c = rows[0].content;
        const lines = [["department", "actual", "plan", "variance", "variance_pct", "result_id"], ...c.rows.map((r: any) => [r.department, r.actual, r.plan, r.variance, r.variance_pct, r.result_id])];
        return send(res, 200, "﻿" + lines.map((l: string[]) => l.map((x) => csvSafeCell(String(x))).join(",")).join("\n"), "text/csv; charset=utf-8");
      }
      const file = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
      if (!file.startsWith(PUBLIC)) return send(res, 403, { code: "UNAUTHORIZED_SCOPE" });
      try { return send(res, 200, await readFile(file, "utf8"), TYPES[path.extname(file)] ?? "text/plain"); }
      catch { return send(res, 200, await readFile(path.join(PUBLIC, "index.html"), "utf8"), TYPES[".html"]); }
    } catch (e) {
      if (e instanceof LedgerError) return send(res, STATUS[e.code] ?? 400, { code: e.code, message: e.message });
      if (e instanceof SyntaxError) return send(res, 400, { code: "VALIDATION_FAILED", message: "Invalid JSON" });
      console.error(e);
      return send(res, 500, { code: "INTERNAL", message: "Unexpected error" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  createServer(new LedgerLens(Db.connect())).listen(port, () => console.log(`LedgerLens on http://localhost:${port}`));
}
