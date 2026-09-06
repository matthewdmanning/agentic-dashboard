# Issue status — 2026-09-06

Where #80–#96 stand on `feat-shadcn-ui`. Verify against `gh issue list` and the
tree before trusting it.

`HANDOFF.md` and the untracked `implementation-status.md` belong to another
session and were not touched. `HANDOFF.md` shows as deleted in `git status`;
that deletion is not mine and was not committed.

## Landed and pushed

`origin/feat-shadcn-ui` is at `e2ea73a`. Nothing is closed on GitHub yet —
`Closes #N` fires when the branch merges.

| Issue | Commit    | What landed                                                                                                                 |
| ----- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| #81   | `c261a64` | scrypt hashing, per-account salt, `timingSafeEqual`, `resolveCaller` returning user and role, hex path segments             |
| #82   | `78ac1d0` | `activeCardTemplateManifest` as single source for client and registry, the `message` shadcn template, generated JSON Schema |
| #87   | `285a914` | File-backed integration catalog with origin and state, seeded at init, connectable types read from it                       |
| #83   | `e2ea73a` | `src/card-templates/build.ts` owns validation, schema compilation, type-checking, and atomic promotion                      |

Two chores also landed. `ea29dd9` untracks the per-machine shadcn skill pack.
`53642ca` excludes `.claude/` from Prettier and Vitest — a worktree checked out
at `.claude/worktrees/impl-notes` sits inside the repository, so Prettier linted
its markdown and Vitest ran its stale test copies against current source, giving
five failures and nine warnings that said nothing about this tree.

`npm run check` is clean except one Prettier warning on
`implementation-status.md`, deliberately left unformatted because it is another
session's file. 124 tests pass.

## What #83 actually did

The first attempt added `build.ts` alongside `checkCardTemplateSource` and
`typeChecks`, which already did candidate type-checking and temp-then-rename
promotion inside `src/service/index.ts`. Since #83's first requirement is that
**one** module own this, that diff was sent back. What landed:

- `typecheckCardTemplateSources(sources)` is the shared primitive. One scoped
  `tsc --noEmit` over the whole batch, returning a prepared set with
  `commit()`/`discard()` so the service keeps its batch rollback.
- The service's two functions are deleted, not wrapped. It now calls
  `prepareAssembledCardTemplates` once per batch.
- A batch costs one build, not one per mutation.
- Promotion writes both temp files before either rename, so a half-promoted
  generation has no window to exist in.
- The scoped tsconfig lives under `.local/` — inside the repo so `tsc`'s upward
  `node_modules/@types` search resolves, gitignored so a crash can't strand a
  config file where a broad `git add` finds it.

Two behaviours changed that no test covered, both judged acceptable:

- A batch type-check failure now names every template in the batch rather than
  the one that failed, and appends raw `tsc` output to the message. The
  `ServiceFailure` name `invalid-composition` is unchanged, and that name is
  what the architecture says callers may depend on.
- `promoteCardTemplates` stages its check files under `.local/` rather than at
  `clientSourcePath`. A scratch file inside `src/` raced any full-project `tsc`
  run globbing `src/**`, which surfaced as intermittent `TS6053` under parallel
  Vitest workers.

## Two gaps #83 left open

Neither blocks the issue's acceptance criteria, both matter for whoever picks up
#84.

1. **Nothing reads the promoted artifacts.** `registry.ts` and
   `src/client/cards/index.ts` still read the static `activeCardTemplateManifest`
   object in source. The promoted `manifest.json` and `client-build.json` are
   written and never loaded, so promotion is real but currently unobserved.
   `ARCHITECTURE.md` says the registry endpoint and `CardView` both use the
   active manifest; today they use a source literal that happens to match it.
2. **Assembled templates land in tracked source.** `assemble-card-template`
   renames its `.tsx` into `src/client/cards/`. `ARCHITECTURE.md` says active
   builds live at configurable paths outside `src/`. Pre-existing, not
   introduced by #83.

## Not started

#84, #85, #86, #88 through #96. #80 is out of scope by instruction.

#85 matters most: #86 and #90 are blocked on it, and #81's ownership and
path-encoding requirements have no consumer until per-user storage exists.

#84 is further along than "not started" suggests — `assemble-card-template`
already exists in `src/service/index.ts` with composition-tree tests in
`src/service/index.test.ts`. Check what is there before planning it. The two
gaps above are its natural scope.

## How this has been running

Each issue gets a sonnet subagent spawned with an explicit read list: the issue
body, `CONTEXT.md`, `ARCHITECTURE.md`, the relevant decisions, the matching
section of `agent-docs/implementation-spec.md`, and **the existing code it must
not duplicate**. That last item is what the first #83 attempt was missing, and
naming it is the difference between a consolidation and a second copy.

Review the diff before committing. Both #83 attempts passed every check while
the first one failed the issue's central requirement.

## Recovery

`refs/backup/pre-issue-commits` (`3b4029e`) holds the pre-commit index and
working tree from before #81/#82/#87 were split into commits.
