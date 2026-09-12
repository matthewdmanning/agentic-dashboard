import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";

/**
 * The dry run is the surface an agent attaches to, and more than one of them
 * can be up at once: two developers' agents, or a test lane beside a person's
 * own run. What has to hold is that each run keeps to its own dashboard, that
 * an agent with no dashboard in front of it gets one, and that a port already
 * spoken for costs a warning rather than the run.
 *
 * Every process here is started by the test on a port the runner chooses, so
 * this shares nothing with the rest of the suite but the repository.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUNNER = path.join(REPO_ROOT, "dry-run", "runner.ts");
const config = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "dry-run", "config.json"), "utf8"),
) as {
  workingDirectory: string;
  workingFolderPrefix: string;
  runFile: string;
};
const WORKING_DIR = path.join(REPO_ROOT, config.workingDirectory);

type Run = { readonly workspace: string; readonly port: number };

const workspaces = (): string[] =>
  existsSync(WORKING_DIR)
    ? readdirSync(WORKING_DIR, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(config.workingFolderPrefix),
        )
        .map((entry) => path.join(WORKING_DIR, entry.name))
    : [];

function runOf(workspace: string): Run | undefined {
  try {
    const { port } = JSON.parse(
      readFileSync(path.join(workspace, config.runFile), "utf8"),
    ) as { port: number };
    return { workspace, port };
  } catch {
    return undefined;
  }
}

const started = new Map<ChildProcess, () => string>();
let preexisting: string[] = [];

function start(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): ChildProcess {
  const child = spawn(process.execPath, [...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let text = "";
  child.stderr?.on("data", (chunk: Buffer) => (text += chunk.toString()));
  started.set(child, () => text);
  return child;
}

const collectStderr = (child: ChildProcess): (() => string) =>
  started.get(child) ?? (() => "");

/** Everything the started processes said, so a timeout reports the reason instead of the symptom. */
const childLogs = (): string =>
  [...started.values()].map((read) => read()).join("\n");

async function until<T>(
  attempt: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await attempt();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}\n${childLogs()}`);
}

async function servedWorkspace(port: number): Promise<string | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/workspace`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return undefined;
    const { workspace } = (await response.json()) as { workspace: string };
    return workspace;
  } catch {
    return undefined;
  }
}

/** The run that appeared while `before` was the state of the working directory. */
async function newRun(before: readonly string[]): Promise<Run> {
  return until(async () => {
    const fresh = workspaces().filter((entry) => !before.includes(entry));
    for (const workspace of fresh) {
      const run = runOf(workspace);
      if (!run) continue;
      const served = await servedWorkspace(run.port);
      if (served && path.resolve(served) === path.resolve(workspace))
        return run;
    }
    return undefined;
  }, "a new dry run to come up");
}

const tileIds = async (port: number): Promise<string[]> => {
  const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
  const { tiles } = (await response.json()) as { tiles: { id: string }[] };
  return tiles.map((tile) => tile.id);
};

async function connectAgent(env: NodeJS.ProcessEnv): Promise<Client> {
  // The command shipped in `dry-run/mcp.json`, so this drives what an agent is
  // actually handed rather than a convenient equivalent.
  const shipped = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "dry-run", "mcp.json"), "utf8"),
  ) as { mcpServers: Record<string, { command: string; args: string[] }> };
  const [server] = Object.values(shipped.mcpServers);

  const transport = new StdioClientTransport({
    command: server.command === "node" ? process.execPath : server.command,
    args: server.args,
    cwd: REPO_ROOT,
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "dry-run-check", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

const addTile = (id: string) => ({
  name: "apply",
  arguments: {
    mutations: [
      {
        type: "add-tile",
        tile: {
          id,
          title: "Dry run check",
          item: "stat-tile",
          state: { LABEL: "Dry run check", VALUE: 7 },
        },
        size: "md",
      },
    ],
  },
});

test.describe("dry run", () => {
  test.describe.configure({ mode: "serial" });

  // Each check boots one or two real dashboards, and a cold Vite start is
  // slower than the default per-test budget.
  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(180_000);
    preexisting = workspaces();
  });

  test.afterEach(async () => {
    for (const child of started.keys()) child.kill();
    started.clear();
    // Only what this check created. A person's own runs are left alone, which
    // is the same rule the runner follows.
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const workspace of workspaces())
      if (!preexisting.includes(workspace))
        rmSync(workspace, { recursive: true, force: true });
  });

  test("two dry runs stay out of each other's dashboards", async () => {
    const before = workspaces();
    start([TSX_CLI, RUNNER, "dashboard"]);
    const first = await newRun(before);

    start([TSX_CLI, RUNNER, "dashboard"]);
    const second = await newRun([...before, first.workspace]);

    expect(second.port).not.toBe(first.port);
    expect(second.workspace).not.toBe(first.workspace);

    const agent = await connectAgent({ DRY_RUN_WORKSPACE: first.workspace });
    try {
      const result = await agent.callTool(addTile("only-in-the-first-run"));
      expect(result.isError).toBeFalsy();
    } finally {
      await agent.close();
    }

    expect(await tileIds(first.port)).toContain("only-in-the-first-run");
    expect(await tileIds(second.port)).not.toContain("only-in-the-first-run");
  });

  test("an agent with no dashboard in front of it starts one and drives it", async ({
    page,
  }) => {
    const before = workspaces();
    const agent = await connectAgent({});
    try {
      // The connect-time instructions quote the registry on the port the run
      // actually chose, so they are how a real agent would find the page.
      const instructions = agent.getInstructions() ?? "";
      const [, port] = /http:\/\/localhost:(\d+)\/r\/registry\.json/.exec(
        instructions,
      ) ?? [undefined, undefined];
      expect(port).toBeDefined();

      const result = await agent.callTool(addTile("started-in-the-background"));
      expect(result.isError).toBeFalsy();

      await page.goto(`http://127.0.0.1:${port}`);
      const tile = page.locator('[data-tile-id="started-in-the-background"]');
      await expect(tile).toBeVisible();
      await expect(tile).toContainText("7");
      await page.screenshot({
        path: "screenshots/dry-run-agent-started-its-own.png",
        fullPage: true,
      });
    } finally {
      await agent.close();
    }
    // Its workspace is one this check made, and afterEach removes it.
    expect(workspaces().length).toBeGreaterThan(before.length);
  });

  test("a port serving somebody else's state costs a warning, not the run", async () => {
    const foreign = mkdtempSync(path.join(tmpdir(), "not-a-dry-run-"));
    try {
      const before = workspaces();
      const port = 5199;
      start([TSX_CLI, path.join(REPO_ROOT, "src", "server", "index.ts")], {
        PORT: String(port),
        DASHBOARD_WORKSPACE: foreign,
      });
      await until(
        async () =>
          (await servedWorkspace(port)) === foreign ? true : undefined,
        "the foreign dashboard",
      );

      const attempt = start([TSX_CLI, RUNNER, "mcp"], { PORT: String(port) });
      const stderr = collectStderr(attempt);
      const mine = await newRun(before);

      expect(mine.port).not.toBe(port);
      expect(attempt.exitCode).toBeNull();
      expect(stderr()).toContain("will not write into");
      // The dashboard it declined to use is untouched.
      expect(await servedWorkspace(port)).toBe(foreign);
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });
});
