# Security review (MVP, synthetic data)

Status: self-review. Needs a named security owner's sign-off before real data.

**Controls in place (with tests)**
- Tenant isolation: RLS on every business table; unset tenant returns nothing (`tests/integration/system.test.ts`).
- App role cannot rewrite audit or ledger history (permission denied, tested).
- Role and department scope enforced server-side before any query; totals that would reveal hidden departments are withheld; evidence refused if any row is out of scope; denials are audited.
- No raw SQL or model-built queries; metric and dimension allowlists; row cap.
- Model output: numbers and citations validated; prompt injection in notes cannot place numbers in answers (tested).
- No external send path: approval destination limited to `export`; the outbox table is unused.
- Approval binds an exact content hash; any later change (new snapshot, task edit, newer draft) invalidates it; self-approval refused.
- CSV export neutralizes formula injection. Security headers and CSP on all responses. Body size limit.
- Secrets only via environment; the model key is server-side.

**Known gaps before production**
- Demo auth only; SSO/OIDC required. MCP identity is an env var.
- No rate limiting; no encryption of stored source files (raw files are not stored; normalized rows are kept in `import_jobs`).
- No per-tenant KMS keys, retention policy, or backup/restore drill yet.
- Model provider terms and data residency not reviewed (D8); default provider is offline.
