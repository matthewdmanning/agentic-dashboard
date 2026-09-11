# test-dashboard-config

A dashboard's persistent state, in the shape a real one has, kept under version control so every run starts from the same place.

Point the app at it with `DASHBOARD_WORKSPACE`:

```
DASHBOARD_WORKSPACE=test-dashboard-config npm run dev
```

## Immutable during testing, editable during development

Those are the same files under two different rules, and the rule follows from how the directory is reached.

**Testing never touches it.** `npm run test:e2e` copies this directory into a throwaway workspace before the first spec runs, and every mutation lands on the copy. After the last spec, the originals are hashed and compared against the hashes taken before the run; a mismatch fails the run. A check that quietly edits the fixture it started from stops being repeatable, and the next run inherits the last one's leftovers — so this is enforced rather than documented and hoped for.

**Development edits it directly.** Running the server with `DASHBOARD_WORKSPACE` set to this directory writes here, so a tile added through MCP or by hand persists and can be committed. That is the point: it is how the starting state gets curated.

## What is in here

`dashboard.json` — the tile pool and the dashboard's ordered references into it. Four tiles across every size, using both registry items, so the grid is exercised rather than merely populated.

Nothing else, yet. `CONTEXT.md` defines dashboard configuration as also holding the integration list, the tile mapper store, and project policy — none of which is built. Inventing file formats for them now would be fiction that drifts from whatever they actually become; each lands here when its feature does.

## Content rules

Placeholder only. No real credentials, no tokens, no personal content, no real service names. This file is committed and public.
