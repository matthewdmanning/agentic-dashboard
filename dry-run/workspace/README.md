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

Dry-run runtime settings live in `dry-run/config.json`: the fixture, the working folder, the base port the runner scans from, and the two entrypoints. E2E run settings remain separate in `e2e/config.json`.

**Development edits the generated copy.** Each dry run copies this seed into its own folder under `.dry-run/`, so several runs can be up at once without meeting; a tile an agent adds persists in that run's folder and can still be read there after the run ends. Nothing under `.dry-run/` is deleted automatically.

## What is in here

`dashboard.json` — the tile pool and the dashboard's ordered references into it. Nine fictional tiles use both registry items and all three sizes: two medium stat tiles, one full-width activity list, two medium lists, and four small stats. The result fills a realistic dashboard screen instead of serving as a two-tile smoke test.

The workspace intentionally contains only the dashboard state. `CONTEXT.md` defines additional dashboard configuration categories, but their formats are not implemented yet; the dry run does not invent them.

The registry, `components.json`, and the theme are read from the repository root, not from here: a workspace holds dashboard state and nothing else. The MCP connection instructions quote the live registry address, built from the port the run is actually using.

## Content rules

Fictional seed data only. No real credentials, no tokens, no personal content, and no real service names. The strings and numbers are synthetic, committed, and public.
