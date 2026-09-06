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

`read-dashboard` accepts `scope` as `all`, `data`, `cards`, `presentation`,
`integrations`, or `roles`.

The write tools correspond to the contract mutations:

- `patch-card-state`
- `add-card`, `edit-card`, `remove-card`
- `insert-card`, `edit-dashboard`
- `assemble-card-template`
- `add-theme`, `edit-theme`, `remove-theme`, `set-font-scale`
- `add-integration`, `edit-integration`, `remove-integration`, `authorize-integration`

The service validates each mutation and enforces the required permission level.
MCP does not read or write data files, refresh integrations, perform path
containment, or implement a second permission check.
