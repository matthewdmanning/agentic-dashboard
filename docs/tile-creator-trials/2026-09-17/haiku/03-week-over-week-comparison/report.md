---

**Status: needs-escalation**

**UX spec:**
```
Purpose:        Show this week's completed task count vs last week's, displayed side by side for quick comparison.
Registry item:  [None found]
Title:          Tasks completed (week vs week)
Size:           md — width suitable for pair of stats
```

**Registry analysis:**

Found 4 existing items:
1. **stat-tile** — single LABEL + VALUE (displays *one* number, not suited for side-by-side comparison)
2. **list-tile** — LIST_TITLE + LIST_ITEMS (list display, no comparison structure)
3. **checklist-tile** — toggleable items (task checklist, not metrics)
4. **eisenhower-matrix-tile** — task quadrants (not a time-period comparison)

**Why escalation:**
- The request requires a comparison schema with two periods (this week | last week) side by side
- stat-tile's schema only allows `LABEL` + `VALUE` (one pair); can't hold two weeks' data
- Forcing this into two separate stat-tiles violates "side by side" — that's two tiles, not one widget
- No existing item's schema matches the week-to-week comparison data shape

**What's needed:**
A new registry item with a schema like:
```json
{
  "properties": {
    "TITLE": { "type": "string" },
    "THIS_WEEK": { "type": "number" },
    "LAST_WEEK": { "type": "number" }
  },
  "required": ["TITLE", "THIS_WEEK", "LAST_WEEK"]
}
```

Would you like me to author this component and schema, or would you prefer to scope this differently (e.g., two separate stat-tiles)?