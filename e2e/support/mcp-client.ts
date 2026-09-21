import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * One stdio connection to the dashboard's MCP server, scoped to a single
 * workspace via `DASHBOARD_WORKSPACE`. Drives the server the way an agent
 * does — through its tools, never by writing `dashboard.json` directly.
 *
 * Known behaviour, confirmed against the server: calls are NOT safe to fire
 * concurrently on one client. Handlers are async with no protocol-level
 * ordering guarantee, so a caller must `await` each `callTool` before
 * starting the next — never `Promise.all` two calls on the same client.
 */
export type McpTestClient = {
  /** Calls a tool and returns its `structuredContent`, typed as `T`. Throws if the tool reports `isError`. */
  callTool: <T = unknown>(
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  /** The tool result as the protocol returns it, including `isError` — for tests that assert a refusal. */
  callToolRaw: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<Awaited<ReturnType<Client["callTool"]>>>;
  close: () => Promise<void>;
};

/**
 * `credential` is passed to the server process verbatim. An empty string
 * means "no credential presented": a variable set in the child's environment
 * beats `--env-file-if-exists=.env.local`, so a developer's own credential
 * can never leak into a test that means to present none.
 */
export async function connectMcpClient(
  workspace: string,
  credential = "dev-owner",
): Promise<McpTestClient> {
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "mcp"],
    cwd: REPO_ROOT,
    // Explicit, not left to a developer's own .env.local: e2e needs a
    // deterministic credential regardless of what's on this machine, matching
    // the seed account in src/auth/whitelist.ts.
    env: {
      ...process.env,
      DASHBOARD_WORKSPACE: workspace,
      DASHBOARD_CREDENTIAL: credential,
    },
  });

  const client = new Client({ name: "e2e-mcp-client", version: "0.0.0" });
  await client.connect(transport);

  return {
    async callTool<T>(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        throw new Error(
          `MCP tool "${name}" reported an error: ${JSON.stringify(result.structuredContent ?? result.content)}`,
        );
      }
      return result.structuredContent as T;
    },
    async callToolRaw(name: string, args: Record<string, unknown> = {}) {
      return await client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
    },
  };
}
