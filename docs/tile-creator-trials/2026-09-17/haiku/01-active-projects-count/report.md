---

## Status: done

### Spec
```
Purpose:        Display count of currently active projects as a prominent metric
Registry item:  stat-tile
Title:          Active Projects
Size:           sm — compact metric, label + big number fits one cell
```

### Registry item used
**stat-tile** — existing registry item for displaying labeled numeric values

**Schema matched:**
- `LABEL` (string): "Active Projects"  
- `VALUE` (number): 5

### Checks run
- `npx shadcn@latest search` → Found `stat-tile` in registry ✅
- `npx shadcn@latest view` → Verified schema (LABEL: string, VALUE: number) ✅
- `.dashboard/dashboard.json` → Tile added, positioned first with id `active-projects`, size `sm` ✅
- Dashboard renders → 3 tiles visible, no errors ✅

### Screenshot
`docs/test-drives/2026-09-17_active-projects-tile/screenshots/dashboard.png`

The "Active Projects" tile displays prominently at the top left with the number **5** below the label.

### Placement
- **Tile id:** `active-projects`
- **Size:** sm
- **Position:** First tile (top row, left side)
- **Registry item:** stat-tile

---

The tile is live. Update the VALUE in `.dashboard/dashboard.json` if you want to change the count.