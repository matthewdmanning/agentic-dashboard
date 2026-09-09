# Handoff: MCP-agent interface rework (issue #101)

Branch `issue-101-mcp-agent-interface-rework`, checked out off `main`. Nothing
implemented yet — this doc is for whoever plans/implements it next.

## Where this came from

Two independent agents connected to this dashboard this session and both hit
the same confusion: assumed the HTTP port (5173) was the MCP endpoint (it
isn't — MCP is stdio-only, `src/mcp/index.ts`, no HTTP surface at all). One of
them went further and actually drove `assemble-card-template` to compose a
styled card, then filed a real technical report on what worked, what didn't,
and why. That report is what turned "the interface is poorly designed" into
concrete, verified findings — see below.

Issue #101 as currently filed already captures the first pass (discoverability,
tool-surface leakage, composition guidance) but its composition-guidance
framing is **stale** — see "Correction to #101" below before planning off the
issue body as-is.

## Verified findings (checked against the actual code this session, not taken on faith)

1. **`assemble-card-template`'s `props` field is genuinely unvalidated.**
   `src/card-templates/codegen.ts:93`, `renderProps(props: Record<string,
unknown>)` serializes straight to JSX attributes, no allowlist. This is
   _why_ composition can reach real styling (Tailwind classNames pass through
   verbatim) — not a bug by itself, just worth knowing it's intentional
   (D22: `tsc` is the correctness gate, not a schema).

2. **The theme system has no accent color, anywhere.** `src/styles.css`:
   every token is `oklch(L 0 0)` — zero chroma — except `--destructive:
oklch(0.577 0.245 27.325)` (reserved for error states). The token
   literally named `--accent` (`oklch(0.97 0 0)`) carries no hue. This is a
   **real design-token gap**, confirmed, and it's _why_ every MCP-composed
   card looks flat/gray regardless of how well an agent composes — no amount
   of prompting fixes a palette with no accent hue in it. **This is a
   theme-system problem, not an MCP-interface problem** — was mid-discussion
   on whether to split it into its own issue when this handoff was requested;
   see "Open decision" below.

3. **`read-appearance` already solves the styling-discovery gap — it's just not discoverable.**
   `AppearanceView` (src/service/index.ts:174) already includes a `css:
string` field — the full generated stylesheet with every semantic token
   declared (`--primary`, `--accent`, etc., see `appearanceCss` in
   `src/server/appearance.ts:488`). `read-appearance` is already a registered
   MCP tool. The agent that filed the report never called it before
   composing — its description doesn't say "this tells you what colors are
   available," so nothing pointed it there. **This means no new
   "list-styling-tokens" tool is needed** — just better tool descriptions
   (see Plan, item 2).

4. **No component catalog exists for an agent to discover, but the raw material for one already does.**
   `src/card-templates/codegen.ts:13`, a private (unexported)
   `componentSourceFiles()` already reads `src/components/ui/*.tsx` at
   runtime and maps every real export to its file — dynamically, so it never
   goes stale as components are added/removed (same "read the real thing,
   don't hand-maintain a copy" philosophy D22 already uses for validation).
   There is currently ~11 files in `src/components/ui`. Nothing exposes this
   over MCP today.

5. **The server already prints the browser auth URL on startup — it's undocumented, not missing.**
   `src/server/index.ts:701` prints `http://127.0.0.1:${port}/?token=${localUserToken}`.
   `src/client/request.ts` explains the full mechanism in a comment (D35).
   `.claude/skills/run-agentic-dashboard/SKILL.md` never mentions any of
   this — confirmed via grep, zero real hits. Both this session and the
   reporting agent had to source-dive to find the token instead of just
   reading the printed line or a doc that mentions it.

6. **No one-command way to learn a running instance's workspace path.** Confirmed
   independently by both this session (had to `cat` the token file by hand
   after finding the workspace path some other way) and the reporting
   agent (had to cross-reference `playwright.config.ts` against the running
   process list).

7. Two more findings from the report, not yet verified against code, lower
   priority: no built-in preview/screenshot mechanism for a composed
   template (the report's author hand-rolled browser automation just to see
   the result), and a fresh git worktree has no `node_modules` — this last
   one is almost certainly Claude Code's `EnterWorktree` behavior, not
   something `agentic-dashboard`'s own code can fix, flagged in the report
   as possibly `driver.ts init`'s job but that's very likely the wrong layer.

## Correction to #101

The issue body as filed frames the composition problem as "no MCP-surfaced
discovery mechanism for the component library" and suggests investigating
"a richer tool description, an MCP resource, or a dedicated discovery tool."
That's still right for the _component_ half, but the original framing treated
the _styling_ half the same way — it isn't. Styling was already solvable via
`read-appearance` before this session started; the real gap there is
description wording, not new capability, and the actual visual flatness the
agent saw is a **separate, real bug in the theme system** (finding #2), not
an MCP problem at all. Whoever plans #101 should re-read its body with this
correction in mind rather than implementing its literal wording.

## Tool design decision (already made, don't re-litigate)

Went through the `mcp-server-dev:build-mcp-server` skill's Phase 1-3
interrogation this session. Settled:

- **Deployment model: unchanged.** Stays local stdio (`src/mcp/index.ts`).
  Remote/cloud access was explicitly considered and explicitly ruled out
  earlier this same session — don't re-raise it.
- **Tool pattern: stays one-tool-per-action.** 28 tools today, above the
  skill's own ~15 "comfortable" heuristic but nowhere near the "dozens to
  hundreds" range where search+execute earns its keep. No one complained
  about tool-list size; don't restructure what isn't broken.
- **Tools, not Resources, for the new discovery capability.** Per the
  skill's own decision table (`references/resources-and-prompts.md`):
  Resources are host-controlled ("the host decides what to pull into
  context"); we want the _agent_ to decide when to fetch component info,
  mid-composition, on its own schedule. That's tool territory. Also: no
  confirmed host in this project's actual usage (Claude Code via `.mcp.json`,
  or `driver.ts`) reliably auto-loads resources without being asked, so
  betting discoverability on a Resource is a bet on unconfirmed host
  behavior — a tool always works because the model chooses to call it.

(One earlier `WebFetch` this session, of `https://claude.com/docs/llms-full.txt`,
returned suspicious/likely-wrong content — mentioned a "Claude Science"
product and fabricated-looking specifics. Ignored; not used for any decision
above. Don't trust that fetch result if you see it referenced anywhere.)

## Plan (proposed this session, not yet implemented or approved for implementation — confirm before building)

1. **New tool `list-components`.** Export (or wrap) `componentSourceFiles()`
   from `codegen.ts`, extend it to return each component's full raw source
   text keyed by name, not just its filename. One call returns everything —
   ~11 files is small enough that a list+describe two-tool split isn't worth
   the round trip. Let the agent read real source the same way any of us
   would, rather than hand-building a parallel prop-schema catalog that can
   drift from the real components (exactly the failure mode D22 already
   avoids for validation).
2. **Description fixes on two existing tools** (cheap, high-leverage,
   do this regardless of what else lands):
   - `read-appearance`: make the description say outright that it returns
     the full available color-token set (`css`), not just "your appearance
     preference."
   - `assemble-card-template`: point at `list-components` and
     `read-appearance` up front, before describing the composition schema.
3. **Tool-surface cleanup** (from the earlier architecture review this
   session, Candidate 2 — already grilled and decided, just not yet built):
   move the personal-preset upsert/remove-by-id merge logic out of
   `mcp/server.ts`'s hand-written `upsertPersonalPreset` and into `contract`
   (alongside `presetSchema`, since `contract` is the React-free, shared-by-
   construction module per D6). `src/client/appearance-client.ts`'s
   `withPersonalPreset` and `mcp/server.ts` should both import the same
   function instead of each reimplementing the same filter-then-push rule.
   `mcp/server.ts` already has a `ponytail:` comment admitting this ceiling —
   this closes it.
4. **Doc fix**, `SKILL.md`: document the printed `?token=` startup URL and
   add a one-command way to get a running instance's workspace path + token
   (a small script or `driver.ts` subcommand — not yet designed, whoever
   picks this up should decide the shape).

## Open decision — needs the user, don't assume

**Split finding #2 (missing accent-color token) into its own issue, separate
from #101, or fold it into #101?** This was being asked directly when the
user redirected to requesting this handoff doc instead of answering — it is
genuinely unresolved. My recommendation, unchanged: split it out. It's a
real design-token gap with nothing to do with the MCP interface, and folding
it into #101 would make that issue's title ("Rework the MCP-agent interface")
misleading. But don't act on this recommendation without asking — ask first.

## Everything else already merged, don't redo

- The 15-of-28 table-driven MCP mutation tools (`mutationSchema.options` +
  `mutationToolDescriptors` in `mcp/server.ts`, `satisfies
Record<Mutation["type"], ...>` for compile-time exhaustiveness) — already
  implemented and merged to `main` (commit `38c2d73`, part of PR #100).
  Don't re-propose this refactor.
- Issue #97 (queries in one encrypted store) — already implemented, closed.
- Issue #98 (managed secrets service for hosted deployments) — already
  implemented and merged (`05756b2`, part of PR #100). Issue #99 tracks the
  follow-up (a reference shim for a real secrets vendor) — separate, still
  open, unrelated to this handoff.
