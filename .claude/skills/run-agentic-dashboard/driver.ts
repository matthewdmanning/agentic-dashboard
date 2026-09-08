// Driver for the agentic-dashboard MCP server. Run with tsx (see SKILL.md).
//
//   tsx driver.ts init  <workspaceDir> [configJsonPath]
//   tsx driver.ts call  <workspaceDir> <toolName> [jsonArgs]
//   tsx driver.ts list  <workspaceDir>
//   tsx driver.ts repl  <workspaceDir>
//
// "repl" spawns the real MCP server (src/mcp/index.ts) as a child process
// over stdio and reads one JSON command per line from stdin:
//   {"tool": "add-card", "args": {"card": {...}}}
// printing one JSON result per line to stdout. Ctrl-D / EOF exits.

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  parseDashboardConfiguration,
  defaultDashboardConfiguration,
} from "../../../src/contract";
import { createFilePersistence } from "../../../src/service";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const mcpEntry = join(repoRoot, "src/mcp/index.ts");

function envFor(workspace: string): Record<string, string> {
  return {
    ...process.env,
    DASHBOARD_WORKSPACE: workspace,
  } as Record<string, string>;
}

async function initDashboard(workspace: string, configPath?: string) {
  const dashboardPath = join(workspace, ".dashboard", "dashboard.json");
  const configuration = configPath
    ? parseDashboardConfiguration(
        JSON.parse(await (await import("node:fs/promises")).readFile(configPath, "utf8")),
      )
    : defaultDashboardConfiguration;
  await createFilePersistence(dashboardPath).write(configuration);

  const fs = await import("node:fs/promises");
  const accountsPath = join(workspace, ".dashboard", "accounts.json");
  const credentialsPath = join(
    workspace,
    ".dashboard",
    "integration-credentials.json",
  );
  await fs.writeFile(accountsPath, "[]\n").catch(() => {});
  await fs.writeFile(credentialsPath, "{}\n").catch(() => {});

  console.log(`Initialized dashboard: ${dashboardPath}`);
}

async function connect(workspace: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), mcpEntry],
    env: envFor(workspace),
    cwd: repoRoot,
    stderr: "inherit",
  });
  const client = new Client({ name: "dashboard-driver", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function main() {
  const [, , cmd, workspaceArg, ...rest] = process.argv;
  if (!cmd || !workspaceArg) {
    console.error(
      "Usage: tsx driver.ts <init|call|list|repl> <workspaceDir> [...]",
    );
    process.exit(1);
  }
  const workspace = resolve(workspaceArg);

  if (cmd === "init") {
    await initDashboard(workspace, rest[0]);
    return;
  }

  const client = await connect(workspace);

  if (cmd === "list") {
    const { tools } = await client.listTools();
    console.log(JSON.stringify(tools.map((t) => t.name), null, 2));
    await client.close();
    return;
  }

  if (cmd === "call") {
    const [toolName, jsonArgs] = rest;
    const result = await client.callTool({
      name: toolName,
      arguments: jsonArgs ? JSON.parse(jsonArgs) : {},
    });
    console.log(JSON.stringify(result, null, 2));
    await client.close();
    return;
  }

  if (cmd === "repl") {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const { tool, args } = JSON.parse(trimmed);
        const result = await client.callTool({ name: tool, arguments: args ?? {} });
        console.log(JSON.stringify(result));
      } catch (error) {
        console.log(
          JSON.stringify({ isError: true, message: String(error) }),
        );
      }
    }
    await client.close();
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
