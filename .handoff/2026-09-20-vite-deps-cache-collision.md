# Handoff: Vite deps-cache collision breaking e2e (issue #139)

## Where things stand

- Tracked as [issue #139](https://github.com/matthewdmanning/agentic-dashboard/issues/139).
- Not started on a branch. No code change is currently in the tree for this —
  the one fix attempted below was reverted.
- Separate from [issue #138](https://github.com/matthewdmanning/agentic-dashboard/issues/138)
  (Windows process-tree kill on e2e child processes), which was filed first
  under the wrong hypothesis for _this_ failure. #138's fix is real and worth
  keeping regardless, but it does not touch the bug described here.

## The bug, confirmed

`src/server/index.ts` creates every Vite dev server instance with
`root: APP_ROOT` and no `cacheDir` override, so Vite's default
`<root>/node_modules/.vite` deps cache is the **same physical directory** for
every dashboard process on the machine — the long-lived e2e `webServer` and
every `dry-run/runner.ts`-spawned dashboard — regardless of which
`DASHBOARD_WORKSPACE` each is actually serving.

When `e2e/dry-run.spec.ts` starts its own dashboard instance(s) while the
shared webServer is still running, their concurrent dependency re-optimizes
collide on that one cache directory. The next page load against the shared
webServer gets served a stale asset hash and 504s loading a JS chunk. React
never mounts, so `e2e/theme.spec.ts` (which always runs immediately after
`dry-run.spec.ts` in file order) can never find the theme toggle button.

This is **deterministic, not flaky**: it reproduces every time the full suite
runs, and never reproduces when `theme.spec.ts` runs alone.

### How to reproduce directly

```
npx playwright test e2e/dry-run.spec.ts e2e/theme.spec.ts
```

Confirmed via temporary diagnostics in `theme.spec.ts`'s first test (added,
observed, then reverted — not left in the tree):

```ts
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
page.on("requestfailed", (req) =>
  console.log("[requestfailed]", req.url(), req.failure()?.errorText),
);
```

Output:

```
[requestfailed] http://127.0.0.1:5174/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=... net::ERR_ABORTED
[console] error Failed to load resource: the server responded with a status of 504 (Outdated Optimize Dep)
```

This is also the likely cause of a related symptom seen in full-suite runs:
an `EPERM, Permission denied` on `rmSync` of the shared e2e workspace
directory during teardown (`e2e/support/workspace.ts`) — if the deps-cache
collision destabilizes the shared webServer's own Vite instance, the process
may not shut down cleanly, leaving a file watch open on its workspace
directory when Playwright's global teardown tries to delete it. Not
separately confirmed; worth checking once the cache collision itself is fixed
(the EPERM may just disappear).

## What was tried, and why it didn't land

The obvious fix: scope each process's cache to the workspace it serves.

```ts
const vite = await createViteServer({
  root: APP_ROOT,
  cacheDir: path.join(WORKSPACE, "node_modules/.vite"),
  server: { middlewareMode: true },
  appType: "spa",
});
```

This **does** stop `theme.spec.ts` from failing. But running the full suite
with it in place breaks three previously-green specs instead:
`b3-new-tile.spec.ts`, `b4-layout.spec.ts`, and `checklist.spec.ts`. The cause
of those new failures was not root-caused — this was reverted rather than
landed blind, per instruction not to push a third guess without diagnosing
first.

### Where to pick up

- Re-apply the `cacheDir` change in a scratch branch and look at _why_ b3/b4/
  checklist break — get the actual browser console/network errors the same
  way the diagnostics above were captured (console + requestfailed listeners
  temporarily added to those specs), rather than guessing again.
- Hypotheses worth checking first (not yet verified):
  - `b3-new-tile.spec.ts` explicitly writes a new component + registry item
    directly into the workspace, then relies on the running server's file
    watcher (`vite.watcher.add(WORKSPACE)` in `src/server/index.ts`) to
    trigger a debounced `registry:build` and on Vite noticing the new import.
    A workspace-scoped `cacheDir` might race with that rebuild differently
    than the shared cache did (e.g. an empty/cold per-workspace cache taking
    a first optimize pass exactly when the test expects an immediate reload).
  - `checklist.spec.ts` and `b4-layout.spec.ts` don't touch the registry at
    all — if they _also_ break, that points at something more basic than a
    registry-rebuild race, e.g. the per-workspace cache directory not
    actually being created/writable in time, or Vite's `optimizeDeps`
    warm-up now happening per-process instead of once, adding enough latency
    to trip a timeout that assumed a warm shared cache.
  - Check the exact Vite version's `cacheDir` semantics in middleware mode —
    `docs/adr/` doesn't cover this app's Vite integration in that detail, so
    check Vite's own docs (Context7) for `optimizeDeps` + `cacheDir` +
    middlewareMode interactions rather than assuming.
- An alternative to workspace-scoped `cacheDir`: keep everyone on the shared
  cache but only ever run **one** Vite instance rooted at `APP_ROOT` at a
  time — i.e. make `dry-run/runner.ts`'s spawned dashboards reuse the already
  -running shared webServer instead of starting a second real Vite server.
  Worth weighing against the simpler per-workspace-cache fix once that one's
  regressions are understood; not investigated here.

## Don't re-derive

- The root cause (shared cacheDir across concurrent Vite instances) is
  confirmed, not a guess — see the reproduction above.
- The `cacheDir` fix's _symptom_ (fixes theme.spec.ts, breaks three others)
  is confirmed by an actual full-suite run, not assumed.
- issue #138's `killProcessTree` fix is unrelated and already correct on its
  own; don't conflate the two issues or assume fixing #139 also depends on
  #138's fix landing first (it doesn't — they're independent).
