import { describe, expect, it, vi } from "vitest";

import { ROLES } from "../auth/permissions";
import type { Account } from "../auth/types";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyMutations, readItemSchemas } from "./store";
import {
  EMPTY_DASHBOARD,
  MutationError,
  type Dashboard,
  type Mutation,
  type Tile,
} from "./types";

const editor: Account = { id: "acct-editor", role: "editor" };
const contributor: Account = { id: "acct-contributor", role: "contributor" };

// Neither default role stops short of `write` on `data`, so proving
// ownership's narrowing (see src/auth/permissions.test.ts) needs a role
// registered here, in the test, rather than a change to what `editor` or
// `contributor` themselves grant.
ROLES["data-editor"] = {
  data: "edit",
  tiles: "noAccess",
  integrations: "noAccess",
  roles: "noAccess",
};
const dataEditor: Account = { id: "acct-data-editor", role: "data-editor" };

const tile = (id: string): Tile => ({
  id,
  title: id,
  item: "stat-tile",
  state: { LABEL: id, VALUE: 1 },
});

const add = (
  id: string,
  mutation: Partial<Extract<Mutation, { type: "add-tile" }>> = {},
): Mutation => ({
  type: "add-tile",
  tile: tile(id),
  ...mutation,
});

const two: Dashboard = applyMutations(
  EMPTY_DASHBOARD,
  [add("a"), add("b")],
  editor,
  {},
);

describe("applyMutations", () => {
  it("places a new tile last at md, since that is the width an agent gets without asking", () => {
    expect(two.references).toEqual([
      { tileId: "a", size: "md" },
      { tileId: "b", size: "md" },
    ]);
  });

  it("orders by index, so 'put this first' is expressible", () => {
    const moved = applyMutations(
      two,
      [{ type: "place-tile", tileId: "b", index: 0 }],
      editor,
      {},
    );

    expect(moved.references.map((reference) => reference.tileId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("keeps a tile's size when only its position moves", () => {
    const resized = applyMutations(
      two,
      [{ type: "place-tile", tileId: "a", size: "lg" }],
      editor,
      {},
    );
    const moved = applyMutations(
      resized,
      [{ type: "place-tile", tileId: "a", index: 1 }],
      editor,
      {},
    );

    expect(moved.references).toContainEqual({ tileId: "a", size: "lg" });
  });

  it("drops a removed tile's reference as well as the tile", () => {
    const removed = applyMutations(
      two,
      [{ type: "remove-tile", tileId: "a" }],
      editor,
      {},
    );

    expect(removed.tiles.map((entry) => entry.id)).toEqual(["b"]);
    expect(removed.references.map((reference) => reference.tileId)).toEqual([
      "b",
    ]);
  });

  it("names the failure rather than throwing prose a caller has to match on", () => {
    expect(() =>
      applyMutations(
        two,
        [{ type: "set-tile-state", tileId: "missing", state: {} }],
        editor,
        {},
      ),
    ).toThrowError(
      expect.objectContaining({ failure: "unknown-tile" }) as MutationError,
    );
  });

  it("applies all or nothing — a later failure leaves no trace of an earlier success", () => {
    expect(() =>
      applyMutations(
        two,
        [add("c"), { type: "remove-tile", tileId: "missing" }],
        editor,
        {},
      ),
    ).toThrow();

    expect(two.tiles.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  // Story 6: an account with `write` on `tiles` may add, remove, retitle, and place tiles.
  it("lets a role with write on tiles add, remove, retitle, and place tiles", () => {
    expect(() =>
      applyMutations(EMPTY_DASHBOARD, [add("c")], editor, {}),
    ).not.toThrow();
    expect(() =>
      applyMutations(
        two,
        [{ type: "set-tile-title", tileId: "a", title: "New title" }],
        editor,
        {},
      ),
    ).not.toThrow();
  });

  // Story 7: an account without write on tiles is refused all four tile mutations.
  it("refuses add-tile, remove-tile, set-tile-title, and place-tile for a role lacking write on tiles", () => {
    const denied = expect.objectContaining({
      failure: "forbidden",
    }) as MutationError;

    expect(() => applyMutations(two, [add("c")], contributor, {})).toThrowError(
      denied,
    );
    expect(() =>
      applyMutations(
        two,
        [{ type: "remove-tile", tileId: "a" }],
        contributor,
        {},
      ),
    ).toThrowError(denied);
    expect(() =>
      applyMutations(
        two,
        [{ type: "set-tile-title", tileId: "a", title: "Renamed" }],
        contributor,
        {},
      ),
    ).toThrowError(denied);
    expect(() =>
      applyMutations(
        two,
        [{ type: "place-tile", tileId: "a", size: "lg" }],
        contributor,
        {},
      ),
    ).toThrowError(denied);
  });

  // Story 8: no ownership exception — a tile belongs to the dashboard, not whoever
  // added it, so the tiles branch takes no ownership input at all. There is nothing
  // on a Tile to record who added it (by design), so this is proven the only way
  // it can be: denial does not vary with which tile, or whose, is named.
  it("refuses a tile mutation from a role lacking write on tiles, with no exception for any tile it names", () => {
    const dashboardWithOwnTile = applyMutations(
      EMPTY_DASHBOARD,
      [add(contributor.id)],
      editor,
      {},
    );

    expect(() =>
      applyMutations(
        dashboardWithOwnTile,
        [
          {
            type: "set-tile-title",
            tileId: contributor.id,
            title: "Still refused",
          },
        ],
        contributor,
        {},
      ),
    ).toThrowError(
      expect.objectContaining({ failure: "forbidden" }) as MutationError,
    );
  });

  describe("data ownership", () => {
    const listTile = (id: string): Mutation => ({
      type: "add-tile",
      tile: { id, title: id, item: "stat-tile", state: { LIST_ITEMS: [] } },
    });

    // Story: the entry an account just added records that account as owner.
    it("stamps a new entry with a fresh id and the acting account as owner", () => {
      const withTile = applyMutations(
        EMPTY_DASHBOARD,
        [listTile("list")],
        editor,
        {},
      );
      const withEntry = applyMutations(
        withTile,
        [
          {
            type: "set-tile-state",
            tileId: "list",
            state: { LIST_ITEMS: [{ text: "first" }] },
          },
        ],
        editor,
        {},
      );

      const [entry] = withEntry.tiles[0]!.state.LIST_ITEMS as Record<
        string,
        unknown
      >[];
      expect(entry).toMatchObject({ owner: editor.id, text: "first" });
      expect(typeof entry!.entryId).toBe("string");
    });

    it("keeps an entry's id and owner unchanged across a content edit, including by the owner alone under a level short of write", () => {
      // Built directly rather than via a create mutation: creating needs
      // `write` on `data`, which `dataEditor` doesn't hold, so an entry it
      // owns has to already exist to prove it may still edit its own.
      const ownedEntry = { entryId: "e1", owner: dataEditor.id, text: "first" };
      const withTile = applyMutations(
        EMPTY_DASHBOARD,
        [
          {
            type: "add-tile",
            tile: {
              id: "list",
              title: "list",
              item: "stat-tile",
              state: { LIST_ITEMS: [ownedEntry] },
            },
          },
        ],
        editor,
        {},
      );

      const edited = applyMutations(
        withTile,
        [
          {
            type: "set-tile-state",
            tileId: "list",
            state: {
              LIST_ITEMS: [{ ...ownedEntry, text: "first, edited" }],
            },
          },
        ],
        dataEditor,
        {},
      );

      expect(edited.tiles[0]!.state.LIST_ITEMS).toEqual([
        { ...ownedEntry, text: "first, edited" },
      ]);
    });

    // Story: without write on data, editing or deleting an entry the
    // account does not own is refused, even for the account that added it
    // originally, once ownership belongs to someone else.
    it("refuses editing another account's entry for a role lacking write on data", () => {
      const withTile = applyMutations(
        EMPTY_DASHBOARD,
        [listTile("list")],
        editor,
        {},
      );
      const withEntry = applyMutations(
        withTile,
        [
          {
            type: "set-tile-state",
            tileId: "list",
            state: { LIST_ITEMS: [{ text: "editor's entry" }] },
          },
        ],
        editor,
        {},
      );

      expect(() =>
        applyMutations(
          withEntry,
          [
            {
              type: "set-tile-state",
              tileId: "list",
              state: { LIST_ITEMS: [] },
            },
          ],
          dataEditor,
          {},
        ),
      ).toThrowError(
        expect.objectContaining({ failure: "forbidden" }) as MutationError,
      );
    });

    // Story: an account with write on data may correct or remove an entry
    // regardless of who owns it.
    it("lets a role with write on data edit and delete an entry it does not own", () => {
      const withTile = applyMutations(
        EMPTY_DASHBOARD,
        [listTile("list")],
        editor,
        {},
      );
      const withEntry = applyMutations(
        withTile,
        [
          {
            type: "set-tile-state",
            tileId: "list",
            state: { LIST_ITEMS: [{ text: "contributor's entry" }] },
          },
        ],
        contributor,
        {},
      );

      const removed = applyMutations(
        withEntry,
        [{ type: "set-tile-state", tileId: "list", state: { LIST_ITEMS: [] } }],
        editor,
        {},
      );
      expect(removed.tiles[0]!.state.LIST_ITEMS).toEqual([]);
    });
  });
});

describe("readItemSchemas", () => {
  // The registry that governs an interactive field is the workspace's, which
  // an agent adds items to while the server runs — not the copy in this repo.
  // Reading the wrong one silently gates a field its author marked interactive.
  it("reads the workspace's registry, not the app's own", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "registry-source-"));
    writeFileSync(
      path.join(workspace, "registry.json"),
      JSON.stringify({
        items: [
          { name: "workspace-only-item", meta: { schema: { type: "object" } } },
        ],
      }),
    );
    vi.stubEnv("DASHBOARD_WORKSPACE", workspace);
    try {
      expect(await readItemSchemas()).toEqual({
        "workspace-only-item": { type: "object" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("yields no items when the workspace has no registry", async () => {
    vi.stubEnv(
      "DASHBOARD_WORKSPACE",
      mkdtempSync(path.join(tmpdir(), "registry-absent-")),
    );
    try {
      expect(await readItemSchemas()).toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
