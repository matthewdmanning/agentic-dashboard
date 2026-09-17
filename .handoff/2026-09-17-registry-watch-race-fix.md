# Registry-watch race fix — 2026-09-17

Closes out #123 (symptom 2) and #124. Root-caused, fixed, verified. Fix is
committed (`96248ee` on `feat/shadcn-rebuild`) but **not pushed**.

## Root cause

`src/server/index.ts` ran its own `node:fs.watch()` on the same workspace
directory Vite's dev server (chokidar) already watches for HMR. Two
independent watchers on one directory on Windows — ours silently never
fired for the registry-rebuild trigger; Vite's own watcher noticed the file
but ~90s late. Confirmed via `DEBUG=pw:webserver npm run test:e2e --
e2e/b3-new-tile.spec.ts`.

## Fix

`src/server/index.ts` — dropped the manual `watch()` calls, rebuild now
triggers off `vite.watcher` (`.add(WORKSPACE)` + `.on("all", ...)`
filtered to `registry.json` / `registry/*.tsx`). One watcher, not two.

## Verification

- `e2e/b3-new-tile.spec.ts`: 90s timeout → 3.5s.
- Suite-wide cascade it caused (`b4-layout.spec.ts`, `checklist.spec.ts`,
  `theme.spec.ts` all failing right after) is gone.
- `e2e/b1-discovery.spec.ts`, `b3-new-tile.spec.ts`, `b4-layout.spec.ts`,
  `dry-run.spec.ts`: 13/13 passed across two clean repeat runs.

## Not fixed here — separate, pre-existing

`e2e/checklist.spec.ts` and `e2e/theme.spec.ts` still fail intermittently —
different feature area (default tile rendering, theme toggle), unrelated to
the registry watcher. Not investigated.

## Next

Push `feat/shadcn-rebuild`, or open a PR — commit message already carries
`Closes #123` / `Closes #124` for when it merges.
