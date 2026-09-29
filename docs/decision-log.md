# Decision log

Owner for accounting, access and privacy decisions is an authorized human. AI review personas may critique, but do not substitute for sign-off.

| ID | Decision | Status | Owner | Default until decided |
|---|---|---|---|---|
| D1 | Source of truth: posted GL export vs management report | open | Controller | CSV of posted GL, demo data only |
| D2 | Budget: frozen approved version vs editable sheet | open | FP&A | Frozen approved version |
| D3 | Cross-entity FX policy | open | Controller / FP&A | Block mixed-currency answers |
| D4 | Consolidated total vs suppressed department | open | Security + finance | Suppress total (`canSeeTotal`) |
| D5 | Close trigger | decided for MVP | Controller | Manual declaration only |
| D6 | Ambiguous query: infer or ask | open | UX + FP&A | Ask when a load-bearing number changes |
| D7 | Scenario lever scope | open | FP&A | Future months only |
| D8 | Model provider | open | Security | Mock provider, offline |
| D9 | Localization | decided | Product | Stable canonical IDs, labels per locale |

## Choices made during the build (defaults, reversible)

- UI default language Hebrew; per-user locale stored; switch at any time.
- Model: offline template wording by default; Claude optional via env. Numbers never come from the model.
- Base currency USD for the demo tenant; mixed currency answers are refused until D3 is decided.
- Accounting basis (cash vs accrual) not assumed; demo data is labeled synthetic.
