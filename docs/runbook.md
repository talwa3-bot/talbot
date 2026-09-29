# Operator runbook

- **Start:** `npm run db:migrate && npm start`. Health: `GET /healthz`.
- **Reset demo:** `npm run db:seed` (truncates everything; demo databases only).
- **Import failed:** open Data import, read the problem table. Failed imports never replace the current snapshot. Fix the source file and re-upload.
- **Close approval shows "invalidated":** data or a task changed after approval. Re-declare ready, redraft, request approval again.
- **Model down or rejected:** answers fall back to fixed wording automatically; numbers are unaffected.
- **Audit:** Activity log page, or `GET /api/v1/audit?object_id=...`.
- **Backups:** not automated yet. Use `pg_dump` daily and test restore before any pilot.
