# Issue status — 2026-09-06

Where #80–#96 stand on `feat-shadcn-ui`. Verify against `gh issue list` and the
tree before trusting it.

`HANDOFF.md` and the untracked `implementation-status.md` are owned by another
session and were not touched. `HANDOFF.md` currently shows as deleted in
`git status`; that deletion is not mine and was not committed.

## Landed and pushed

`origin/feat-shadcn-ui` is at `53642ca`. Nothing here is closed on GitHub yet —
`Closes #N` fires when the branch merges.

| Issue | Commit    | What landed                                                                                                                 |
| ----- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| #81   | `c261a64` | scrypt hashing, per-account salt, `timingSafeEqual`, `resolveCaller` returning user and role, hex path segments             |
| #82   | `78ac1d0` | `activeCardTemplateManifest` as single source for client and registry, the `message` shadcn template, generated JSON Schema |
| #87   | `285a914` | File-backed integration catalog with origin and state, seeded at init, connectable types read from it                       |

Two chores also landed: `ea29dd9` untracks the per-machine shadcn skill pack,
`53642ca` excludes `.claude/` from Prettier and Vitest.

That second one matters. A worktree checked out at `.claude/worktrees/impl-notes`
is inside the repository, so Prettier linted its markdown and Vitest collected
its stale test copies and ran them against current source — five failures and
nine warnings that said nothing about this tree. `npm run check` is now clean
except for one Prettier warning on `implementation-status.md`, which belongs to
another session and was deliberately left unformatted.

## In flight: #83

A sonnet subagent is mid-task. **Its work is uncommitted and unreviewed.** If it
did not finish, the working tree holds a partial consolidation.

What it built first, and what was wrong with it:

- Added `src/card-templates/build.ts` — `promoteCardTemplates(candidates, paths)`
  doing duplicate-name validation, `z.fromJSONSchema` schema compilation, a real
  `tsc --noEmit` against real shadcn types, then writing `manifest.json` and
  `client-build.json`. Four tests, all suites green at 122.
- It duplicated machinery that already existed. `src/service/index.ts` has
  `checkCardTemplateSource` and `typeChecks` doing candidate type-checking and
  temp-then-rename promotion for `assemble-card-template`. #83's first
  requirement is that **one** module own this, so the diff as written made two.
- Its `tsc` runner used the OS temp directory and had to null out
  `types`/`typeRoots` to compensate. The service's version writes its scratch
  tsconfig under `.local/` inside the repo on purpose, so `tsc`'s upward
  `node_modules/@types` search resolves — and says so in a comment the subagent
  did not read.
- Promotion was not atomic: two independent `writeJsonAtomic` calls, so the
  manifest could land while the client build failed.

It was sent back to consolidate: move the `.local/` approach into `build.ts`,
delete the service's two functions, give `build.ts` a two-phase interface so the
service keeps its batch rollback, do one build per mutation batch rather than one
per mutation, fix the two-rename gap, and preserve the existing `ServiceFailure`
names.

Pre-consolidation copies of all six affected files are in this session's scratch
directory. They are outside the repository and will not survive the job being
deleted — if that work is wanted, recover it before then.

## Not started

#84, #85, #86, #88 through #96. #80 is out of scope by instruction.

#85 is the one that matters most: #86 and #90 are blocked on it, and #81's
ownership and path-encoding requirements have no consumer until per-user storage
exists.

Note that `assemble-card-template` already partly exists in `src/service/index.ts`
with composition-tree tests in `src/service/index.test.ts`, so #84 is further
along than "not started" suggests — check before planning it.

## Next session

1. Review whatever the #83 agent left, against the six directives above.
2. Commit #83 with `Closes #83`, push.
3. Continue in issue order to #96.

Each issue has been getting its own sonnet subagent, spawned with an explicit
read list — the issue body, `CONTEXT.md`, `ARCHITECTURE.md`, the relevant
decisions, the matching section of `agent-docs/implementation-spec.md`, and the
existing code it must not duplicate. That last item is what the first #83 attempt
was missing.

## Recovery

`refs/backup/pre-issue-commits` (`3b4029e`) holds the pre-commit index and working
tree from before #81/#82/#87 were split into commits.
