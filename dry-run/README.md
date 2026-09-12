# Dry run

The dry run is the standalone dashboard surface for an attaching AI agent.

Start a dashboard:

```text
npm run dry-run
```

It prints the address it chose. Run it again and a second dashboard comes up
beside the first, on the next free port with its own workspace — as many as
you want, none of them aware of each other.

Give an agent the MCP server by copying `mcp.json` into the agent's MCP
configuration; its paths are relative to the repository root, which the client
must use as the working directory. To start one by hand instead:

```text
npm run --silent dry-run:mcp
```

The `--silent` matters: MCP speaks JSON-RPC over stdout, and `npm run` prints
its `> tsx ...` banner there too, ahead of the protocol. `mcp.json` starts the
runner directly and never involves npm.

## Which dashboard an agent gets

With nothing set, the MCP server attaches to the dry-run dashboard that is
already up, or starts one of its own if none is. That is what makes an agent
usable in the background: it needs no dashboard started for it and no port
told to it.

Two environment variables override that:

- `DRY_RUN_WORKSPACE` — work in this workspace, starting a dashboard for it if
  none is serving it. This is how you point a second agent at a second run, or
  reopen the workspace a finished run left behind.
- `PORT` — use this port. The dashboard command starts there; the MCP command
  attaches to a dry run already on it.

Anything unusable is a warning, never a stop: a port serving state the dry run
will not write into, a `DRY_RUN_WORKSPACE` that does not exist, several runs
up at once when only one can be attached to. The runner says what it found and
carries on with a run of its own, because an agent working in the background
has nobody to answer a prompt.

## Workspaces

`npm run dry-run` copies `workspace/` into a new folder under `.dry-run/` and
writes a `run.json` beside the dashboard state naming the port it is serving
on. When the server stops, that record goes and the folder stays.

Nothing under `.dry-run/` is ever deleted automatically. A folder from a
finished or crashed run holds that run's dashboard, and another run may still
be using it, so old folders are yours to delete; the runner only warns once
they pile up. A `run.json` pointing at a port nobody answers is ignored rather
than cleaned, which is why a stale process or a hard kill costs nothing.

Settings live in `config.json`: the fixture, the working folder, the base port
and how far to scan from it, and the two entrypoints.

## What the dry run does not carry

The registry (`registry.json`, `src/registry/`), the shadcn project config
(`components.json`), and the theme (`src/styles.css`) are the application, not
the run, and are read from the repository root. A working folder holds only
the dashboard's own state. Editing a copy of one of those files inside a
working folder would change nothing.
