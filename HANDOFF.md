# Handoff — 2026-09-05

Where this branch (`feat-shadcn-ui`) stands, and what the next session picks up.
Everything below is pushed; the working tree is clean, typecheck passes, 104 unit
tests and 2 browser tests pass.

## Landed

- **Renamed** the project to `agentic-dashboard` — package, lock, registry name
  and homepage, MCP driver skill, codex environment, GitHub repository.
  `react-aria` no longer described what this is.
- **Deleted** `examples/`, `audit-backup/`, `undefined/`, and the emptied
  `templates/`. All were tracked, so all are recoverable from history.
- **Renamed roles** to `localUser` and `unauthenticatedUser`, and the bottom
  permission level from `none` to `noAccess`. There was no TypeScript clash;
  `none` read as an absence rather than a level and sat one word from the
  permission-less role.
- **Recorded D36, D37, D38** — card templates are registry items in shadcn's
  vocabulary; adding one takes `cards: write`, held by `admin`; `formatter`
  becomes `cardMapper`, living in a shared store cards reference by name.
- **Rewrote the decisions document** to state only what is in force. Superseded
  reasoning is deleted rather than annotated — git holds the record, and a
  contributor should not have to reconstruct today's truth from what was once
  thought. D5, D7, D12, and D17 were withdrawn; numbers are stable and never
  reused, so the gaps are the signal and old references still resolve.
- **Restored CI on pull requests**, off since the architecture rewrite (#57),
  and added browser checks as a separate job that stays off the PR lane.

## Needs a decision — not an edit

Found by auditing D1–D38 against each other. Each is a real gap, not stale text.

1. **D37's `cards: write` cannot be enforced on the hand-written path.** The one
   enforcement point (D4) sees service calls; a hand-written card template
   arrives by editing source, where nothing consults a permission bundle. The
   decision reads as an enforced gate but is policy for half its scope.
   Underneath it: no door exists for a hand-authored registry item to enter a
   _running_ dashboard — the service can only assemble one from a composition
   tree.
2. **D38 does not say what happens when a referenced card mapper is deleted.**
   The service's failure vocabulary already carries "something still in use".
   Refuse, or cascade?
3. **Whether Settings reaches card mappers.** It manages integrations, themes,
   and a user's own appearance. A user writing a mapper has no human screen.

## Known drift, deliberately untouched

- **`agent-docs/personal-dashboard-product-spec.md` is stale and unrouted.** It
  still requires font scaling (deleted, D33), wiring (deleted, D11), and agent
  permissions in Settings (withdrawn, D19); still lists the authentication
  mechanism as open (settled, D35); and still says local-only access needs no
  authentication, which D35 reverses — another OS account on the host gets
  nothing without the token. `AGENTS.md` does not link it, so an agent following
  the router never reads the product requirements. Left alone because the router
  pruning was deliberate and this file's status is yours to decide.
- **The client violates D36.** `src/client/App.tsx` and `src/client/Settings.tsx`
  render raw `<main>`, `<section>`, `<h2>`, `<p>`, `<button>`, `<details>`, and
  `<select>`. That is the view-module rewrite, not a patch. The browser tests
  assert on `getByRole("button", { name: "Refresh" })` and `role="alert"`, which
  survive it.

## Next work

[`agent-docs/implementation-spec.md`](agent-docs/implementation-spec.md) is the
phased plan for everything D22–D38 decided and the tree has not caught up with.

**Start with Phase 1.** It depends on nothing else and ends with a dashboard that
renders something: the assembler emits registry items, `react-aria-components`
leaves `package.json` and the generated source, and the first hand-written shadcn
card template lands. Zero are wired in today.

Phase 2 (user identity, queries in user data, the card mapper store, credential
storage) must precede Phase 3 (per-user appearance), because everything in
Phase 3 is keyed to a user that does not exist in the code yet.

## One operational note

The local checkout is still `C:\GitHub\react-aria-dashboard`. If you rename it,
rename the Claude memory directory `C--GitHub-react-aria-dashboard` in the same
move, and do it between sessions — project memory is keyed to the absolute path.
