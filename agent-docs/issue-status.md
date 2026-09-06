# Issue status — 2026-09-06

Where #80–#96 stand on `feat-shadcn-ui`. Written from a session that committed
the first three; verify against `gh issue list` and the tree before trusting it.

`HANDOFF.md` and the untracked `implementation-status.md` are owned by another
session and were not touched.

## Closed by commits on this branch

None are closed on GitHub yet — `Closes #N` fires when the branch merges.

| Issue | Commit    | What landed                                                                                                                                                               |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #81   | `c261a64` | scrypt hashing, per-account salt, `timingSafeEqual`, `resolveCaller` returning user and role, hex path segments                                                           |
| #82   | `78ac1d0` | `activeCardTemplateManifest` as single source for client and registry, the `message` shadcn template, generated JSON Schema, initialization writing config/manifest/build |
| #87   | `285a914` | File-backed integration catalog with origin and state, seeded at init, connectable types read from it, recursive credential-key guard                                     |

Each commit typechecks and passes tests on its own: 109, 111, then 118 tests.

## Partly implemented, not closable

Code for these sits inside the three commits above, because it shares files with
what did land. Splitting it out means rewriting those commits.

- **#83** — atomic promotion. No build module, no candidate set, no promotion
  step. The manifest is a static object, not a promoted artifact.
- **#84** — schema-plus-composition assembly. `react-aria-components` is still
  in `package.json` and still what `codegen.ts` generates against.
- **#86** — card mappers. Nothing in `src/` uses the term; `formatter` is
  unchanged.
- **#88** — per-user connections. `credentials.ts` has no user dimension and no
  AES-256-GCM.
- **#90** — owner-scoped refresh. Depends on #85, #86, #88.
- **#94** — per-user base colour. Depends on #81's user identity, which now
  exists.

## No code yet

#80, #85, #89, #91, #92, #93, #95, #96.

#85 matters most: #86 and #90 are blocked on it, and #81's ownership and
path-encoding requirements have no consumer until per-user storage exists.

## Known trap

`npm run check` fails, and not because of the code. The `impl-notes` worktree
lives at `.claude/worktrees/impl-notes` inside the repository, so Prettier lints
its markdown and Vitest runs its stale test copies against current source — 5
phantom test failures, 9 phantom format warnings. Neither `.prettierignore` nor
the Vitest config excludes `.claude/`. Run
`npx vitest run --exclude '**/.claude/**'` for a true result until it is fixed.

## Uncommitted

- `.gitignore` plus 15 staged deletions untracking `.claude/skills/shadcn`,
  keeping `run-agentic-dashboard` tracked via a negation pattern.
- `skills-lock.json`, 102 added lines from a `/skills` run.
- `implementation-status.md`, untracked, from another session.

## Recovery

`refs/backup/pre-issue-commits` (`3b4029e`) holds the pre-commit index and
working tree. It excludes untracked files, which were copied separately to the
session's scratch directory — the two together are the full restore.
