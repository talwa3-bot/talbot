# Metric definitions (v0.1, requires finance-owner approval before real data)

- **Money:** integer minor units (BIGINT). Division, FX and percentages use Decimal, rounding half-even.
- **variance** = actual - plan (minor units).
- **variance_pct** = (actual - plan) / abs(plan) * 100. When plan = 0 the value is `null` and shown as `n/a`; the absolute variance is still shown.
- **Favorable/unfavorable:** expense over plan = unfavorable, under plan = favorable. Revenue is the reverse. Missing or mixed account type = `unknown`. Sign alone is never used.
- **Cross-foot:** the visible breakdown must sum to the displayed total, or the total is suppressed.
- **Oracle (Jan 2026, USD):** Sales 12,000 vs 10,000 = +2,000 (+20.00%); Ops 7,500 vs 8,000 = -500 (-6.25%); total 19,500 vs 18,000 = +1,500 (+8.33%). See `tests/golden`.
