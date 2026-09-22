import { describe, expect, it } from "vitest";

import {
  EMPTY_DASHBOARD,
  type Dashboard,
  type Mutation,
  type Tile,
} from "../dashboard/types";

import {
  checkMutationPermission,
  ROLES,
  type ItemSchemas,
} from "./permissions";
import type { Account } from "./types";

import { schemas } from "../../registry/schemas.generated";

/** The schemas the registry actually ships, as `readItemSchemas` would hand them to the decision. */
const SHIPPED_ITEM_SCHEMAS = schemas as unknown as ItemSchemas;

const editor: Account = { id: "acct-editor", role: "editor" };
const contributor: Account = { id: "acct-contributor", role: "contributor" };
const unknownRole: Account = { id: "acct-ghost", role: "not-a-real-role" };

// Neither default role stops short of `write` on `data`, so ownership's
// narrowing (settled by the #131/#135 correction: the level grants, ownership
// only ever gates which entries it reaches) is dormant under `editor` and
// `contributor` alike. These two roles are registered here, in the test, and
// nowhere near `editor`/`contributor`'s own definitions, so the narrowing can
// be proven without changing what either shipping role grants.
ROLES["data-editor"] = {
  data: "edit",
  tiles: "noAccess",
  integrations: "noAccess",
  roles: "noAccess",
};
ROLES["no-data-access"] = {
  data: "noAccess",
  tiles: "noAccess",
  integrations: "noAccess",
  roles: "noAccess",
};

// A fixture item's schema, passed in with the request: one array field whose
// entries carry an ordinary content field (TEXT) and one marked interactive
// (DONE). It keeps the general cases independent of any one shipped item;
// the shipped `checklist-tile` marker is covered separately at the end.
const ITEM_SCHEMAS: ItemSchemas = {
  "fixture-interactive-item": {
    type: "object",
    properties: {
      ITEMS: {
        type: "array",
        items: {
          type: "object",
          properties: {
            TEXT: { type: "string" },
            DONE: { type: "boolean", interactive: true },
          },
        },
      },
    },
  },
};

/** Holds `edit`, not `write`, on `data` — enough to touch an owned entry, not enough to reach anyone else's. */
const dataEditor: Account = { id: "acct-data-editor", role: "data-editor" };
/** Holds nothing on `data` — proves ownership alone never grants an operation. */
const noDataAccess: Account = { id: "acct-no-data", role: "no-data-access" };

const tileWithEntries = (
  tileId: string,
  entries: readonly Record<string, unknown>[],
): Tile => ({
  id: tileId,
  title: tileId,
  item: "stat-tile",
  state: { LIST_ITEMS: entries },
});

const dashboardWithEntries = (
  entries: readonly Record<string, unknown>[],
): Dashboard => ({
  tiles: [tileWithEntries("t", entries)],
  references: [{ tileId: "t", size: "md" }],
});

const setTileState = (state: Record<string, unknown>): Mutation => ({
  type: "set-tile-state",
  tileId: "t",
  state,
});

const TILE_MUTATIONS: readonly Mutation[] = [
  {
    type: "add-tile",
    tile: { id: "x", title: "x", item: "stat-tile", state: {} },
  },
  { type: "remove-tile", tileId: "x" },
  { type: "set-tile-title", tileId: "x", title: "New" },
  { type: "place-tile", tileId: "x", size: "lg" },
];

describe("checkMutationPermission", () => {
  it.each(TILE_MUTATIONS)(
    "allows $type for a role with write on tiles",
    (mutation) => {
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation,
          account: editor,
          dashboard: EMPTY_DASHBOARD,
        }),
      ).toBeNull();
    },
  );

  it.each(TILE_MUTATIONS)(
    "denies $type with 'forbidden' for a role lacking write on tiles",
    (mutation) => {
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation,
          account: contributor,
          dashboard: EMPTY_DASHBOARD,
        }),
      ).toBe("forbidden");
    },
  );

  it("denies every mutation for an account whose role name is not a known role", () => {
    for (const mutation of TILE_MUTATIONS) {
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation,
          account: unknownRole,
          dashboard: EMPTY_DASHBOARD,
        }),
      ).toBe("forbidden");
    }
  });

  describe("data ownership on set-tile-state", () => {
    // Story: an account holding `write` on `data` can add a new entry.
    it("allows adding a new entry for a role with write on data", () => {
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({ LIST_ITEMS: [{ text: "new" }] }),
          account: editor,
          dashboard: dashboardWithEntries([]),
        }),
      ).toBeNull();
    });

    // Creating is a level question, never an ownership one — there is no
    // "adding needs no level" exemption.
    it("denies adding a new entry for a role that holds edit but not write on data", () => {
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({ LIST_ITEMS: [{ text: "new" }] }),
          account: dataEditor,
          dashboard: dashboardWithEntries([]),
        }),
      ).toBe("forbidden");
    });

    it("allows an account to edit an entry it owns, given a level on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: dataEditor.id, text: "mine" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            LIST_ITEMS: [
              { entryId: "e1", owner: dataEditor.id, text: "mine, edited" },
            ],
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBeNull();
    });

    it("allows an account to delete an entry it owns, given a level on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: dataEditor.id, text: "mine" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({ LIST_ITEMS: [] }),
          account: dataEditor,
          dashboard,
        }),
      ).toBeNull();
    });

    // Story: without `write` on `data`, editing or deleting an entry the
    // account does not own is refused.
    it("denies editing an entry it does not own for a role lacking write on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: "someone-else", text: "theirs" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            LIST_ITEMS: [
              { entryId: "e1", owner: "someone-else", text: "changed" },
            ],
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBe("forbidden");
    });

    it("denies deleting an entry it does not own for a role lacking write on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: "someone-else", text: "theirs" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({ LIST_ITEMS: [] }),
          account: dataEditor,
          dashboard,
        }),
      ).toBe("forbidden");
    });

    // Story: `write` on `data` widens the gate to every entry, regardless of
    // owner — both default roles qualify.
    it.each([editor, contributor])(
      "allows $role to edit and delete an entry it does not own, since it holds write on data",
      (account) => {
        const dashboard = dashboardWithEntries([
          { entryId: "e1", owner: "someone-else", text: "theirs" },
        ]);
        expect(
          checkMutationPermission({
            itemSchemas: ITEM_SCHEMAS,
            mutation: setTileState({
              LIST_ITEMS: [
                { entryId: "e1", owner: "someone-else", text: "corrected" },
              ],
            }),
            account,
            dashboard,
          }),
        ).toBeNull();
        expect(
          checkMutationPermission({
            itemSchemas: ITEM_SCHEMAS,
            mutation: setTileState({ LIST_ITEMS: [] }),
            account,
            dashboard,
          }),
        ).toBeNull();
      },
    );

    // No entry operation is permitted on ownership alone: owning the entry
    // is not enough when the role holds no level on data at all.
    it("denies editing an owned entry for a role with no level on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: noDataAccess.id, text: "mine" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            LIST_ITEMS: [
              { entryId: "e1", owner: noDataAccess.id, text: "changed" },
            ],
          }),
          account: noDataAccess,
          dashboard,
        }),
      ).toBe("forbidden");
    });

    // Reordering — the same ids, different array positions — is never a
    // change on its own, so it never triggers an ownership check, even for a
    // role with no level on data at all.
    it("never gates reordering, even for a role with no level on data", () => {
      const dashboard = dashboardWithEntries([
        { entryId: "e1", owner: "someone-else", text: "a" },
        { entryId: "e2", owner: "another-account", text: "b" },
      ]);
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            LIST_ITEMS: [
              { entryId: "e2", owner: "another-account", text: "b" },
              { entryId: "e1", owner: "someone-else", text: "a" },
            ],
          }),
          account: noDataAccess,
          dashboard,
        }),
      ).toBeNull();
    });

    // A tile's state with no array-shaped values is one entry with one owner.
    it("treats a flat, scalar tile's state as a single owned entry", () => {
      const dashboard: Dashboard = {
        tiles: [
          {
            id: "t",
            title: "t",
            item: "stat-tile",
            state: { entryId: "e1", owner: "someone-else", VALUE: 1 },
          },
        ],
        references: [{ tileId: "t", size: "md" }],
      };

      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            entryId: "e1",
            owner: "someone-else",
            VALUE: 2,
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBe("forbidden");

      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            entryId: "e1",
            owner: "someone-else",
            VALUE: 2,
          }),
          account: editor,
          dashboard,
        }),
      ).toBeNull();
    });
  });

  describe("interactive-field exemption on set-tile-state", () => {
    const dashboardWithFixtureEntry = (
      entry: Record<string, unknown>,
    ): Dashboard => ({
      tiles: [
        {
          id: "t",
          title: "t",
          item: "fixture-interactive-item",
          state: { ITEMS: [entry] },
        },
      ],
      references: [{ tileId: "t", size: "md" }],
    });

    // Story: toggling an interactive field on an entry another account owns
    // is allowed for any account holding its level on data — the marker
    // lifts the ownership gate, never the level.
    it("allows toggling an interactive field on an entry it does not own, given a level on data", () => {
      const dashboard = dashboardWithFixtureEntry({
        entryId: "e1",
        owner: "someone-else",
        TEXT: "task",
        DONE: false,
      });
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            ITEMS: [
              {
                entryId: "e1",
                owner: "someone-else",
                TEXT: "task",
                DONE: true,
              },
            ],
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBeNull();
    });

    // The marker never lifts the level: an account with no level on data at
    // all is still refused, interactive field or not.
    it("still denies an account with no level on data, even for an interactive field", () => {
      const dashboard = dashboardWithFixtureEntry({
        entryId: "e1",
        owner: "someone-else",
        TEXT: "task",
        DONE: false,
      });
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            ITEMS: [
              {
                entryId: "e1",
                owner: "someone-else",
                TEXT: "task",
                DONE: true,
              },
            ],
          }),
          account: noDataAccess,
          dashboard,
        }),
      ).toBe("forbidden");
    });

    // A field not marked interactive still follows the ownership rule.
    it("still denies editing a non-interactive field on an entry it does not own", () => {
      const dashboard = dashboardWithFixtureEntry({
        entryId: "e1",
        owner: "someone-else",
        TEXT: "task",
        DONE: false,
      });
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            ITEMS: [
              {
                entryId: "e1",
                owner: "someone-else",
                TEXT: "edited",
                DONE: false,
              },
            ],
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBe("forbidden");
    });

    // Changing both an interactive and a non-interactive field on an entry
    // it doesn't own still needs ownership (or write) — the exemption only
    // covers a change confined entirely to interactive fields.
    it("still denies a mixed edit touching a non-interactive field on an entry it does not own", () => {
      const dashboard = dashboardWithFixtureEntry({
        entryId: "e1",
        owner: "someone-else",
        TEXT: "task",
        DONE: false,
      });
      expect(
        checkMutationPermission({
          itemSchemas: ITEM_SCHEMAS,
          mutation: setTileState({
            ITEMS: [
              {
                entryId: "e1",
                owner: "someone-else",
                TEXT: "edited",
                DONE: true,
              },
            ],
          }),
          account: dataEditor,
          dashboard,
        }),
      ).toBe("forbidden");
    });
  });
  // The general cases above use a fixture schema. This one uses the schema
  // the registry actually ships, so dropping `"interactive": true` from
  // `checklist-tile`'s CHECKED property in registry.json fails here — the
  // marker is one keyword, and without a check it can go missing silently.
  describe("the shipped checklist-tile's CHECKED marker", () => {
    const checklistDashboard = (entry: Record<string, unknown>): Dashboard => ({
      tiles: [
        {
          id: "t",
          title: "t",
          item: "checklist-tile",
          state: { CHECKLIST_TITLE: "Reading queue", CHECKLIST_ITEMS: [entry] },
        },
      ],
      references: [{ tileId: "t", size: "md" }],
    });

    const checklistMutation = (entry: Record<string, unknown>): Mutation =>
      setTileState({
        CHECKLIST_TITLE: "Reading queue",
        CHECKLIST_ITEMS: [entry],
      });

    const owned = {
      entryId: "e1",
      owner: "someone-else",
      LABEL: "Read the spec",
      CHECKED: false,
    };

    it("lets any account with a level on data check off an entry it does not own", () => {
      expect(
        checkMutationPermission({
          itemSchemas: SHIPPED_ITEM_SCHEMAS,
          mutation: checklistMutation({ ...owned, CHECKED: true }),
          account: dataEditor,
          dashboard: checklistDashboard(owned),
        }),
      ).toBeNull();
    });

    it("still refuses that account editing the same entry's LABEL", () => {
      expect(
        checkMutationPermission({
          itemSchemas: SHIPPED_ITEM_SCHEMAS,
          mutation: checklistMutation({ ...owned, LABEL: "Rewritten" }),
          account: dataEditor,
          dashboard: checklistDashboard(owned),
        }),
      ).toBe("forbidden");
    });
  });
});
