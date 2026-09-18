import type { Tile, TileReference } from "@/dashboard/types";
import type { McpTestClient } from "./mcp-client";

export type DashboardSnapshot = {
  readonly tiles: readonly Tile[];
  readonly references: readonly TileReference[];
};

export async function snapshotDashboard(
  client: McpTestClient,
): Promise<DashboardSnapshot> {
  return client.callTool<DashboardSnapshot>("read-dashboard", {
    scope: ["tiles", "references"],
  });
}

export async function clearDashboard(client: McpTestClient): Promise<void> {
  const { tiles } = await client.callTool<{ tiles: readonly Tile[] }>(
    "read-dashboard",
    { scope: ["tiles"] },
  );
  if (tiles.length === 0) return;
  await client.callTool("apply", {
    mutations: tiles.map((tile) => ({ type: "remove-tile", tileId: tile.id })),
  });
}

/**
 * Clears whatever is on the dashboard now and re-adds exactly the given
 * snapshot's tiles, in reference order — so a suite that clears the shared
 * workspace dashboard to drive its own tests (B3, B4) leaves the fixture's
 * original tiles in place for whatever spec runs next, instead of leaving it
 * empty.
 */
export async function restoreDashboard(
  client: McpTestClient,
  original: DashboardSnapshot,
): Promise<void> {
  await clearDashboard(client);
  const mutations = original.references.map((reference) => {
    const tile = original.tiles.find((t) => t.id === reference.tileId);
    if (!tile)
      throw new Error(`no tile found for reference "${reference.tileId}"`);
    return { type: "add-tile", tile, size: reference.size };
  });
  if (mutations.length > 0) await client.callTool("apply", { mutations });
}
