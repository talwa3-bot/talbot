# LedgerLens

AI agents for finance teams: variance Q&A, month-end close, and what-if scenarios, in Hebrew and English. Read-only by default. All arithmetic is deterministic code; a language model may only word results it is given, and a citation validator rejects any number or cause it invents.

> Demo uses a synthetic organization only. Do not load real financial data until the decisions in `docs/decision-log.md` are signed off by a controller and security owner.

## מה יש כאן (תקציר בעברית)

- **ממשק ווב נגיש** בעברית (ימין לשמאל) ובאנגלית: שאלה חופשית על ביצוע מול תקציב, מקור לכל מספר, סגירת חודש עם אישור גרסה מדויקת, תרחישי "מה אם", קליטת קבצים ויומן פעולות.
- **שרת MCP** לחיבור עוזרי בינה מלאכותית (כמו קלוד): ניתוח בלבד ותרחישים פרטיים. פרסום, סגירה ואישור נשארים פעולות אנושיות בממשק.
- **בקרות:** בידוד בין לקוחות ברמת מסד הנתונים, הרשאות לפי תפקיד ומחלקה, יומן ביקורת שאי אפשר לערוך, ונתונים שאי אפשר לשנות אחרי פרסום.

## Quick start

Requirements: Node 22, PostgreSQL 16.

```bash
npm install
createdb ledgerlens                      # as a superuser role
export ADMIN_DATABASE_URL=postgres://<owner>:<pw>@localhost/ledgerlens   # runs migrations
export DATABASE_URL=postgres://ledger_app:ledger_app_dev@localhost/ledgerlens  # app role, RLS enforced
npm run db:migrate
npm run db:seed        # synthetic demo tenant + Q1 2026 actuals and budget
npm start              # http://localhost:3000  (demo login, synthetic data only)
```

Pick a user on the sign-in screen. Suggested walkthrough:
1. **CFO** → Ask: "מה החריגה בהוצאות התפעול ברבעון הראשון?" → open a source.
2. **Department manager** → same question: only Sales, total withheld.
3. **Accountant** → Close: mark own tasks done with evidence links.
4. **Controller** → Close: finish payroll task, declare ready, draft summary, request approval.
5. **CFO** → Close: approve the exact version, download CSV.
6. **FP&A** → Scenarios: +5% Sales from April.
7. **Data steward** → Data import: download a template, upload, see validation.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | App connection (role `ledger_app`, no RLS bypass) |
| `ADMIN_DATABASE_URL` | Owner connection for migrations and seed only |
| `LEDGERLENS_DEMO_AUTH` | `1` enables demo login. Never in production; use SSO/OIDC |
| `LEDGERLENS_MODEL_PROVIDER` | `anthropic` to use Claude for wording; default is the offline template |
| `LEDGERLENS_MODEL` | Model ID, default `claude-opus-5-5` |
| `ANTHROPIC_API_KEY` | Server-side only, when the provider is `anthropic` |
| `LEDGERLENS_USER` | MCP server identity (demo subject) |
| `PORT` | Web server port, default 3000 |

## Tests

```bash
npm run typecheck
npm test          # unit + golden oracle + Postgres integration + MCP (needs the DB env vars)
npm run e2e       # browser flow + axe accessibility + mobile RTL, against a running seeded server
```

## MCP server

See `docs/mcp.md`. Tools: `list_dimensions`, `ask_variance`, `query_variance`, `get_evidence`, `close_status`, `create_scenario`, `calculate_scenario`.

## Layout

| Path | What |
|---|---|
| `packages/domain` | Money in minor units, Decimal variance, FX that refuses to guess |
| `packages/policy` | Tenant/entity/department scope, total suppression |
| `packages/adapters` | CSV/XLSX readers, Hebrew/English column mapping, import gates, templates |
| `packages/query` | Typed AST, allowlists, scope-aware execution, lineage |
| `packages/db` | Migrations (RLS, append-only audit, immutable lines), pool, migrate |
| `packages/core` | Service layer: imports, query, evidence, close, approvals, scenarios, audit |
| `packages/agent` | Hebrew/English intent parser, model gateway, citation validator |
| `packages/api` | HTTP API and the web UI (`public/`) |
| `packages/mcp` | MCP server over stdio |
| `tests/` | Golden oracle, integration, MCP, browser e2e |
| `docs/` | Decisions, metrics, permissions, security review, runbook, screenshots |
