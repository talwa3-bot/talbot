---
name: finance-chart-polish
description: Improve, redesign, or build charts for financial presentations (board decks, CFO reports, investor decks, audit and valuation findings, lectures on financial statement analysis). Use whenever the user shares a chart, a screenshot of a chart, an Excel/CSV table, or a slide and asks to improve it, make it clearer, make it "presentation ready", or turn numbers into a slide. Triggers on: גרף, תרשים, מצגת, שקף, chart, graph, slide, deck, waterfall, bridge, variance, budget vs actual, P&L, cash flow, KPI.
---

# Finance Chart Polish

Goal: every chart answers ONE business question, and the slide title states the answer.

## Workflow (follow in order)

1. **Find the message.** Ask yourself: what should a CFO remember after 5 seconds? If the user did not say, propose one message and state it as an assumption.
2. **Check the numbers first.** Verify totals, subtotals and percentages against the source. Never round, invent or smooth data. If a number does not reconcile, stop and report it as a question.
3. **Choose the chart type** (table below).
4. **Apply the design rules** (section below).
5. **Write the slide title** as a full-sentence conclusion.
6. **Deliver**: the improved chart, plus a short "before → after" list of what changed and why.

## Chart type by question

| Business question | Use | Avoid |
|---|---|---|
| How did we get from A to B? (budget→actual, EBITDA bridge, net income→cash) | Waterfall / bridge | Stacked bars |
| Trend over time (revenue, margin by month/quarter) | Line (many periods) or columns (≤ 8 periods) | Pie, 3D |
| Compare items (segments, clients, branches) | Horizontal bars, sorted descending | Unsorted bars, pie with > 3 slices |
| Composition of a whole (cost structure) | 100% stacked bar or one sorted bar | Pie with many slices, donut |
| Budget vs actual | Paired bars or bar + target marker, variance labeled | Two separate charts |
| Two measures of different scale (revenue + margin %) | Two small charts side by side | Dual axis, unless unavoidable and clearly labeled |
| One headline number | Big number tile with comparison (vs. prior year / budget) | A chart with one bar |

## Design rules

- **Background**: white. No gridline clutter: remove or make very light gray.
- **Font**: one font family for the whole deck. Labels ≥ 12pt equivalent.
- **Colors**: max three. Gray for context, one strong color for the focus series, one accent for the key point (e.g. negative variance). Never color by default palette.
- **Highlight, don't decorate**: no 3D, shadows, gradients, clip art, or borders.
- **Label directly**: put values and series names on the chart; drop the legend when possible.
- **Axes**: bar/column charts start at zero. State units once (₪ thousands, $M, %). Consistent decimals.
- **Negatives**: show as negative values or in parentheses consistently, with the accent color.
- **Sort** categories by value unless there is a natural order (time, process steps).
- **Annotate** the one point that matters (callout or short note), not every point.
- **Source line** at the bottom: data source and period, e.g. "מקור: דוחות כספיים מבוקרים 2025".

## Slide title

- A full sentence with the conclusion, not a topic.
- Bad: "Revenue 2025". Good: "Revenue grew 18%, driven by the US segment".
- Hebrew deck: Hebrew title, right-to-left layout, numbers and currency formatted for Hebrew readers.

## Hebrew / RTL decks

- Entire slide right-to-left; category order and legend aligned to RTL.
- Avoid mixing English words inside Hebrew labels; transliterate or translate. Keep English only for official names and tickers.
- Check that minus signs and percent signs render on the correct side.

## Output formats

- PowerPoint: native editable chart when possible (use the pptx skill if available).
- Excel: format the chart in place and describe the exact settings changed.
- Image or HTML: render, then check the result visually before delivering.

## Final checklist (run before delivering)

- [ ] One message, stated in the title as a conclusion
- [ ] Numbers reconcile to source, no rounding beyond the source
- [ ] Right chart type for the question
- [ ] ≤ 3 colors, white background, one font
- [ ] Direct labels, units stated, axis starts at zero for bars
- [ ] Source line present
- [ ] RTL correct for Hebrew decks
