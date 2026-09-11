# Dry run

The dry run is the standalone dashboard surface for an attaching AI agent.

Start the dashboard in one terminal:

```text
npm run dry-run
```

Give the agent the MCP server. Copy `mcp.json` into the agent's MCP
configuration — its paths are relative to the repository root, which the
client must use as the working directory. To start it by hand instead:

```text
npm run --silent dry-run:mcp
```

The `--silent` matters: MCP speaks JSON-RPC over stdout, and `npm run` prints
its `> tsx ...` banner there too, ahead of the protocol. `mcp.json` starts the
runner directly and never involves npm.

The dashboard command creates a working folder under `.dry-run/`, copies the
fixture into it, and records the active run. The MCP command attaches to the
dashboard already running on the port and serves that dashboard's workspace,
or starts one itself when nothing is listening. Settings live in
`config.json`; `PORT` in the environment overrides the port in it.

The dashboard serves the shadcn registry at `http://127.0.0.1:5175/r/registry.json`,
and the MCP server sends that address — built from the same `PORT` — plus the
`read-dashboard` and `apply` instructions to its client.

The committed seed is in `workspace/`; generated working folders are ignored.
A run's folder is left behind when the run ends so its final state can be
read; the next run prunes it. The agent creates and arranges its dashboard
through MCP; no test runner is required by this surface.

## What the dry run does not carry

The registry (`registry.json`, `src/registry/`), the shadcn project config
(`components.json`), and the theme (`src/styles.css`) are the application, not
the run, and are read from the repository root. A working folder holds only
the dashboard's own state. Editing a copy of one of those files inside a
working folder would change nothing.
