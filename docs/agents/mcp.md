# Dashboard MCP Server

`src/mcp/` owns MCP tool definitions only. Each write tool constructs one
contract mutation and calls `DashboardService.apply`; the read tool calls
`DashboardService.read`. Persistence, authorization, and mutation application
belong to `src/service/`; account and credential resolution belongs to
`src/auth/`.

The stdio entrypoint in `src/mcp/index.ts` composes a file-backed service and
passes it to the MCP server. Run it with `npm run mcp`. It reads the dashboard
from `DASHBOARD_DATA_PATH` and the auth store from `DASHBOARD_AUTH_STORE_PATH`,
both defaulting under `DASHBOARD_WORKSPACE`.

The stdio caller sends no credential, so it resolves to the `localUser` role.
The auth store is composed here because the entrypoint is where an
authenticated caller would be wired in; it is not reached until a caller
supplies a credential.

## Registered tools

`read-dashboard` accepts `scope` as `all`, `role`, `data`, `cards`,
`presentation`, `integrations`, `roles`, or `queries`.

Most write tools correspond to one contract mutation each, gated by the
matching entry in `mutationRequirements`:

- `patch-card-state`
- `add-card`, `edit-card`, `remove-card`
- `insert-card`, `edit-dashboard`
- `assemble-card-template`
- `add-theme`, `edit-theme`, `remove-theme`
- `add-preset`, `remove-preset` (`presentation: write` — D27, #96)
- `add-integration`, `edit-integration`, `remove-integration`
- `block-integration`, `unblock-integration`, `set-integration-retention-policy`
  (D40, #89, #92)

A second group calls a `DashboardService` method directly instead of
constructing a mutation — each is ungated by permission (D35), since what it
touches belongs to the resolved caller by structure, not by category/level:

- `connect-integration`, `disconnect-integration` (D14, D28, D40)
- `read-appearance`, `set-base-colour`, `set-typeset`, `set-menu-appearance`
  (D26, D33-D35, #94, #95)
- `add-personal-preset`, `remove-personal-preset`, `select-preset`,
  `clear-preset-selection` (#96) — the last two set or clear
  `UserAppearance.selectedPreset` via `setAppearance`, not a dedicated method

The service validates each mutation (or appearance update) and enforces the
required permission level where one applies. MCP does not read or write data
files, refresh integrations, perform path containment, or implement a second
permission check.
