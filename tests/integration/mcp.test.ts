import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { seed } from "../../scripts/seed.js";

const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://ledger_owner:owner_dev@localhost/ledgerlens";
const APP = process.env.DATABASE_URL ?? "postgres://ledger_app:ledger_app_dev@localhost/ledgerlens";
const clients: Client[] = [];
async function connect(user: string) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "packages/mcp/src/server.ts"], env: { ...process.env, DATABASE_URL: APP, LEDGERLENS_DEMO_AUTH: "1", LEDGERLENS_USER: user } as Record<string, string> }));
  clients.push(c); return c;
}
const json = (r: any) => JSON.parse(r.content[0].text);

beforeAll(async () => { await seed(ADMIN, APP); }, 60_000);
afterAll(async () => { for (const c of clients) await c.close(); });

describe("MCP server", () => {
  it("exposes analysis tools and no publish/approve/close-writing tools", async () => {
    const c = await connect("cfo");
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["ask_variance", "calculate_scenario", "close_status", "create_scenario", "get_evidence", "list_dimensions", "query_variance"]);
  }, 60_000);
  it("answers in Hebrew with cited results and serves evidence", async () => {
    const c = await connect("cfo");
    const a = json(await c.callTool({ name: "ask_variance", arguments: { question: "מה החריגה בהוצאות התפעול ברבעון הראשון?", locale: "he-IL" } }));
    expect(a.total.variance).toBe("3100.00");
    const ev = json(await c.callTool({ name: "get_evidence", arguments: { result_id: a.table[0].result_id } }));
    expect(ev.actual_rows.length).toBeGreaterThan(0);
  }, 60_000);
  it("enforces the same scope as the web app", async () => {
    const m = await connect("mgr-sales");
    const q = json(await m.callTool({ name: "query_variance", arguments: { metric: "opex", from: "2026-01", to: "2026-03" } }));
    expect(q.total).toBeNull();
    expect(q.rows.map((r: any) => r.group.department)).toEqual(["sales"]);
    const denied = await m.callTool({ name: "query_variance", arguments: { metric: "opex", from: "2026-01", to: "2026-01", department_ids: ["ops"] } });
    expect(denied.isError).toBe(true);
    expect(json(denied).code).toBe("UNAUTHORIZED_SCOPE");
  }, 60_000);
  it("runs a private scenario", async () => {
    const c = await connect("fpa");
    const s = json(await c.callTool({ name: "create_scenario", arguments: { name: "mcp", levers: [{ kind: "pct", department: "sales", from_period: "2026-04", value: "5" }] } }));
    const r = json(await c.callTool({ name: "calculate_scenario", arguments: { scenario_id: s.scenario_id } }));
    expect(r.hypothetical).toBe(true);
    expect(r.totals.delta).toBe("1500.00");
  }, 60_000);
});
