# Phase 2 gate gaps — status after this pass

## 1. B2 — was never actually missing

`registry/contract.test.ts` (a `vitest` suite, run by `npm test`) already
drives `tsc --noEmit` over isolated fixtures and proves the schema-derived-
props contract both ways: agreement typechecks clean, an added/removed/
mistyped prop fails and names the offending key. It satisfies B2's
acceptance criteria directly — no browser or dev server needed. The earlier
read only checked `e2e/` for a `b2-*.spec.ts` and missed it. Nothing to add;
`docs/rewrite-status.md` now names this file as B2's reference.

## 2. `checklist.spec.ts` — fixed

Two stacked bugs, both fixed:

- Registry-404 timing: added `e2e/support/registry.ts`
  (`waitForRegistryReady`), used by `checklist.spec.ts` and `theme.spec.ts`
  before `page.goto`, same pattern `b3-new-tile.spec.ts` already used.
- Once that stopped masking it: `b3-new-tile.spec.ts` and `b4-layout.spec.ts`
  both clear the shared workspace `dashboard.json` to drive their own tests
  but never restored the fixture's original tiles (reading-queue included)
  afterward — so whichever spec ran after them inherited an empty or
  leftover dashboard. Added `e2e/support/dashboard.ts`
  (`snapshotDashboard`/`clearDashboard`/`restoreDashboard`); both specs now
  snapshot the original dashboard in `beforeAll` and restore it in
  `afterAll`.

Full suite: `checklist.spec.ts` passes now, in isolation and in the full run.

## 3. `theme.spec.ts` — root cause confirmed, fix not yet found

Order-dependent: passes alone, fails only after `dry-run.spec.ts` runs first.
Captured the actual page state on failure — `<div id="root"></div>` never
gets content. Browser console shows why:

```
504 (Outdated Optimize Dep) — .../node_modules/.vite/deps/react-dom_client.js?v=...
504 (Outdated Optimize Dep) — .../node_modules/.vite/deps/react_jsx-dev-runtime.js?v=...
```

Vite's dev-server dependency optimizer re-runs mid-suite (triggered by
something `dry-run.spec.ts` does — it spawns several of its own
`src/server/index.ts` instances, each its own Vite dev server rooted at the
same repo), and the re-optimization's hash bump races the main server's
in-flight `page.goto("/")`: the HTML is served referencing dep URLs that get
invalidated before the browser fetches them, so `react-dom` 404s/504s and
`main.tsx` never mounts. The `/@vite/client` HMR socket connects too late to
receive the auto-reload event that would normally recover from this.

Tried and reverted (didn't fix it, but is still probably worth doing
independently): giving each `src/server/index.ts` instance its own
`cacheDir` (`path.join(WORKSPACE, "node_modules/.vite")`) instead of the
shared default under the repo root — isolates the on-disk cache but not the
in-memory optimizer race.

Not yet tried: `server.warmup` (Vite 5.1+) to eagerly transform
`src/registry/*.tsx` and other tile entry points at boot, so the optimizer's
dependency set is complete before any test navigates — the working theory is
that some tile's dependency isn't discovered until first render, and
`dry-run.spec.ts`'s extra server processes are what create enough real-time
gap for that discovery + re-optimize to land exactly when `theme.spec.ts`
navigates next. Suggest starting there, or fence `dry-run.spec.ts` off from
`theme.spec.ts` in file order/project config as a cheaper interim workaround.
