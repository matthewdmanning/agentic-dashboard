---
name: run-agentic-dashboard
description: Initialize a dashboard workspace with a given configuration, start the dashboard MCP server, and drive it with tool calls (read-dashboard, add-card, edit-theme, etc.) to modify the dashboard. Use for "run the dashboard", "start the MCP server", "init a dashboard", "test the MCP tools", "screenshot/modify the dashboard via MCP".
---

> **Drives the code being replaced.** This skill exercises the pre-rewrite MCP
> surface — `add-card`, `edit-theme`, `assemble-card-template`, and the appearance
> tools. It still runs today, and stops working at Phase 2's first commit, which
> deletes `src/` and `e2e/`.
>
> Do not use it as a reference for the new tool surface. See
> `SHADCN_REWRITE_PLAN.md` and `REBUILD-NOTES.md`. Delete this skill when the
> rebuild replaces the server.

Paths below are relative to the repo root (`<unit>` = this repo).

This app has no GUI — it's a service (`src/service`) exposed over an MCP
server (`src/mcp`) that a client (agent, or Claude Desktop) drives with tool
calls. There's nothing to screenshot; the interaction surface is the MCP
tool protocol. The driver is a small TypeScript client
(`.claude/skills/run-agentic-dashboard/driver.ts`) that inits a workspace,
spawns the real server (`src/mcp/index.ts`) over stdio, and sends it tool
calls — the same path a real MCP-connected agent takes.

A running dashboard's HTTP server (`src/server`) separately serves its
wired-in card templates as a shadcn-compatible registry at
`/r/registry.json` and `/r/<name>.json` (D24) — a non-MCP surface for
shadcn-aware clients (`shadcn search/view/add`) to discover and pull
templates from a live dashboard. See `src/server/registry.ts`.

## Prerequisites

None beyond the repo's own `node_modules` (already installed: `npm install`
at repo root). No `apt-get` packages needed — this is a Node/stdio service,
not a browser or desktop app.

## Run (agent path) — the driver

All commands run from the repo root with `npx tsx`.

**1. Init a workspace**, optionally with a custom configuration:

```bash
npx tsx .claude/skills/run-agentic-dashboard/driver.ts init <workspaceDir> [configJsonPath]
```

Writes `<workspaceDir>/.dashboard/dashboard.json` (validated against the
contract's `dashboardConfigurationSchema`), plus empty `accounts.json` and
`integration-credentials.json`. Omit `configJsonPath` to use the built-in
default configuration (one theme, one welcome card). The config file must be
a full `DashboardConfiguration` object — see
`src/contract/index.ts:dashboardConfigurationSchema` for the shape
(`integrations`, `themes`, `presets`, `dashboard`, `cards`, `cardMappers`,
`integrationRetentionDays`). Roles live in a separate file `contract`
imports, not in this object (D35). A user's own appearance (base colour,
typeset, menu treatment, presets) is separate per-user state, not part of
this file either (D33-D35, #94-#96) — see `src/server/appearance.ts`.

**2. List available tools:**

```bash
npx tsx .claude/skills/run-agentic-dashboard/driver.ts list <workspaceDir>
```

Spawns the MCP server against that workspace and returns the current tool
names — run `list` for the authoritative set rather than trusting this doc,
since tools are added as issues land. As of #96: `read-dashboard`,
`add-card`, `edit-card`, `remove-card`, `patch-card-state`, `insert-card`,
`assemble-card-template`, `edit-dashboard`, `add-theme`, `edit-theme`,
`remove-theme`, `add-preset`, `remove-preset`, `add-integration`,
`edit-integration`, `remove-integration`, `block-integration`,
`unblock-integration`, `set-integration-retention-policy`,
`connect-integration`, `disconnect-integration`, `read-appearance`,
`set-base-colour`, `set-typeset`, `set-menu-appearance`,
`add-personal-preset`, `remove-personal-preset`, `select-preset`,
`clear-preset-selection`. That reference document is deleted; read `src/mcp/server.ts` if you need the current behaviour of code that is about to be removed.

**3. Call one tool** (one-shot — spawns, calls, closes):

```bash
npx tsx .claude/skills/run-agentic-dashboard/driver.ts call <workspaceDir> <toolName> '<jsonArgs>'
```

Example:

```bash
npx tsx .claude/skills/run-agentic-dashboard/driver.ts call ./ws read-dashboard '{"scope":"all"}'
npx tsx .claude/skills/run-agentic-dashboard/driver.ts call ./ws add-card '{"card":{"id":"note1","title":"Note","template":"message","state":{"message":"hi"},"queries":[]}}'
```

**4. Accept a stream of prompts (REPL)** — for a subagent driving the
dashboard from a series of instructions, one JSON command per line on
stdin, one JSON result per line on stdout:

```bash
npx tsx .claude/skills/run-agentic-dashboard/driver.ts repl <workspaceDir>
```

Input line shape: `{"tool": "<toolName>", "args": {...}}`. EOF (Ctrl-D)
closes the connection and exits. A driving agent should first call `list`
(or read `src/mcp/server.ts`) to know which tools exist and what args each
takes, then translate each natural-language prompt into one `{tool, args}`
line.

All state is file-backed under `<workspaceDir>/.dashboard/` — mutations from
one `call`/`repl` invocation are visible to the next, since each spawns a
fresh server process reading the same files.

## Run (human path)

`npm run mcp` starts the server against `$DASHBOARD_WORKSPACE` (default:
cwd) for a real MCP client (Claude Desktop, etc.) to connect to over stdio.
`npm run init` does the same first-time setup as `driver.ts init`, but only
with the built-in default configuration — it has no way to pass a custom
one. `npm run dev` starts the unrelated HTTP/client dev server
(`src/server/index.ts`), not the MCP server.

## Gotchas

- **`node_modules/.bin/tsx` cannot be spawned directly on Windows** via
  `child_process` with `command: process.execPath, args: [...]` — the `.bin`
  entry is a shell/cmd shim, not a Node script, and fails with `SyntaxError:
missing ) after argument list`. Point the spawn at
  `node_modules/tsx/dist/cli.mjs` instead (a real ESM entry point), run with
  `process.execPath`.
- **`npm run init` (`src/scripts/init-dashboard.ts`) always writes the
  default configuration** — it does not accept a custom one. To init with a
  specific configuration, use `driver.ts init <dir> <configJsonPath>`
  instead, which validates the file against
  `parseDashboardConfiguration` before writing.
- **The MCP server has no HTTP surface.** `curl` won't reach it — it only
  speaks JSON-RPC over stdio. An MCP `Client` (this driver, or a real agent)
  is the only way in.
- **Every `call`/`repl` invocation spawns its own server process.** Fine for
  correctness (state is on disk), but don't expect an in-memory session to
  persist between separate `call` invocations — only the workspace's JSON
  files do.

## Troubleshooting

- `Already initialized: <path>` from `init` — the workspace already has a
  `dashboard.json`. Pick a fresh `<workspaceDir>` or delete
  `<workspaceDir>/.dashboard/`.
- `SdkError: Connection closed` immediately after a `call`/`list`/`repl` —
  usually the spawned `tsx src/mcp/index.ts` crashed on startup (bad
  `DASHBOARD_WORKSPACE`, or the tsx shim issue above). Re-run with the
  workspace path checked and `stderr: "inherit"` (already set in
  `driver.ts`) to see the child's actual error.
- Zod validation error from `init <dir> <configPath>` — the JSON file isn't
  a full `DashboardConfiguration` (all seven top-level keys required:
  `integrations`, `themes`, `presets`, `dashboard`, `cards`, `cardMappers`,
  `integrationRetentionDays`; `roles` is not one of them — D35); ids must be
  unique within `integrations`/`themes`/`presets`/`cards`.
