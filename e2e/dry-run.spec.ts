import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";

/**
 * The dry run is the surface an agent attaches to, so what has to hold is that
 * a human and an agent end up looking at the same dashboard. Both failures
 * checked here were live: the runner used to copy files no code reads, and it
 * used to attach to whatever answered its port — including a dashboard serving
 * somebody else's state, which sent an agent's writes somewhere invisible.
 *
 * Everything here starts its own processes on its own port, so it shares
 * nothing with the rest of the suite but the repository.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUNNER = path.join(REPO_ROOT, "dry-run", "runner.ts");
// Off the dev server (5173) and the rest of this suite (5174), so a dry-run
// check never decides the outcome of an unrelated one.
const PORT = 5176;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** The command shipped in `dry-run/mcp.json`, so this checks what agents are handed. */
function shippedMcpCommand(): { command: string; args: readonly string[] } {
  const config = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "dry-run", "mcp.json"), "utf8"),
  ) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  const entries = Object.values(config.mcpServers);
  expect(entries).toHaveLength(1);
  return entries[0];
}

const started = new Set<ChildProcess>();

function start(args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, [...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  started.add(child);
  return child;
}

async function waitForDashboard(timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/api/workspace`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const { workspace } = (await response.json()) as { workspace: string };
        return workspace;
      }
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no dashboard answered at ${ORIGIN}`);
}

test.describe("dry run", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(() => {
    for (const child of started) child.kill();
    started.clear();
  });

  test("an agent attaching through the shipped config changes the page a human is watching", async ({
    page,
  }) => {
    start([TSX_CLI, RUNNER, "dashboard"], { PORT: String(PORT) });
    const served = await waitForDashboard();
    expect(served).toContain(".dry-run");

    const { command, args } = shippedMcpCommand();
    const transport = new StdioClientTransport({
      command: command === "node" ? process.execPath : command,
      args: [...args],
      cwd: REPO_ROOT,
      env: { ...process.env, PORT: String(PORT) },
    });
    const client = new Client({ name: "dry-run-check", version: "0.0.0" });
    await client.connect(transport);

    try {
      // No DASHBOARD_WORKSPACE is passed: the runner has to find the workspace
      // of the dashboard already on the port, which is the whole point.
      const result = await client.callTool({
        name: "apply",
        arguments: {
          mutations: [
            {
              type: "add-tile",
              tile: {
                id: "dry-run-check",
                title: "Dry run check",
                item: "stat-tile",
                state: { LABEL: "Dry run check", VALUE: 7 },
              },
              size: "md",
            },
          ],
        },
      });
      expect(result.isError).toBeFalsy();

      await page.goto(ORIGIN);
      const tile = page.locator('[data-tile-id="dry-run-check"]');
      await expect(tile).toBeVisible();
      await expect(tile).toContainText("7");
      await page.screenshot({
        path: "screenshots/dry-run-agent-added-tile.png",
        fullPage: true,
      });
    } finally {
      await client.close();
    }
  });

  test("it refuses to attach to a dashboard serving somebody else's state", async () => {
    const foreign = mkdtempSync(path.join(tmpdir(), "not-a-dry-run-"));
    try {
      start([TSX_CLI, path.join(REPO_ROOT, "src", "server", "index.ts")], {
        PORT: String(PORT),
        DASHBOARD_WORKSPACE: foreign,
      });
      const served = await waitForDashboard();
      expect(served).toBe(foreign);

      const attempt = spawn(process.execPath, [TSX_CLI, RUNNER, "mcp"], {
        cwd: REPO_ROOT,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      attempt.stderr.on(
        "data",
        (chunk: Buffer) => (stderr += chunk.toString()),
      );
      const code = await new Promise<number | null>((resolve) =>
        attempt.once("exit", resolve),
      );

      expect(code).not.toBe(0);
      expect(stderr).toContain("not a dry-run workspace");
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });
});
