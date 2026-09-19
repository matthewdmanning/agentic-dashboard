# Active agent MCP test

See [`CONTEXT.md`](../CONTEXT.md)'s "Active agent MCP test" entry for what
this trial is and why it exists. This doc is the workflow: how to run one,
how a fixture is built, and the conventions a fixture must follow.

## Running a trial

```bash
tsx active-agent-trials/active-agent-mcp-test.ts [--tier haiku|sonnet|opus|all] [--dry-run] [--prompts <file>]
tsx active-agent-trials/active-agent-mcp-test.ts --self-check
```

- No `--tier` (or `--tier all`) runs all three tiers.
- `--dry-run` prints the commands each tier would run without spending anything.
- `--prompts <file>` points at a prompts JSON file other than
  [`active-agent-mcp-test.prompts.json`](active-agent-mcp-test.prompts.json)
  — for example, a prior trial's own `prompts.json`, since the schema is
  identical.
- `--self-check` runs the script's own pure-function checks and exits.

Each tier gets one empty dashboard and one MCP instance, seeded once. That
tier's prompts run against it in order, each only after the agent has fully
finished the last (see `runAgent`'s `--resume` chaining in the script).

Every file a run produces lands under
`active-agent-trials/trials/<date>_run<n>/` — see `trialLayout()` in the
script for the exact paths (prompts.json, index.md, logs/, screenshots/,
`<tier>-final.png`, `<tier>-final-dashboard.json`). `<n>` numbers multiple
runs on the same day (`determineRunFolder()` picks one past whatever already
exists for today), so a second run never overwrites the first. Review starts
at that run's `index.md`. Judging is manual — the script collects evidence,
it does not grade.

## Building a fixture (prompts.json)

A fixture is one JSON object with two top-level keys:

```json
{
  "data": { "...": "realistic dummy dataset, see below" },
  "steps": [
    { "step": "kebab-case-name", "text": "the prompt text", "tags": [] }
  ]
}
```

The last step is conventionally a `place-all-tiles` follow-up (tag it
`"place-all-tiles"`) asking the agent to place any tile it only specced
earlier.

**Data lives in `prompts.json`, not a separate file.** One dataset, one
prompt sequence, one file — keeps them from drifting apart.

**Data before prompts, and given first.** Before writing any prompt text,
decide what data every tile in the fixture would actually draw on and shape
it as `data`. At the start of the run, before any of `steps`, the script
sends the agent that entire blob once, with a short instruction that it's
the user's data, available for later use, and that no action is needed yet
(`buildDataSeedPrompt` in the script). Every later prompt runs in that same
session, so the agent already has it — the same order a person building a
real dashboard follows: know your data, then describe the tile.

**Shape `data` like a real source, not like a test fixture.** Use the field
names a real API or the agent's own memory would actually return (ids,
timestamps, provider names, nested objects) — not names picked to match a
tile's props. Don't key or group `data` by which step it's for; the agent
must infer which fields matter for which prompt, the way it would against a
real integration. Extraneous fields beyond what any prompt needs are fine
and expected. The dataset only needs to _contain_ what each tile needs
somewhere in it — completeness and having a realistic shape is the success
criterion, not tidiness.

**Make each record multidimensional.** A record should carry several
plausible fields, not just the one value a tile happens to show. For
a tile whose whole point is a time series, prefer a longer run of daily records with short,
API-style field names over a couple of pre-aggregated numbers — e.g. two
weeks of `{ date, cal, protein_g, carbs_g, fat_g, water_ml, steps }` rather
than a single weekly total. Forcing the agent to read a real series (and, for
week-over-week, to aggregate it into weeks itself) is more realistic than
handing it the aggregate.

## Appearance / theme setup

A trial's dashboard must look like a real user already went through
onboarding and picked a theme, not like an unstyled scaffold or, worse, the
app's own default look — a screenshot judge needs to be able to tell the
agent's own styling choices apart from whatever theme was already sitting
there. The app's real theme (`src/index.css`) is deliberately _not_ reused
for this, since it's ordinary and would make agent-driven styling choices
blend into the backdrop rather than stand out against it.

[`active-agent-mcp-test.theme.css`](active-agent-mcp-test.theme.css)
is a manually authored, fixed theme — a different accent hue, a serif font
stack, and a larger border radius than the app's own theme — checked in
alongside `prompts.json` for the same reason: one hand-picked, reviewable
fixture, not something generated per run. Every tier's dashboard in a run
uses this exact file, so comparisons across models sit on the same visual
backdrop.

This works because of how the app already resolves its stylesheet: Vite
aliases `@styles` to `<workspace>/styles.css` (see `vite.config.ts`), and
`seedWorkspace()` (in [`src/workspace.ts`](../src/workspace.ts)) only
writes that file when it's missing — an existing one is left alone. The
trial script's `createEmptyDashboardWorkspace()` writes `THEME_FILE`'s
content into the fresh workspace's `styles.css` _before_ the dashboard
server (and its `seedWorkspace()` call) ever starts, so the server finds it
already there and never overwrites it with the app's own theme.

To change the trial's look, edit `active-agent-mcp-test.theme.css` directly
— it's plain CSS custom properties in the same `@theme inline` shape as
`src/index.css`, not a shadcn preset code or components.json fields. Don't
route this through `npx shadcn apply`: applying a preset there rewrites
component source files repo-wide, which is out of scope for a fixture that
only needs to change CSS variables.

## Registry setup

A trial's registry starts separate from this project's own: no pre-authored
tile (`stat-tile`, `checklist-tile`, etc.) is present, only the shadcn base
components every tile is built from. This matters because a trial measures
whether the agent can author a tile from nothing — handing it the project's
finished tiles up front would let it copy an answer instead of building one.

`createEmptyDashboardWorkspace()` sets this up before the dashboard server
(and its `seedWorkspace()` call) ever starts:

- `registry/` is created empty. `seedWorkspace()` only fills a target
  directory that doesn't exist yet, so a pre-created empty one keeps this
  project's own tile source out of the trial entirely.
- `components/` is a real copy of this project's own `components/` — the
  installed shadcn base components — so no trial ever needs to re-add them
  from a registry over the network. A copy, not a symlink: a symlinked
  `components/` is the same file as this project's real one, so an agent
  writing through it (a formatter, an in-place edit) lands directly on this
  project's source — that happened once (`components/ui/progress.tsx`,
  restored via `git checkout`). A copy is this trial's own to modify or
  ruin; the real `components/` is never reachable from inside a trial.
- `components.json` is a copy of this project's own (with `tailwind.css`
  repointed at the workspace's `styles.css`), pre-written for the same
  reason — `seedWorkspace()` only generates one when missing, and its
  generated aliases don't match this project's own `@components/ui`
  scheme. Copying the real file keeps a trial's shadcn CLI resolution
  (`ui`, `registries["@dashboard"]`, everything) identical to the project's.

## Conventions

- Each prompt's style instruction should be data-relevant, not just a tone
  word. Prefer "use a different color per book status" or "make the totals
  field really stand out" over "make it pop" or "make it bold" alone — a
  data-relevant instruction is falsifiable against the fixture's `data`
  (did it actually vary color by status? is the totals field visually
  distinct?), a generic tone word isn't.
- One prompt describes one tile (or, for the final step, one placement pass)
  — do not combine multiple tile requests into a single prompt entry.
- `step` is kebab-case and stable: it names the prompt's screenshot and log
  marker, so renaming it after a trial has run breaks cross-referencing.
- Keep prompts as a person would actually phrase a request — informal,
  occasionally imprecise — since the trial is measuring how the agent
  handles real phrasing, not a spec.
