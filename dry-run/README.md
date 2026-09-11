# Dry run

The dry run is the standalone dashboard surface for an attaching AI agent.

Start the dashboard in one terminal:

```text
npm run dry-run
```

Start the MCP server in another terminal or from the agent's MCP configuration:

```text
npm run dry-run:mcp
```

The dashboard command creates a unique working folder under `.dry-run/`, copies
the fixture and project defaults into it, and records the active run. The MCP
command attaches to that same folder, or creates one and starts the dashboard
server if needed. Defaults are declared in `config.json`. The dashboard serves the shadcn registry at
`http://localhost:5173/r/registry.json`, and the MCP server sends that registry
address plus the `read-dashboard` and `apply` instructions to its client.

The committed seed is in `workspace/`; generated working folders are ignored.
The agent creates and arranges its dashboard through MCP; no test runner or
test-generated behavior is required by this surface.
