import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  checkMutationPermission,
  stampEntryOwnership,
  type ItemSchemas,
} from "../auth/permissions";
import type { Account } from "../auth/types";
import { workspaceDirectory } from "../workspace";

import {
  EMPTY_DASHBOARD,
  MutationError,
  type Dashboard,
  type Mutation,
  type Tile,
  type TileReference,
  type TileSize,
} from "./types";

/** Browser checks point this at a throwaway directory so a run never touches real dashboard data. */
const DASHBOARD_DIR = workspaceDirectory();
const DASHBOARD_FILE = path.join(DASHBOARD_DIR, "dashboard.json");

/**
 * Which directory this process is actually serving. A caller that finds a
 * dashboard already answering on a port cannot otherwise tell whether it is
 * serving the same state, and attaching to the wrong one is silent.
 */
export const dashboardDirectory = (): string => DASHBOARD_DIR;

export async function readDashboard(): Promise<Dashboard> {
  try {
    return JSON.parse(await readFile(DASHBOARD_FILE, "utf8")) as Dashboard;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return EMPTY_DASHBOARD;
    throw error;
  }
}

/** Write-and-rename: a concurrent reader sees the old file or the new one, never half of one. */
export async function writeDashboard(dashboard: Dashboard): Promise<void> {
  await mkdir(DASHBOARD_DIR, { recursive: true });
  const staged = `${DASHBOARD_FILE}.${process.pid}.tmp`;
  await writeFile(staged, `${JSON.stringify(dashboard, null, 2)}\n`, "utf8");
  await rename(staged, DASHBOARD_FILE);
}

const requireTile = (dashboard: Dashboard, tileId: string): Tile => {
  const tile = dashboard.tiles.find((candidate) => candidate.id === tileId);
  if (!tile)
    throw new MutationError("unknown-tile", `No tile with id "${tileId}".`);
  return tile;
};

const withReference = (
  references: readonly TileReference[],
  reference: TileReference,
  index: number | undefined,
): readonly TileReference[] => {
  const next = references.filter(
    (candidate) => candidate.tileId !== reference.tileId,
  );
  const at =
    index === undefined
      ? next.length
      : Math.max(0, Math.min(index, next.length));
  return [...next.slice(0, at), reference, ...next.slice(at)];
};

const applyMutation = (
  dashboard: Dashboard,
  mutation: Mutation,
  account: Account,
  itemSchemas: ItemSchemas,
): Dashboard => {
  const failure = checkMutationPermission({
    mutation,
    account,
    dashboard,
    itemSchemas,
  });
  if (failure) {
    throw new MutationError(
      failure,
      `Account "${account.id}" (role "${account.role}") may not apply a "${mutation.type}" mutation.`,
    );
  }
  switch (mutation.type) {
    case "add-tile": {
      if (dashboard.tiles.some((tile) => tile.id === mutation.tile.id)) {
        throw new MutationError(
          "duplicate-tile",
          `A tile with id "${mutation.tile.id}" already exists.`,
        );
      }
      return {
        tiles: [...dashboard.tiles, mutation.tile],
        references: withReference(
          dashboard.references,
          { tileId: mutation.tile.id, size: mutation.size ?? "md" },
          mutation.index,
        ),
      };
    }
    case "remove-tile": {
      requireTile(dashboard, mutation.tileId);
      return {
        tiles: dashboard.tiles.filter((tile) => tile.id !== mutation.tileId),
        references: dashboard.references.filter(
          (reference) => reference.tileId !== mutation.tileId,
        ),
      };
    }
    case "set-tile-state": {
      const existing = requireTile(dashboard, mutation.tileId);
      const state = stampEntryOwnership(
        existing.state,
        mutation.state,
        account.id,
      );
      return {
        tiles: dashboard.tiles.map((tile) =>
          tile.id === mutation.tileId ? { ...existing, state } : tile,
        ),
        references: dashboard.references,
      };
    }
    case "set-tile-title": {
      const existing = requireTile(dashboard, mutation.tileId);
      return {
        tiles: dashboard.tiles.map((tile) =>
          tile.id === mutation.tileId
            ? { ...existing, title: mutation.title }
            : tile,
        ),
        references: dashboard.references,
      };
    }
    case "place-tile": {
      requireTile(dashboard, mutation.tileId);
      const current = dashboard.references.find(
        (reference) => reference.tileId === mutation.tileId,
      );
      const size: TileSize = mutation.size ?? current?.size ?? "md";
      const index =
        mutation.index ??
        (current ? dashboard.references.indexOf(current) : undefined);
      return {
        tiles: dashboard.tiles,
        references: withReference(
          dashboard.references,
          { tileId: mutation.tileId, size },
          index,
        ),
      };
    }
  }
};

/**
 * All or nothing: a failing mutation leaves the input untouched, since
 * nothing is written until every one applies. `account` is required — there
 * is no code path that applies a mutation without a resolved acting account.
 */
export const applyMutations = (
  dashboard: Dashboard,
  mutations: readonly Mutation[],
  account: Account,
  itemSchemas: ItemSchemas,
): Dashboard =>
  mutations.reduce(
    (current, mutation) =>
      applyMutation(current, mutation, account, itemSchemas),
    dashboard,
  );

/**
 * The workspace's registry items by name, for the permission decision's
 * interactive-field lookup. Read per `apply` rather than cached: an agent
 * adds items to this file while the server runs, and a stale map would gate
 * a field its author marked interactive. A missing or unreadable registry
 * yields no items, so the decision falls back to ownership.
 */
export async function readItemSchemas(): Promise<ItemSchemas> {
  try {
    const registry = JSON.parse(
      await readFile(path.join(workspaceDirectory(), "registry.json"), "utf8"),
    ) as { items?: readonly { name: string; meta?: { schema?: unknown } }[] };
    return Object.fromEntries(
      (registry.items ?? []).map((item) => [
        item.name,
        item.meta?.schema ?? {},
      ]),
    ) as ItemSchemas;
  } catch {
    return {};
  }
}
