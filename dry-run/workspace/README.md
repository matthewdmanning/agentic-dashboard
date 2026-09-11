# dry-run/workspace

A dashboard's persistent state, in the shape a real one has, kept under version control so every run starts from the same place.

Start the dry run from the repository root; it copies this seed into a unique
working folder for the run:

```
npm run dry-run
npm run dry-run:mcp
```

## Immutable during testing, editable during development

Those are the same files under two different rules, and the rule follows from how the directory is reached.

**Testing never touches it.** The E2E harness creates a new uniquely named workspace for each run, copies this directory into it before the first spec, and points both the dashboard and MCP server at that copy. Every mutation lands there. After the last spec, the original fixture is hashed and compared against the hash taken before the run, then the temporary workspace is removed; a mismatch fails the run.

Dry-run runtime settings live in `dry-run/config.json`. It selects the workspace, starts the dashboard or MCP entrypoint, and records the default shadcn settings and registry. E2E run settings remain separate in `e2e/config.json`.

**Development edits the generated copy.** The dry-run commands point both servers at the same unique working folder, so a tile added through MCP persists for that run and can be inspected there without changing this seed.

## What is in here

`dashboard.json` — the tile pool and the dashboard's ordered references into it. Nine fictional tiles use both registry items and all three sizes: two medium stat tiles, one full-width activity list, two medium lists, and four small stats. The result fills a realistic dashboard screen instead of serving as a two-tile smoke test.

The workspace intentionally contains only the dashboard state. `CONTEXT.md` defines additional dashboard configuration categories, but their formats are not implemented yet; the dry run does not invent them.

The dry run uses the project defaults at their canonical paths: shadcn's `components.json`, the dashboard `registry.json`, and `src/styles.css` as the default theme. The MCP connection instructions expose the live registry at `http://localhost:5173/r/registry.json`.

## Content rules

Fictional seed data only. No real credentials, no tokens, no personal content, and no real service names. The strings and numbers are synthetic, committed, and public.
