# Architecture decisions

| ID | Decision | Why | Revisit when |
|---|---|---|---|
| A1 | TypeScript npm workspaces, packages per concern | One builder, one language, strict types | Team grows |
| A2 | Service layer (`packages/core`) is the only path to data; API and MCP both call it | One place for policy, audit and idempotency | Never bypass |
| A3 | Postgres RLS by `app.tenant_id` set per transaction; app role has no BYPASSRLS and cannot UPDATE audit or ledger lines | Isolation holds even if app code has a bug | Multi-region |
| A4 | Web UI is dependency-free HTML/CSS/JS served by the API, not Next.js | Fast to ship, no build step, full control over RTL and accessibility | Needs routing/state beyond this scope |
| A5 | Intent parsing is deterministic; the model only words results | Hebrew and English map to the same AST; no model-built queries | Richer questions needed (then model proposes AST, server validates) |
| A6 | Citation validator rejects unknown numbers, unknown IDs and uncited causal claims; template fallback | "No invented numbers" is enforced, not requested | Never weaken |
| A7 | Dataset loaded per query in memory with a row cap | Simple and correct for MVP volumes | > ~100k rows per query (move sums to SQL) |
| A8 | Current actuals = latest published snapshot (full replacement) | Simple immutable versioning | Incremental period imports needed |
| A9 | MCP exposes analysis and private scenarios only | Publish/close/approve stay human | Formal delegated approval policy exists |
| A10 | Idempotency keys stored per user in Postgres | Safe retries on every write | — |
