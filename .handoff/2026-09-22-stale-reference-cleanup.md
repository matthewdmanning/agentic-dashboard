# Stale reference cleanup — 2026-09-22

Source: repository scan for B1/B3/B4 gate labels and for stale or conflicting
references. Excluded from the scan: `src/`, `node_modules/`, `docs/test-drives/`,
`dist/`, `components/`, `active-agent-trials/`, `.agents/`, `.claude/`, `.codex/`.

Backup tag before the directory move: `backup/pre-tests-move-2026-09-22`.

## Round 1 — stale references and wrong paths

| #      | File                                                         | Change                                                                                                               |
| ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| F1     | `playwright.config.ts`                                       | Comment no longer names the deleted B1 and B3 specs. It states the one-worker reason in general terms.               |
| F2     | `docs/agents/rationale.json`                                 | D45 no longer names B1's acceptance check.                                                                           |
| F3     | `tsconfig.json`                                              | Removed `"exclude": ["e2e/fixtures"]` and its comment. The fixture directory was deleted in `44091b0`.               |
| F4     | `tsconfig.json`                                              | `include` now lists `tests`, which holds the specs after the move below.                                             |
| F5     | `dry-run/README.md`                                          | `src/registry/` corrected to `registry/`.                                                                            |
| F7     | `tests/e2e/theme.spec.ts`                                    | `styles.css` corrected to `src/index.css`.                                                                           |
| F8     | `scripts/audit-docs.ps1`                                     | Audit scope reduced to `docs/`. No `memory/` directory exists.                                                       |
| F9-F11 | `.github/pull_request_template.md`                           | Replaced the dead paths `src/service`, `src/contract` and `src/card-templates` with `src/dashboard` and `registry/`. |
| F12    | `.github/ISSUE_TEMPLATE/chore.md`                            | Removed the link to `TECH_DEBT.md`, which does not exist.                                                            |
| F16    | `docs/agents/registry-setup.md`                              | Aliases corrected to `@components` and `@components/ui`, matching `components.json`.                                 |
| F17    | `docs/agents/registry-setup.md`                              | `homepage` set to the GitHub URL and `@dashboard` set to `./public/r/{name}.json`.                                   |
| F18    | `docs/agents/registry-setup.md`                              | File `type` corrected to `registry:component`.                                                                       |
| F22    | `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md` | Retired term "Card templates" replaced by "Registry items (`registry/`)".                                            |

## Round 2 — decisions from Matthew

**F13 — restored.** `.handoff/2026-09-17-phase2-gate-gaps.md` was deleted by
accident. `git checkout` brought it back.

**F14 — test directories consolidated.** `.codex-tmp/` was already gone from
disk.

- `e2e/` moved to `tests/e2e/` with `git mv`.
- The leftover artifact directory `.dry-run/` moved to `tests/.dry-runs/`. Its
  three old workspaces were kept, not deleted.
- `dry-run/config.json` now writes to `tests/.dry-runs`, not `.codex-tmp/dry-runs`.
- `.gitignore`: `.codex-tmp/` removed, `.dry-run/` replaced by `tests/.dry-runs/`.
- Paths updated in `playwright.config.ts`, `vite.config.ts`, `package.json`,
  `tsconfig.json`, `tests/e2e/config.json`, `dry-run/workspace/README.md`, and
  every relative import inside `tests/e2e/`.
- The tracked source directory `dry-run/` stays at the repository root. Only the
  specs and the run artifacts moved.

**F15 — no change.** `registry/custom-card.tsx` is an example name. It is not
supposed to exist.

**F19 — closed by Matthew.** He removed the label. No file change here.

**F20 — `REBUILD-NOTES.md` deleted.** The router row in `AGENTS.md` and the
pointer in `docs/product-spec.md` are gone with it.

**F21 — one home per fact.** Rules applied: `ARCHITECTURE.md` carries behaviour
and no reason for a decision; `CONTEXT.md` carries project-specific vocabulary
only; `rationale.json` may restate, but must add information the other two do
not hold.

- `ARCHITECTURE.md` now owns the two-gate permission rule, stated as behaviour.
  The justification clauses were cut.
- `CONTEXT.md` lost both restatements of the rule. The "Data ownership" section
  keeps the definition and routes the rule to `ARCHITECTURE.md`.
- `rationale.json` D51 lost its long restatement of the same behaviour. It keeps
  the rejected alternatives and the note that the gate is built before it bites.

## Verified after the changes

- `npm run typecheck` — clean.
- `npx vitest run` — 54 tests pass in 5 files.
- `npx playwright test --list` — 11 tests collect in 4 files from `tests/e2e/`.
- `npm run format:check` — clean.

## Still open

- The rule "no reason for a decision in `ARCHITECTURE.md`" was applied to the
  permission paragraph only. Other sections still carry reasoning.
- F23 and F24 are verified.

## Round 3 — the deleted `REBUILD-NOTES.md` corrections

| Correction                                  | Outcome                                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menuColor` / `menuAccent` are real fields  | Dropped. They are custom fields in common use. The fields stay in `components.json`; no note is needed.                                                                          |
| `"style": "base-nova"` is valid             | Dropped. One value of its kind; not worth a note.                                                                                                                                |
| Per-user content does not contradict shadcn | Dropped. Not needed.                                                                                                                                                             |
| `${VAR}` resolves from environment          | No new entry. D47 already states that the configuration holds a name and never a secret. No resolver exists in `src/` yet, so the claim is specification, not current behaviour. |
| shadcn's auth examples are illustrations    | Kept. Folded into D47, which held the conclusion but not the evidence.                                                                                                           |

`REBUILD-NOTES.md` stays deleted. Its full text is at
`git show backup/pre-tests-move-2026-09-22:REBUILD-NOTES.md`.
