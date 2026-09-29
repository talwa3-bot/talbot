import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LedgerError } from "@ledgerlens/domain";
import { Db } from "@ledgerlens/db";
import { LedgerLens, ser, type Principal } from "@ledgerlens/core";
import { ask, gatewayFromEnv } from "@ledgerlens/agent";
import type { QueryAst } from "@ledgerlens/query";

/**
 * LedgerLens MCP server. Exposes read-only analysis plus private what-if scenarios.
 * Deliberately NOT exposed: import/publish, task updates, close readiness, approvals.
 * Those stay human actions in the web UI, so no AI client can publish, close or approve.
 */
export function buildMcpServer(svc: LedgerLens, principal: () => Promise<Principal>) {
  const server = new McpServer({ name: "ledgerlens", version: "0.1.0" }, {
    instructions: "Finance analysis over published, reconciled snapshots. Every number comes from deterministic code with a result_id; cite result_ids and use get_evidence for sources. Never invent or recompute figures. Status 'clarify' means ask the user the returned question.",
  });
  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const run = async (fn: (p: Principal) => Promise<unknown>) => {
    try {
      const out = ser(await fn(await principal()));
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      const err = e instanceof LedgerError ? { code: e.code, message: e.message } : { code: "INTERNAL", message: "Unexpected error" };
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(err) }] };
    }
  };
  const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("Month as YYYY-MM");

  server.registerTool("list_dimensions", {
    title: "List dimensions", annotations: RO,
    description: "Metrics, accounts, departments (only those you may see), approved budget versions and the current actuals snapshot with its months.",
    inputSchema: {},
  }, () => run((p) => svc.dimensions(p)));

  server.registerTool("ask_variance", {
    title: "Ask a variance question", annotations: RO,
    description: "Natural-language question in Hebrew or English about actual vs budget. Returns status answer|clarify|abstain, a lead, a table with result_ids, and a citation-checked narrative.",
    inputSchema: { question: z.string().min(3).max(500), locale: z.enum(["he-IL", "en-US"]).default("en-US") },
  }, ({ question, locale }) => run((p) => ask(svc, p, question, locale, gatewayFromEnv())));

  server.registerTool("query_variance", {
    title: "Run a typed variance query", annotations: RO,
    description: "Deterministic actual vs budget for an allowlisted metric (opex|revenue) and period, grouped by allowlisted dimensions. Totals that would reveal hidden departments are withheld.",
    inputSchema: {
      metric: z.enum(["opex", "revenue"]), from: period, to: period,
      group_by: z.array(z.enum(["department", "account", "period", "entity_id"])).max(3).default(["department"]),
      department_ids: z.array(z.string()).optional(), budget_version_id: z.string().optional(),
    },
  }, (a) => run((p) => svc.query(p, {
    metric: a.metric, aggregation: "sum", period: { from: a.from, to: a.to }, entity_ids: [], group_by: a.group_by,
    compare_to: { kind: "budget", version_id: a.budget_version_id ?? "" }, ...(a.department_ids ? { filters: { department_ids: a.department_ids } } : {}),
  } as QueryAst)));

  server.registerTool("get_evidence", {
    title: "Get evidence for a result", annotations: RO,
    description: "Source ledger and budget rows behind a result_id. Refused if any contributing row is outside your scope.",
    inputSchema: { result_id: z.string().regex(/^res_[0-9a-f]{16}$/) },
  }, ({ result_id }) => run((p) => svc.evidence(p, result_id)));

  server.registerTool("close_status", {
    title: "Month-end close status", annotations: RO,
    description: "Close tasks, owners, evidence and gate results for a month. Read-only: readiness and approval are human actions in the web app.",
    inputSchema: { period },
  }, ({ period }) => run((p) => svc.listCloseTasks(p, period)));

  server.registerTool("create_scenario", {
    title: "Create a private what-if scenario", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "Hypothetical levers on future budget months (after the last actual month). Stored privately; never changes actuals or approved budgets.",
    inputSchema: {
      name: z.string().min(1).max(100),
      levers: z.array(z.object({
        kind: z.enum(["pct", "amount"]), department: z.string(), account: z.string().optional(), from_period: period,
        value: z.string().regex(/^-?\d+(\.\d{1,2})?$/).describe("Percent (-100..100) or amount in base currency"),
      })).min(1).max(20),
    },
  }, (a) => run((p) => svc.createScenario(p, a)));

  server.registerTool("calculate_scenario", {
    title: "Calculate a scenario", annotations: RO,
    description: "Deterministic baseline vs scenario by month for a scenario you own. Labeled hypothetical.",
    inputSchema: { scenario_id: z.string().uuid() },
  }, ({ scenario_id }) => run((p) => svc.calculateScenario(p, scenario_id)));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const svc = new LedgerLens(Db.connect());
  const subject = process.env.LEDGERLENS_USER;
  let cached: Principal | undefined;
  const principal = async () => {
    if (process.env.LEDGERLENS_DEMO_AUTH !== "1") throw new LedgerError("UNAUTHENTICATED", "MCP demo identity is disabled; production requires an authenticated identity");
    if (!subject) throw new LedgerError("UNAUTHENTICATED", "Set LEDGERLENS_USER");
    return (cached ??= await svc.principalFor(subject));
  };
  await buildMcpServer(svc, principal).connect(new StdioServerTransport());
}
