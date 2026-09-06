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

## Decisions settled on 2026-09-06

- Project initialization generates the default shadcn/ui templates. Afterward,
  an `admin` can assemble a complete template from a mandatory JSON Schema and
  composition tree. The rebuild is atomic and becomes visible on reload, never
  as a hot update (D22, D37, D39).
- Hand-written templates are source changes governed by repository access and
  review, not application roles.
- Removing a referenced card mapper returns `in-use`; it never cascades into
  private queries (D38).
- Settings does not manage card mappers. It manages connections, shared themes,
  user appearance, and administrator integration policy.
- A file-backed integration catalog retains unused dynamic entries for a
  configurable 30-day default. Administrators may block entries or override a
  high-level dependency warning to remove them; affected users receive
  persistent notices (D40).

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

**Start with Phase 1.** It depends on nothing else and ends with an initialized
dashboard that renders a generated shadcn card template plus an admin assembly
path whose atomic rebuild becomes active on reload.

Phase 2 (user identity, queries in user data, the card mapper store, credential
storage) must precede Phase 3 (per-user appearance), because everything in
Phase 3 is keyed to a user that does not exist in the code yet.
