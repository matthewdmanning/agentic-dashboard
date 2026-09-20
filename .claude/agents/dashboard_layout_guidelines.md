# Layout Guidelines for Visual Utility & Aesthetics

## 1. The Three-Tier Information Architecture (Glance $\rightarrow$ Analyze $\rightarrow$ Audit)

Structure the dashboard to match natural human scanning patterns (top-to-bottom, left-to-right):

* **Tier 1: Glance (Top / Row 1)**
* Dedicate strictly to low-friction, high-signal KPIs (`rowSpan: 1`, `colSpan: 3` or `4`).
* Group metrics logically: place primary growth indicators on the far left (visual entry point) and cost, risk, or secondary indicators toward the right.


* **Tier 2: Analyze (Middle / Rows 2–3)**
* Dedicate to analytical exploration (timeseries trends, breakdowns, comparative charts).
* Use asymmetric column splits (e.g., `8 + 4`) rather than symmetrical halves (`6 + 6`) to establish a clear focal point.


* **Tier 3: Audit (Bottom / Final Rows)**
* Dedicate to granular, actionable, or paginated datasets (`user-table`, audit logs) across a full-width container (`colSpan: 12`).



---

## 2. Visual Rhythm & Density Balancing

Avoid clustering visually heavy, high-density tiles together by alternating dense and airy interfaces:

* **Pair Heavy with Light:** When placing an `activity-feed` (high text density, heavy vertical scrolling), pair it alongside a minimalist line chart or a visual gauge (`system-health`), not another dense list or table.
* **The "One Focal Anchor" Rule:** Every dashboard viewport must have exactly **one dominant anchor** widget (typically an 8-column primary line or area chart). Avoid placing two competing 8-column visualizers adjacent to each other.
* **Avoid Metric Monotony:** Never stack more than four KPI cards horizontally without breaking the rhythm with a chart or visual gauge.

---

## 3. Data-to-Geometry Pairing (Aspect Ratio Fit)

Ensure the assigned dimensions match the visual display requirements of the underlying data:

* **Timeseries & Trends:** Require wide horizontal space to reveal patterns over time. Assign `colSpan: 8` or `12`. Constraining a timeseries line chart to `colSpan: 4` compresses the horizontal axis and obscures trends.
* **Categorical Breakdowns & Proportions:** Donut charts, category bar breakdowns, and distribution gauges render best in squarish or vertical aspect ratios. Assign `colSpan: 4` or `6`.
* **Chronological Feeds & Status Trees:** Benefit from vertical room for linear scanning. Assign `colSpan: 4`, `rowSpan: 2`.
* **Tabular Records:** Multi-column tables need horizontal width to prevent clipped cells and premature horizontal scrollbars. Always default tables to `colSpan: 12`.

---

## 4. Baseline Alignment & Row Harmony

Mismatched vertical heights produce ragged, visually jarring baselines across the layout:

* **Synchronize Row Baselines:** If placing a primary chart at `rowSpan: 2` (e.g., ~300px), its adjacent sibling tile must either:
* Also be `rowSpan: 2`, or
* Consist of two vertically stacked tiles of `rowSpan: 1` each.


* **Prevent "L-Shape" Voids:** Never place a single `rowSpan: 3` tile adjacent to multiple `rowSpan: 1` tiles unless intentionally designing a persistent sidebar column.