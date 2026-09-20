# Visualizations Reference — agentic-dashboard

Referenced by `active-agent-mcp-shared.md`'s Step 3. Read this instead of the
`dataviz` skill when authoring a tile with a chart, stat, or figure — this file
is scoped to what a tile actually is here (a fixed-size `sm`/`md`/`lg` card
rendering a straight read of its `state`, no query, no filter, no view
toggle — see `CONTEXT.md`'s Tile entry), so it carries only the rules that
apply at that size and skips guidance for full dashboard pages this project
doesn't have.

## Color: use the project's own chart palette, not a generic one

This project already has a validated categorical palette — don't invent or
import another one. `src/index.css` defines `--chart-1` through `--chart-5`
(light and dark, tuned as a set), wired into `components/ui/chart.tsx`'s
`ChartConfig`. Use `var(--color-chart-1)` .. `var(--color-chart-5)` (or a
`ChartConfig` entry naming one of them) for every categorical series. Never
hand-pick a hex.

- **Fixed order, never cycled.** Slot 1 for the first series, slot 2 for the
  second, and so on — the same series keeps its slot even if others are
  added, removed, or filtered.
- **5 slots is the cap.** A 6th categorical series doesn't get a generated
  color — fold it into "Other," or don't add it to this tile.
- **Sequential (magnitude, one series, more-is-darker)** — use one hue's
  lightness steps, not multiple `--chart-N` slots. If nothing in the theme
  gives you graduated steps of one hue, fall back to opacity steps of a
  single `--chart-N` color (e.g. 100% current period, ~50% prior period).
- **Diverging (above/below a baseline)** — pick two chart slots that read as
  warm/cool opposites (check them against the theme, don't assume), with a
  neutral gray midpoint (a muted/border token, never a chart slot).
- **Status (good/warning/critical) is separate from the chart palette.** Use
  the project's semantic status tokens if it has them; otherwise `Badge`
  variants. Never repurpose a `--chart-N` slot as a status color, and never
  a status color as "series N."

## Choosing the form

Decide the form before anything else — most bad tiles picked a chart when a
number was the answer.

| The data is... | Use |
|---|---|
| A ratio against a limit | A meter/progress bar, same-ramp track |
| Trend over a handful of points | Line (single series) or thin bar/column |
| Comparing 2–5 distinct series | Multi-line or grouped/stacked bar, categorical color |
| One series is the point, rest are context | Emphasis: accent color on the one that matters, gray on the rest — not full categorical |
| Part-to-whole, ≤6 segments | Stacked bar (skip donut/pie — hard to compare at a glance) |

A one-bar bar chart or a 2-slice pie is never right — that's a stat tile.
More than ~6–7 categories carrying real meaning doesn't fit a tile at all;
say so in the spec rather than cramming it in.

## Marks

- Bar/column: ≤24px thick, 4px rounded at the data end, square at the
  baseline, grows from one baseline.
- Line: 2px, round join/cap.
- Marker/end-dot: ≥8px diameter, filled with the series color.
- Area fill: the series color at ~10% opacity — a wash, never a solid block.
- Gridlines/axes: hairline (1px), solid, one step off the surface color —
  never dashed.
- A 2px gap in the surface color between touching bar segments or adjacent
  bars; a 2px surface-color ring around overlapping dots/markers. Never a
  drawn border to separate marks.

## Labels & legend

- A legend is required for 2+ series (`ChartLegend`/`ChartLegendContent`
  from `components/ui/chart.tsx`); a single-series chart needs none — the
  tile's title already says what it is.
- Label selectively — never a number on every point. Label the endpoint,
  the extreme, or the one series the tile is about; let the axis and
  tooltip carry the rest.
- Labels, axis text, and legend text use text tokens (`text-foreground`,
  `text-muted-foreground`) — never the series color itself. The colored
  mark next to the text carries identity, not colored text.
- Never let a label overflow or get clipped by its own bar/segment — if it
  doesn't fit inside, move it outside the mark or drop it to the tooltip.

## Hover

A tile can and should have a hover/tooltip layer where it helps — use
`ChartTooltip`/`ChartTooltipContent` (already in `components/ui/chart.tsx`,
wraps Recharts) rather than building one by hand. This is local component
state, not a query — it doesn't conflict with a tile's "straight read, no
transform" contract. Skip it only for a bare stat tile with no plot.

## Anti-patterns (check before reporting done)

- Recolor-on-filter — a series keeps its `--chart-N` slot even as others
  come and go.
- A value-ramp (light-to-dark) on nominal categories that have no order —
  one flat color per series, not a gradient.
- Rainbow/multi-hue for a single magnitude series — one hue, light→dark.
- A hue at a diverging midpoint — the midpoint is neutral gray.
- Thick saturated fills, heavy gridlines, no breathing room.
- Tabular-nums on a large standalone stat value — reserve it for columns
  that must align vertically; a hero/stat value uses proportional figures.
