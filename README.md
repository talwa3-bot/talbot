# LedgerLens

AI agents for finance teams: variance Q&A, close coordination, spend scenarios. Read-only by default. Language models explain verified results; all arithmetic is deterministic code.

**Status:** Foundation plus file ingestion (CSV/XLSX, templates, Hebrew/English column mapping) and an in-memory query service with allowlisted metrics, scope enforcement and per-result lineage. Not built yet: live Postgres wiring, API server, agent/citation validator, close, scenarios, web UI.

## Run

```bash
npm install
npm test          # golden numeric oracle, import gates, FX, policy
npm run typecheck
```

## Layout

- `packages/domain` money, variance, FX (Decimal, minor units)
- `packages/policy` tenant/entity/department scoping, total suppression
- `packages/adapters` CSV/XLSX readers, templates, column mapping, amount parsing, import gates
- `packages/query` typed AST, allowlists, scope-aware execution, lineage
- `packages/db/migrations` PostgreSQL schema with RLS and append-only audit
- `packages/contracts/openapi.yaml` API contract
- `tests/golden` independent oracle and negative fixtures
- `docs/` permission matrix, metric definitions, decision log

No real customer data, no secrets. Demo uses synthetic fixtures only.
