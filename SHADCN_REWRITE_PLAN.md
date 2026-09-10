# shadcn Rewrite Plan — agentic-dashboard

**Date:** 2026-09-09, updated 2026-09-10
**Repo:** `C:\GitHub\agentic-dashboard` (branch `docs-shadcn-vocabulary-repair`)
**Status:** Phase 1 complete at `3be56b3`. Phase 2 not started.
**Authoritative vocabulary source:** <https://ui.shadcn.com/llms.txt> and the pages it indexes.

---

# Part 1 — The plan

**One lane: rebuild.** The current repo becomes reference material. It is not patched, not run, not maintained, and its test suite is not kept green.

## Phase 1 — Repair the specs — **COMPLETE** (`3be56b3`)

The specs are the deliverable the build agent consumes. Every error in them compounds across every model that reads them.

**Vocabulary.** V1–V6 and N1 struck: they corrected the project's definitions of shadcn's terms, and those definitions were deleted instead. A corrected duplicate is still a duplicate. D44 is the rule now — define no term shadcn defines, contradict nothing shadcn documents, give no second name to a meaning shadcn already has. `card` → `tile`, `card mapper` → `tile mapper`, `card template` → gone.

**Deleted from the spec.** The bespoke manifest format, the bespoke appearance vocabulary, the composition-tree assembly interface, the module map, and six terms shadcn owns.

**Now specified.** `registry.json` as the on-disk source of truth; each tile's JSON Schema in the registry item's `meta`, with the component's props type derived from it; shadcn preset codes for appearance; per-user appearance as a personalized theme item; `size: sm | md | lg` for placement; `${NAME}` credential references resolved per acting account; four permission categories behind one decision; `apply` reporting applied or queued; reads naming what they withheld.

**Repo shape.** One package, npm, no workspaces, one project-root `components.json`. Monorepo rejected — see alternative 7.

See `REBUILD-NOTES.md` for the renames, the corrections not to revert, and what the old definitions got wrong. Delete that file when Phase 2 lands.

## Phase 2 — Build

**Where: this repo, on a branch off `docs-shadcn-vocabulary-repair`. Its first commit deletes `src/` and `e2e/` — 81 tracked files.**

Not a new repository. This one carries 69 closed issues, CI configuration, the vendored shadcn Agent Skill, and the specs themselves; a fresh repo throws all of that away to avoid a contamination risk that `REBUILD-NOTES.md` already handles. Git keeps the deleted code recoverable, so the deletion is reversible and the working tree is clean from commit one.

Do not reintroduce root-level `globals-example.css` (see N2), and do not carry forward anything in the deletion table in `REBUILD-NOTES.md`.

### Shape

- One package on npm. `aliases.ui` and `aliases.components` already route base components and blocks to separate targets, so the CLI decides placement without a workspace boundary.
- shadcn's Agent Skill gives every model identical instructions. `skills-lock.json` pins it by content hash; the content itself is per-machine and gitignored, so a fresh clone restores it with `npm run skills:install`. Pinned, not vendored — the distinction matters, because a clone without that step has no skill at all.
- Own registry registered in `components.json`; discovery comes from `shadcn search` / `view` / `add`, not a bespoke tool.
- Project MCP server shrinks to what shadcn cannot do: tile placement and tile data. A few tools, not ~28.

### Acceptance criteria — B1 to B4

Each of the four breaks in section B gets a check that fails today. Phase 2 is not done until all four pass, judged from a **cold agent session** with no prior context.

| #      | Capability       | Passes when                                                                                                                                                                                                                                                         |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | Tile discovery   | An agent with **nothing installed locally and no copy of this repository** names every available tile and each one's required state keys, working only from what the MCP server sent on connect plus `shadcn search` / `view` against the dashboard's own registry. |
| **B2** | Authoring        | An agent adds a new tile by writing TSX plus a JSON Schema. `tsc --noEmit` passes. Deliberately mismatching the schema against the component's props makes it fail.                                                                                                 |
| **B3** | New tiles render | A tile added while the server is running renders after a browser reload, with no client rebuild and no restart.                                                                                                                                                     |
| **B4** | Layout           | "Put these two side by side" produces one row of two `md` tiles. "Make it full width" produces one `lg`. The result is visibly a grid, not a stack.                                                                                                                 |

### Non-negotiable, no shortcuts

1. The registry-item + `meta.schema` contract, with props derived from the schema — it is the interface every agent hits.
2. The `tsc --noEmit` gate, covering tile source, its schema pairing, and tile mappers alike.
3. Real layout primitives.

## Phase 3 — Screenshot harness

Same request, N models, Playwright screenshots, presented side by side for **human** judgement. Compares model against model on the new app. No automated pass/fail, no CI gate, no comparison against the old app.

---

# Part 2 — Rationale

## A. The product definition that governs every decision

The product is: **a user creates a dashboard with the help of any AI agent, with minimum variance between models.** The implementation is irrelevant to product value — a novel mechanism is not a feature.

Two consequences that reorder everything:

1. **Vocabulary conformance is the product, not tidiness.** A coined term forces an agent to read project docs, and reading comprehension is exactly where model variance is worst. A shadcn term is already in every model's weights. `menuAccent` vs `--sidebar-accent` is a variance question, not a correctness one.
2. **Variance is judged by the human eye and cannot be automated with high fidelity.** Different compositions produce very similar appearances, so structural diffing measures the wrong variable.

## B. Fatal flaws in the current repo — the core loop is open

The project cannot generate any dashboard. Four independent breaks, each sufficient on its own. Evidence in `src/mcp/server.ts`; restated for the rebuild in `REBUILD-NOTES.md`. Written in the old vocabulary, since they describe the code being replaced.

- **B1. No template discovery.** `add-card` requires a template name plus `state` matching that template's schema. No tool lets an agent learn either. `read-dashboard` reads cards, not templates; no tool reads the manifest. `assemble-card-template` writes a template the agent can never find again.
- **B2. `assemble-card-template` asks for a format with no reference.** It wants a composition tree of shadcn components, but nothing tells the agent what props any component accepts.
- **B3. Assembled templates never render.** `CardView` renders from a compile-time map that nothing rebuilds from the promoted manifest.
- **B4. Layout is one-dimensional.** `insert-card` takes only `cardId` and `index`. No size, span, or grid. Best possible output is a single-column stack.

## C. Misallocated surface

~28 MCP tools. **18 are appearance, presets, themes, and integrations** — all things shadcn does better or that do not block dashboard generation. The part that puts a card on a dashboard is the part that is broken.

269 tests pass against a product that cannot do its one job. The suite validates infrastructure, not outcome.

## D. Duplicated infrastructure

The project maintains a second copy of structures shadcn defines and builds:

| shadcn                       | project's copy                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `registry-item.json`         | `CardTemplateManifestEntry`, `PromotedCardTemplateManifestEntry`, local `RegistryItem` interface |
| `registry.json`              | `activeCardTemplateManifest` + promoted `manifest.json`                                          |
| `shadcn build`               | `card-templates/build.ts` staging + promotion + `clientBuild`                                    |
| serve built file             | `buildRegistryIndex` / `buildRegistryItem` / regex `deriveDependencies` at request time          |
| `registry:theme` + `cssVars` | `server/appearance.ts` hand-copied Tailwind oklch palette + `presetTokens`                       |
| preset codes                 | `globals-example.css`-format "presets"                                                           |

Also: `type: "registry:block"` is hard-coded for single-file templates, where shadcn's own definition makes those `registry:component`.

## E. Over-built for a problem not yet reached

Five permission categories × four levels, roles in an imported source file, per-user encrypted credentials, 90-day key rotation with per-secret key naming, retention policy, offline mutation queue, atomic two-phase promotion. All built before the product could produce a single dashboard. This is the overrun, and any approach that keeps the code keeps the overrun.

Multi-user is genuinely in scope — but shadcn's registry-auth example (bearer token, env-var credential, per-user response, 401/403) is far lighter than the existing matrix. That boundary matters: shadcn's registry auth secures **who may fetch registry items**; it does not define **who may mutate a dashboard**. The pattern transfers; the weight does not.

## F. Rejected alternatives

| #   | Alternative                                                                                   | Why rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Restructure / incremental fix**                                                             | The approach that put the project 400% over time and cost. Preserves the parts that were never the bottleneck. Was recommended earlier in the session on a diff-size argument; that priced the wrong thing.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | **Collapse the manifest into `registry.json` + `meta.schema` on the current codebase**        | Priced at 4 non-test files and ~40 test assertions (see section H for the full trace). Correct as a change, but it fixes a symptom in an app that still cannot generate a dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | **Keep the composition-tree assembly interface**                                              | It is a bespoke interface no model has seen, so every model must learn it from docs — the exact source of variance the product exists to minimise. Models already have heavy exposure to writing TSX against shadcn. The `tsc --noEmit` gate is the valuable half and survives; the tree is the liability. Novelty here was mistaken for value earlier in the session.                                                                                                                                                                                                                                                            |
| 4   | **Automated model-variance eval in CI**                                                       | Measures the wrong variable. Different compositions yield very similar appearances. Human eye only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | **Patch the current app to produce a screenshot baseline for comparison against the rebuild** | Impossible, not merely wasteful: the current app cannot generate a dashboard (B1–B4), so it can produce no artifact to compare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | **Single-user v1, defer multi-user**                                                          | Rejected by the user. Multi-agent and multi-user are in scope, and shadcn's auth documentation gives the build agent a worked example.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | **Monorepo, two `components.json`**                                                           | Rejected. Its claimed benefit — the CLI deciding placement — already exists in a single package, where `aliases.ui` and `aliases.components` are separate targets. What it adds is cost: `@workspace/ui/...` is a far rarer import shape than `@/components/ui/...`, which raises inter-model variance, the one thing the product minimises. Plus two files whose `style`, `iconLibrary`, `baseColor`, and aliases must stay in sync, npm workspaces, and Turborepo — for one consumer. Revisit if a second app appears. `package.json#imports` is not an alternative to any of this; it is an alias mechanism inside a monorepo. |

## G. What is discarded, what carries forward

**Discarded (real, stated plainly):** scrypt auth, encryption at rest, 90-day key rotation, retention policy, atomic promotion, 269 passing tests. None is on the path to generating a dashboard; all are described in the specs and re-derivable when a user needs them.

**Carries forward:** the specs, the vocabulary corrections, the four named breaks. Agent time is cheap; specification work is the expensive artifact. That is the whole basis for discarding code and keeping documents.

---

# Part 3 — Facts already verified (do not re-derive)

Sources: shadcn doc pages fetched directly, plus the packaged `shadcn` skill, which injects live project context from `shadcn info`.

## Confirmed corrections — DO NOT REVERT

- **`menuColor` and `menuAccent` ARE real shadcn fields.** The CLI's own `info` output for this project reports them as parsed config, and `preset.values` includes both. **Context7's shadcn snapshot does not carry them and will suggest otherwise — it is stale on this point.** An earlier session concluded they were invented and shipped commit `99d8307` on that basis. The packaged skill is the better source here.
  - **Moot.** The enum-range question is closed by deletion: the project no longer defines `menuColours` or `menuAccents`, so their ranges are shadcn's business. `preset decode b2fA` was run and returns the values in use, not the ranges — it could never have settled it. Field names confirmed a second way.
- **`"style": "base-nova"` is valid.** Appears verbatim in the CLI reference (`init --preset base-nova`). It is base (`base`) + style (`nova`). A fetch of `/docs/cli` claimed otherwise; that answer was incomplete.

## Current project config (from `shadcn info`)

- Framework Vite, Tailwind v4, TypeScript, `rsc: false`, import alias `@`
- `style: base-nova`, `base: base`, `iconLibrary: lucide`, `rtl: false`
- Preset code `b2fA` → `style: nova`, `baseColor: neutral`, `theme: neutral`, `chartColor: neutral`, `font: geist`, `fontHeading: inherit`, `radius: default`, `menuAccent: subtle`, `menuColor: default`
- Installed components (11): alert, badge, button, card, field, input, label, select, separator, table, textarea
- `registries` resolves to only the `@shadcn` default — the project's own `/r/` is **not** registered

## Open items — none

**N2 — global-CSS mis-detection. CONFIRMED, 2026-09-10.** `shadcn info` reports `project.tailwindCss: globals-example.css` while `resolvedPaths.tailwindCss` is `C:\GitHub\agentic-dashboard\src\styles.css` — two different files. The 4,224-byte `globals-example.css` at the repo root was being detected as the project's global stylesheet, so `apply --only theme` would have written to the wrong file. **Deleted 2026-09-10.**

**Action for Phase 2: no `globals-example.css` at the repo root.** If an example stylesheet is wanted, it goes in `docs/` under a name the CLI will not mistake for the real one.

## H. Caller trace (already performed, reference only)

A read-only trace of every consumer of the five duplicated files was completed. Summary:

- Non-test consumers outside those five files: **4** — `src/service/index.ts`, `src/server/index.ts`, `src/scripts/init-dashboard.ts`, `src/test-support/card-template.ts`.
- Test assertions coupled to the bespoke format: **~40** — `server/registry.test.ts` ~19 (whole file), `card-templates/build.test.ts` ~13 of 17, `card-templates/manifest.test.ts` 4 of 6, `service/index.test.ts` ~4.
- Untouched by a format change: `server/index.test.ts` 0/51, `mcp/server.test.ts` 0/21, `contract/index.test.ts` 0, `codegen*.test.ts` 0, `e2e/**` 0.
- **One consumer JSON alone cannot satisfy:** `src/client/cards/CardView.tsx:30-31` calls `schema.safeParse(state)` — a live Zod `ZodType` in the browser bundle, sourced from the compiled-in manifest. JSON Schema in `meta` does not `safeParse`. Any design must either ship `z.fromJSONSchema` to the browser (unmeasured bundle cost) or validate elsewhere. **This bill is already owed by the assembled-template feature regardless of the registry design** — it is precisely why B3 exists.

## Files not read (claims about them are unverified)

- `src/client/Settings.tsx` (686 lines) — never opened
- `src/contract/index.ts` — read ~95 of 891 lines
- `src/server/appearance.ts` — read 120 of 511 lines
- `https://ui.shadcn.com/docs/registry/getting-started`, `/registry/examples`, `/registry/namespace`, `/docs/mcp`, `/docs/skills`

---

# Part 4 — Working constraints

Standing instructions from the user this session:

- Coding subagents must be **sonnet** models.
- **Review** a coding subagent's code before committing it.
- Give subagents context (file paths / links), instructions, and success criteria.
- Agents should prefer the **Context7 MCP** for library docs — **except** where the packaged `shadcn` skill contradicts it (see the `menuColor` note above).
- If stuck or hitting repeated failures, **stop and ask** — propagate this instruction to subagents.
- **Docs and the code they describe ship in the same commit.** No docs-follow-up commits.
- Reuse a subagent for further issues while it is under 20% context; ask only when it finishes its assigned issue.
- Never spawn a general-purpose subagent unless the user's message contains the exact phrase "general-purpose".
- **The specs are authoritative again as of `3be56b3`.** The "project docs are not authoritative" rule was scoped to the Phase 1 rewrite and is now lifted. `CONTEXT.md` and `ARCHITECTURE.md` bind; `docs/agents/rationale.json` explains and does not bind; this file plans and does not bind.

## Repo state

- Branch `docs-shadcn-vocabulary-repair` at `3be56b3`, working tree clean. `main` at `4fb5d11`, matching `origin/main`.
- `src/` and `e2e/` hold 81 tracked files that Phase 2 deletes. The suite still passes; it is not kept green from here.
- Root `globals-example.css` deleted (N2). `.vscode/settings.json` and `.codex/environments/environment.toml` untracked; both were tracked despite `.gitignore` naming them. Two stale worktrees removed from `.claude/worktrees/`; branches `worktree-impl-notes` (`bb96b00`) and `worktree-task-list-card` (`3be6a0c`) keep their commits.
- **All open GitHub issues were deleted** at the user's instruction (#80, #99, #104, #105, #106, #107, #108). 69 closed issues remain untouched.
- Backups: `C:\Users\mattm\.claude\plans\issue-backup-2026-09-09\` — one JSON per deleted issue with full body, plus `issues.json` holding all 76.
- `.handoff/` is empty. Three notes were deleted 2026-09-10: a superseded registry-architecture handoff, a review of code being removed, and two security follow-ups made moot by D47 (recorded in `REBUILD-NOTES.md`).

---

# Part 5 — Suggested skills

Call these with the Skill tool:

- **`shadcn`** — call first, before any shadcn work. It injects live project context (`shadcn info` output: config, preset code, installed components, resolved paths) plus the critical composition and styling rules. It is a better source than Context7 for shadcn config fields.
- **`domain-modeling`** — to keep `CONTEXT.md` and `docs/agents/rationale.json` current as Phase 2 decisions land. A new term or a changed meaning is a same-commit edit, never a follow-up.
- **`codebase-design`** — deep-module vocabulary (module / interface / implementation / depth / seam / adapter) for the Phase 2 interface design, particularly the registry-item + `meta.schema` contract.
- **`research`** — if the unread shadcn pages (registry namespace, getting-started, examples, `/docs/mcp`, `/docs/skills`) need gathering into a repo file.
- **`grilling`** — before committing to the Phase 2 tree layout, if the user wants it stress-tested.

Do **not** reach for `ponytail` on this work. The user explicitly rejected minimum-diff reasoning here: cheap now is more expensive later, and the three non-negotiables in Phase 2 are to be built properly.

---

# Part 6 — First actions for Phase 2

Phase 1 is complete and both open verifications are resolved. Nothing is left to decide before building.

1. Call the `shadcn` skill to load live project context.
2. Read `CONTEXT.md`, then `ARCHITECTURE.md`, then `REBUILD-NOTES.md` — in that order. The first two bind; the third only stops you being misled by code that is about to be deleted.
3. Branch off `docs-shadcn-vocabulary-repair`. First commit deletes `src/` and `e2e/`. Git holds the old tree; nothing is lost.
   **CI goes red at that commit and stays red until the app builds again** — `on: push` has no branch filter, so `validate` runs `typecheck` and `test` against a tree with neither. That is expected and left alone: the suite is not kept green, red is honest signal, and this branch is nowhere near `main`.
4. `npx shadcn@latest init` against the existing `components.json` — preset `b2fA`, Vite, one package, no `--monorepo`.
5. Build toward B1 first. Nothing else can be demonstrated until an agent can discover a tile and its schema.
6. Each of B1–B4 gets its check written before the capability, and each check is run from a cold agent session.

**Gate before Phase 3:** all four acceptance criteria pass. The screenshot harness compares models against each other on the new app; it needs an app that produces a dashboard first.
