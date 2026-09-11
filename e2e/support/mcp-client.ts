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
  close: () => Promise<void>;
};

export async function connectMcpClient(
  workspace: string,
): Promise<McpTestClient> {
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "mcp"],
    cwd: REPO_ROOT,
    env: { ...process.env, DASHBOARD_WORKSPACE: workspace },
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
    async close() {
      await client.close();
    },
  };
}
