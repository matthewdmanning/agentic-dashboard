import { expect, test, type Page } from "@playwright/test";

import type { Tile, TileReference, TileSize } from "@/dashboard/types";
import { connectMcpClient, type McpTestClient } from "./support/mcp-client";
import { E2E_WORKSPACE } from "../playwright.config";

/**
 * B4 acceptance check (SHADCN_REWRITE_PLAN.md): "put these two side by side"
 * must produce one row of two `md` tiles, "make it full width" must produce
 * one `lg`, and the result must be visibly a grid, not a stack — the old
 * break, where `insert-card` only took `cardId` and `index`.
 *
 * State is driven through the MCP `apply` tool, the same interface an agent
 * uses — never by writing dashboard.json directly, which would test the
 * renderer while skipping the interface actually under test.
 */

const WORKSPACE = E2E_WORKSPACE;
// Sub-pixel layout rounding tolerance. Generous enough to absorb browser
// rounding, tight enough that a real one-column-width miss still fails.
const TOLERANCE_PX = 2;

test.use({ viewport: { width: 1280, height: 900 } });

test.describe("B4 — layout", () => {
  test.describe.configure({ mode: "serial" }); // one shared workspace/dashboard.json — no concurrent apply calls

  let client: McpTestClient;

  test.beforeAll(async () => {
    client = await connectMcpClient(WORKSPACE);
  });

  test.afterAll(async () => {
    await client.close();
  });

  test.beforeEach(async () => {
    await resetDashboard(client);
  });

  test("two md tiles land in the same row", async ({ page }) => {
    await applyTiles(client, [
      { id: "row-a", size: "md", label: "A" },
      { id: "row-b", size: "md", label: "B" },
    ]);
    await page.goto("/");

    const boxA = await requireTileBox(page, "row-a");
    const boxB = await requireTileBox(page, "row-b");

    expect(
      Math.abs(boxA.y - boxB.y),
      "two 'md' tiles should share the same top (y) coordinate",
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      boxA.x,
      "two 'md' tiles should sit at different x — same x would mean the second sits under the first",
    ).not.toBeCloseTo(boxB.x, 0);

    const [left, right] = boxA.x <= boxB.x ? [boxA, boxB] : [boxB, boxA];
    expect(
      left.x + left.width,
      "the left 'md' tile must not horizontally overlap the right one",
    ).toBeLessThanOrEqual(right.x + TOLERANCE_PX);

    await page.screenshot({ path: "screenshots/b4-two-md-tiles-one-row.png" });
  });

  test("an lg tile spans the full grid width", async ({ page }) => {
    await applyTiles(client, [{ id: "full-a", size: "lg", label: "Full" }]);
    await page.goto("/");

    const box = await requireTileBox(page, "full-a");
    const innerWidth = await gridInnerWidth(page);

    expect(
      Math.abs(box.width - innerWidth),
      `an 'lg' tile (${box.width}px) should fill the grid's inner content width (${innerWidth}px)`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    await page.screenshot({
      path: "screenshots/b4-one-lg-tile-full-width.png",
    });
  });

  test("two md tiles are not stacked into a single column", async ({
    page,
  }) => {
    await applyTiles(client, [
      { id: "stack-a", size: "md", label: "A" },
      { id: "stack-b", size: "md", label: "B" },
    ]);
    await page.goto("/");

    const boxA = await requireTileBox(page, "stack-a");
    const boxB = await requireTileBox(page, "stack-b");

    // The load-bearing negative: this is precisely the old B4 break —
    // `insert-card` took only `cardId` and `index`, so the best possible
    // layout was a single-column stack. A y-mismatch here means the grid
    // regressed to that behaviour.
    expect(
      Math.abs(boxA.y - boxB.y),
      "REGRESSION: two 'md' tiles rendered at different y (stacked vertically) instead of side by side — " +
        "this is the pre-rebuild one-dimensional layout (insert-card took only cardId + index)",
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    await page.screenshot({
      path: "screenshots/b4-two-md-tiles-not-stacked.png",
    });
  });

  test("reordering with place-tile changes on-screen order to match references", async ({
    page,
  }) => {
    await applyTiles(client, [
      { id: "order-a", size: "sm", label: "A" },
      { id: "order-b", size: "sm", label: "B" },
      { id: "order-c", size: "sm", label: "C" },
    ]);
    await client.callTool("apply", {
      mutations: [{ type: "place-tile", tileId: "order-c", index: 0 }],
    });

    const { references } = await client.callTool<{
      references: readonly TileReference[];
    }>("read-dashboard", {
      scope: ["references"],
    });
    const expectedOrder = references.map((reference) => reference.tileId);

    await page.goto("/");
    // evaluateAll does not auto-wait like locator actions do — wait for all
    // three tiles to attach first, or this races the initial data fetch.
    await expect(page.locator("[data-tile-id]")).toHaveCount(
      expectedOrder.length,
    );
    const domOrder = await page
      .locator("[data-tile-id]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-tile-id")),
      );

    expect(
      domOrder,
      "on-screen left-to-right/top-to-bottom order must match the dashboard's references order",
    ).toEqual(expectedOrder);

    await page.screenshot({
      path: "screenshots/b4-reorder-matches-references.png",
    });
  });
});

type TileSpec = {
  readonly id: string;
  readonly size: TileSize;
  readonly label: string;
};

async function applyTiles(
  client: McpTestClient,
  tiles: readonly TileSpec[],
): Promise<void> {
  await client.callTool("apply", {
    mutations: tiles.map((spec) => ({
      type: "add-tile",
      tile: {
        id: spec.id,
        title: spec.id,
        item: "stat-tile",
        state: { LABEL: spec.label, VALUE: 1 },
      },
      size: spec.size,
    })),
  });
}

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

async function requireTileBox(page: Page, tileId: string) {
  const box = await page.locator(`[data-tile-id="${tileId}"]`).boundingBox();
  if (!box)
    throw new Error(`no bounding box for tile "${tileId}" — is it rendered?`);
  return box;
}

/** Content-box width of the grid container, derived from the DOM rather than a class-name lookup. */
async function gridInnerWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cell = document.querySelector("[data-tile-id]");
    const grid = cell?.parentElement;
    if (!grid)
      throw new Error(
        "no grid container found (no [data-tile-id] cell on the page)",
      );
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    return (
      rect.width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    );
  });
}
