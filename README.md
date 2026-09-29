# LedgerLens

AI agents for finance teams: variance Q&A, close coordination, spend scenarios. Read-only by default. Language models explain verified results; all arithmetic is deterministic code.

**Status:** Slice 0-4 foundation (domain, policy, import gates, schema, API contract, golden tests). The web UI, worker, agent orchestrator and close/scenario services are not built yet.

## Run

```bash
npm install
npm test          # golden numeric oracle, import gates, FX, policy
npm run typecheck
```

## Layout

- `packages/domain` money, variance, FX (Decimal, minor units)
- `packages/policy` tenant/entity/department scoping, total suppression
- `packages/adapters` import validation gates (CSV-first)
- `packages/db/migrations` PostgreSQL schema with RLS and append-only audit
- `packages/contracts/openapi.yaml` API contract
- `tests/golden` independent oracle and negative fixtures
- `docs/` permission matrix, metric definitions, decision log

No real customer data, no secrets. Demo uses synthetic fixtures only.
