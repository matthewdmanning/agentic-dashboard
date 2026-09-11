import { test, expect } from "@playwright/test";
import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { E2E_CONFIG, E2E_ORIGIN, E2E_WORKSPACE } from "../playwright.config";

/**
 * B1 — tile discovery (see `SHADCN_REWRITE_PLAN.md`): an agent with nothing
 * installed locally and no copy of this repository must be able to name
 * every available tile and each one's required state keys, using only what
 * the MCP server sends on connect plus `shadcn search` / `view` against the
 * dashboard's own registry. All three checks below run from that agent's
 * position: a bare temp directory or a bare stdio connection, never this
 * repo's own installed `shadcn` or its `node_modules`.
 */

test.describe.configure({ mode: "serial" });

const execAsync = promisify(exec);

const REGISTRY_URL = `${E2E_ORIGIN}/r/registry.json`;

interface RegistryItem {
  name: string;
  meta: { schema: { required: string[] } };
}

// Read at test time, not hard-coded, so a tile added later is still covered.
const registry = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "registry.json"), "utf8"),
) as {
  items: RegistryItem[];
};

/**
 * Runs `npx shadcn@latest <args>` and returns stdout.
 *
 * On Windows the CLI's own process sometimes exits non-zero from a libuv
 * teardown assertion (`UV_HANDLE_CLOSING`) after printing correct output —
 * a CLI/Windows quirk unrelated to the command's result. `exec` still
 * attaches real stdout to the rejection in that case, so a non-zero exit is
 * only treated as fatal here when no stdout came back at all.
 */
async function runShadcn(args: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`npx shadcn@latest ${args}`, {
      cwd,
      timeout: E2E_CONFIG.tests.discoverySearchTimeout,
    });
    return stdout;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.length > 0) return stdout;
    throw error;
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  // Outside the repo entirely, so no ambient components.json/package.json
  // from this checkout can leak into what the CLI sees.
  const dir = await mkdtemp(path.join(tmpdir(), "b1-discovery-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 250,
    });
  }
}

test("shadcn search, from a directory with no components.json and no package.json, names every registry item", async () => {
  test.setTimeout(E2E_CONFIG.tests.discoverySearchTimeout);
  await withTempDir(async (dir) => {
    expect(existsSync(path.join(dir, "components.json"))).toBe(false);
    expect(existsSync(path.join(dir, "package.json"))).toBe(false);

    const stdout = await runShadcn(`search ${REGISTRY_URL}`, dir);

    for (const item of registry.items) {
      expect(stdout).toContain(`/r/${item.name}.json`);
    }
  });
});

test("shadcn view reports each item's required state keys exactly as declared in registry.json", async () => {
  test.setTimeout(E2E_CONFIG.tests.discoveryViewTimeout);
  await withTempDir(async (dir) => {
    for (const item of registry.items) {
      const stdout = await runShadcn(
        `view ${E2E_ORIGIN}/r/${item.name}.json`,
        dir,
      );
      const jsonStart = stdout.indexOf("[");
      const jsonEnd = stdout.lastIndexOf("]");
      const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as Array<{
        meta?: { schema?: { required?: string[] } };
      }>;
      const required = parsed[0]?.meta?.schema?.required ?? [];

      expect([...required].sort()).toEqual(
        [...item.meta.schema.required].sort(),
      );
    }
  });
});

test("the MCP server's connect-time instructions name the registry URL and both discovery commands", async () => {
  test.setTimeout(E2E_CONFIG.tests.discoveryMcpTimeout);
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "mcp"],
    cwd: process.cwd(),
    env: { DASHBOARD_WORKSPACE: E2E_WORKSPACE },
    stderr: "pipe",
  });
  const client = new Client({ name: "b1-discovery-test", version: "0.0.0" });

  try {
    await client.connect(transport);
    const instructions = client.getInstructions() ?? "";

    expect(instructions).toMatch(/\/r\/registry\.json/);
    expect(instructions).toMatch(/shadcn@latest search/);
    expect(instructions).toMatch(/shadcn@latest view/);
  } finally {
    await client.close();
  }
});
