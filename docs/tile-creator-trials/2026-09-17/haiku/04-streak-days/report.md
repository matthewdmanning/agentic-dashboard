Perfect! Now let me write the final report:

```
Status: done

Spec:
  Purpose:        Display how many consecutive days the user has maintained a streak
  Registry item:  stat-tile
  Title:          Streak
  Size:           sm — compact corner placement for a simple counter metric

Registry item used: stat-tile

Checks run:
  npx shadcn@latest search http://localhost:5175/r/registry.json → Found stat-tile (block type, "Displays a labeled numeric value")
  npx shadcn@latest view http://localhost:5175/r/stat-tile.json → Verified schema: requires LABEL (string) and VALUE (number)
  Dashboard state validation → Tile added to workspace-demo/dashboard.json with unique ID and size reference
  Schema match verification → State object matches stat-tile meta.schema exactly: {LABEL:"Streak", VALUE:7}

Placement:
  Tile ID: streak-days-1789680849234
  Size: sm
  Position: Second tile on dashboard (after Active Projects), small size for corner placement

Test Drive Summary: docs/test-drives/2026-09-17_streak-tile/summary.md

Done. Streak tile placed and verified. No escalation needed — stat-tile registry item fits the request perfectly. The VALUE (currently 7) can be updated by the user to reflect their actual streak count.
```