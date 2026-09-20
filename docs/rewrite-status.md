# shadcn rewrite — status

Implementation summary of the shadcn rebuild, kept current as Phase 2
progresses. Replaces `SHADCN_REWRITE_PLAN.md` (deleted 2026-09-17) — that
file's rationale, rejected alternatives, and one-time investigation notes are
in git history if needed; this file keeps only what still gates work.

**Status:** Phase 1 complete at `3be56b3`. Phase 2 in progress on
`feat/shadcn-rebuild` — `src/` and `e2e/` were rebuilt from the specs, the
registry-item + `meta.schema` contract is in place, and B1–B4 all pass:
B1/B3/B4 as e2e checks, B2 as `registry/contract.test.ts` (a `vitest` suite
that drives `tsc --noEmit` over isolated fixtures — a faster, more direct
proof of the schema-derived-props contract than a browser round-trip would
be). `checklist.spec.ts` is green too, once b3/b4 restore the shared
workspace dashboard after mutating it. `theme.spec.ts` still fails when run
after `dry-run.spec.ts`: the page's `#root` never mounts, following a
`504 (Outdated Optimize Dep)` on `react-dom` — Vite's dev-server dependency
optimizer re-running mid-suite and racing the navigation. Root cause
confirmed, fix not yet found.

## Acceptance criteria — B1 to B4

Phase 2 is not done until all four pass, judged from a **cold agent session**
with no prior context. Referenced by `e2e/b1-discovery.spec.ts`,
`registry/contract.test.ts`, `e2e/b3-new-tile.spec.ts`,
`e2e/b4-layout.spec.ts`.

| #      | Capability       | Passes when                                                                                                                                                                                                                                                         |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | Tile discovery   | An agent with **nothing installed locally and no copy of this repository** names every available tile and each one's required state keys, working only from what the MCP server sent on connect plus `shadcn search` / `view` against the dashboard's own registry. |
| **B2** | Authoring        | An agent adds a new tile by writing TSX plus a JSON Schema. `tsc --noEmit` passes. Deliberately mismatching the schema against the component's props makes it fail.                                                                                                 |
| **B3** | New tiles render | A tile added while the server is running renders after a browser reload, with no client rebuild and no restart.                                                                                                                                                     |
| **B4** | Layout           | "Put these two side by side" produces one row of two `md` tiles. "Make it full width" produces one `lg`. The result is visibly a grid, not a stack.                                                                                                                 |

## Non-negotiable, no shortcuts

1. The registry-item + `meta.schema` contract, with props derived from the schema — it is the interface every agent hits.
2. The `tsc --noEmit` gate, covering tile source, its schema pairing, and tile mappers alike.
3. Real layout primitives.

## In scope for Phase 2, and what is not

Phase 2's gate is B1–B4 and nothing else. `ARCHITECTURE.md` specifies
accounts, roles, the permission decision, credentials, connections,
integrations, queries, tile mappers, and the offline queue; none of them is
built in this phase. They stay specified and unbuilt until B1–B4 pass — do
not build past this gate without asking first.

## Working constraints

Standing instructions that still apply to Phase 2 work:

- Coding subagents must be **sonnet** models.
- **Review** a coding subagent's code before committing it.
- Give subagents context (file paths / links), instructions, and success criteria.
- If stuck or hitting repeated failures, **stop and ask** — propagate this instruction to subagents.
- **Docs and the code they describe ship in the same commit.** No docs-follow-up commits.
- Never spawn a general-purpose subagent unless the user's message contains the exact phrase "general-purpose".
- `CONTEXT.md` and `ARCHITECTURE.md` bind; `docs/agents/rationale.json` explains and does not bind; this file plans and does not bind.

**Gate before Phase 3** (screenshot harness comparing models on the new app): all four acceptance criteria pass.
