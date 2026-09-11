import { expect, test } from "@playwright/test";
import { exec } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Tile } from "@/dashboard/types";
import { connectMcpClient, type McpTestClient } from "./support/mcp-client";
import { E2E_PORT, E2E_WORKSPACE } from "../playwright.config";

/**
 * B3 acceptance check (SHADCN_REWRITE_PLAN.md): "a tile added while the
 * server is running renders after a browser reload, with no client rebuild
 * and no restart." This is the specific old break B3 names: the client used
 * to render from a compile-time map that nothing rebuilt, so a newly-added
 * tile could never appear. `src/client/TileHost.tsx` now resolves components
 * through a lazy `import.meta.glob("/src/registry/*.tsx")` instead — this
 * test is what stops anyone reintroducing a hand-maintained map.
 *
 * This is the only B3/B4-family check that mutates shared repo state
 * (`registry.json`, `src/registry/*.tsx`, `public/r/*.json`) rather than only
 * the dashboard's own workspace file, so it must run alone, never alongside
 * sibling acceptance checks that also touch the registry.
 */

const execAsync = promisify(exec);

const WORKSPACE = E2E_WORKSPACE;
const PORT = E2E_PORT;
const REGISTRY_URL = `http://127.0.0.1:${PORT}/r/registry.json`;

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY_JSON_PATH = path.join(REPO_ROOT, "registry.json");

const FIXTURE_NAME = "b3-fixture-tile";
const FIXTURE_MESSAGE = "b3 fixture rendered live, no rebuild";
const FIXTURE_COMPONENT_PATH = path.join(
  REPO_ROOT,
  "src/registry",
  `${FIXTURE_NAME}.tsx`,
);
const FIXTURE_BUILT_PATH = path.join(
  REPO_ROOT,
  "public/r",
  `${FIXTURE_NAME}.json`,
);

const FIXTURE_COMPONENT_SOURCE = `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { schemas } from "./schemas.generated"
import type { JsonSchemaToType } from "./schema"

type B3FixtureTileProps = JsonSchemaToType<(typeof schemas)["${FIXTURE_NAME}"]>

export default function B3FixtureTile({ MESSAGE }: B3FixtureTileProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>B3 Fixture</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{MESSAGE}</p>
      </CardContent>
    </Card>
  )
}
`;

const FIXTURE_REGISTRY_ITEM = {
  name: FIXTURE_NAME,
  type: "registry:component",
  title: "B3 Fixture Tile",
  description:
    "Test-only fixture for the B3 acceptance check. Never shipped; removed by the test's own cleanup.",
  files: [
    { path: `src/registry/${FIXTURE_NAME}.tsx`, type: "registry:component" },
  ],
  meta: {
    schema: {
      type: "object",
      properties: { MESSAGE: { type: "string", default: "" } },
      required: ["MESSAGE"],
      additionalProperties: false,
    },
  },
};

// Exact bytes of registry.json as found, restored verbatim at cleanup —
// module scope so both the test body and the afterAll cleanup helper share
// one snapshot. registry.json is untracked on this branch, so `git diff`
// cannot catch a corrupted restore; only this byte-for-byte compare can.
let originalRegistryJson = "";

test.describe("B3 — new tiles render", () => {
  test.describe.configure({ mode: "serial" }); // shared workspace + shared registry.json — no concurrent mutation

  let client: McpTestClient;

  test.beforeAll(async () => {
    client = await connectMcpClient(WORKSPACE);
    originalRegistryJson = readFileSync(REGISTRY_JSON_PATH, "utf8");
  });

  test.afterAll(async () => {
    await removeFixture();
    await client.close();
  });

  test.beforeEach(async () => {
    await resetDashboard(client);
  });

  test("a tile added while the server runs renders after reload, served by the same process throughout", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // 1. Before the item exists anywhere, its content must not be on the
    // page. Without this half, the test would pass even against a tile that
    // had been sitting on the dashboard all along.
    const registryBefore = await fetchRegistry();
    expect(
      registryBefore.items.some((item) => item.name === FIXTURE_NAME),
      `"${FIXTURE_NAME}" must not already be in the served registry before it is added`,
    ).toBe(false);

    await page.goto("/");
    await expect(page.getByText(FIXTURE_MESSAGE)).toHaveCount(0);

    // Process-identifying signal, captured before any change: the OS-level
    // PID bound to the dev server's listening socket. Compared against the
    // same reading taken after the reload below.
    const pidBeforeChange = await listeningPid(PORT);

    // 2. Add the tile while the server keeps running: write the component
    // file and its registry item directly to disk, the way a human editing
    // the repo would, then let the server's own file watcher pick it up.
    writeFileSync(FIXTURE_COMPONENT_PATH, FIXTURE_COMPONENT_SOURCE, "utf8");
    const registry = JSON.parse(originalRegistryJson) as { items: unknown[] };
    registry.items.push(FIXTURE_REGISTRY_ITEM);
    writeFileSync(
      REGISTRY_JSON_PATH,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    );

    // 3. Wait for the debounced rebuild to finish — poll the observable
    // outcome (the served registry), never a fixed sleep.
    await waitForRegistryItem(true, 90_000);

    // 4. Place a tile of the new item on the dashboard through the same MCP
    // `apply` tool an agent would use — never by writing dashboard.json
    // directly, which would skip the interface actually under test.
    await client.callTool("apply", {
      mutations: [
        {
          type: "add-tile",
          tile: {
            id: "b3-fixture",
            title: "B3 Fixture",
            item: FIXTURE_NAME,
            state: { MESSAGE: FIXTURE_MESSAGE },
          },
          size: "md",
        },
      ],
    });

    // 5. Reload — no client rebuild, no server restart — and confirm it renders.
    await page.reload();
    await expect(page.getByText(FIXTURE_MESSAGE)).toBeVisible();

    const pidAfterChange = await listeningPid(PORT);
    expect(
      pidAfterChange,
      "the OS-level PID bound to the dev server's port must be identical before and after — " +
        "the only evidence available from outside the process that the same one served both loads",
    ).toBe(pidBeforeChange);

    await page.screenshot({
      path: "screenshots/b3-new-tile-renders-after-reload.png",
    });
  });

  test("a tile whose state violates its schema is refused, not rendered — and the rest of the dashboard still renders", async ({
    page,
  }) => {
    await client.callTool("apply", {
      mutations: [
        {
          type: "add-tile",
          tile: {
            id: "b3-valid",
            title: "Valid",
            item: "stat-tile",
            state: { LABEL: "Still Renders", VALUE: 1 },
          },
          size: "sm",
        },
        {
          type: "add-tile",
          // LABEL must be a string per stat-tile's meta.schema. A *missing*
          // required key would not do here — z.fromJSONSchema backfills a
          // missing key from the schema's own "default", so only a genuine
          // type mismatch (or an extra key under additionalProperties: false)
          // actually fails safeParse.
          tile: {
            id: "b3-invalid",
            title: "Invalid",
            item: "stat-tile",
            state: { LABEL: 12345, VALUE: 1 },
          },
          size: "sm",
        },
      ],
    });

    await page.goto("/");

    // The bad tile alone must not blank the page: its neighbour still renders.
    await expect(
      page.locator('[data-tile-id="b3-valid"]').getByText("Still Renders"),
    ).toBeVisible();

    const invalidTile = page.locator('[data-tile-id="b3-invalid"]');
    await expect(invalidTile.getByRole("alert")).toBeVisible();
    await expect(invalidTile.getByText("12345")).toHaveCount(0);

    await page.screenshot({
      path: "screenshots/b3-invalid-state-shows-alert-not-blank-page.png",
    });
  });
});

async function resetDashboard(client: McpTestClient): Promise<void> {
  const { tiles } = await client.callTool<{ tiles: readonly Tile[] }>(
    "read-dashboard",
    { scope: ["tiles"] },
  );
  if (tiles.length === 0) return;
  await client.callTool("apply", {
    mutations: tiles.map((tile) => ({ type: "remove-tile", tileId: tile.id })),
  });
}

async function fetchRegistry(): Promise<{
  items: readonly { name: string }[];
}> {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok)
    throw new Error(`GET ${REGISTRY_URL} failed: ${response.status}`);
  return (await response.json()) as { items: readonly { name: string }[] };
}

/** Polls the served registry for the fixture's presence/absence. Never a fixed sleep — the rebuild's duration varies. */
async function waitForRegistryItem(
  present: boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const registry = await fetchRegistry();
    const found = registry.items.some((item) => item.name === FIXTURE_NAME);
    if (found === present) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for "${FIXTURE_NAME}" to be ` +
          `${present ? "present in" : "removed from"} ${REGISTRY_URL}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * PID of the process with a LISTENING TCP socket on `port`, read from the OS
 * rather than the app — the only evidence available from outside the process
 * that no restart happened between two points in a test.
 */
async function listeningPid(port: number): Promise<string> {
  const { stdout } = await execAsync("netstat -ano -p TCP");
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => {
      const parts = entry.split(/\s+/);
      return (
        parts[0] === "TCP" &&
        parts[1]?.endsWith(`:${port}`) &&
        parts[3] === "LISTENING"
      );
    });
  if (!line)
    throw new Error(
      `no LISTENING TCP socket found for port ${port} — is the dev server up?`,
    );
  const parts = line.split(/\s+/);
  const pid = parts[4];
  if (!pid)
    throw new Error(`could not parse a PID from netstat line: "${line}"`);
  return pid;
}

/** Leaves no trace: fixture file, registry item, built output, and workspace dashboard state all removed. */
async function removeFixture(): Promise<void> {
  rmSync(FIXTURE_COMPONENT_PATH, { force: true });
  if (originalRegistryJson)
    writeFileSync(REGISTRY_JSON_PATH, originalRegistryJson, "utf8");
  await waitForRegistryItem(false, 90_000);
  rmSync(FIXTURE_BUILT_PATH, { force: true });
  rmSync(path.join(REPO_ROOT, WORKSPACE, "dashboard.json"), { force: true });
}
