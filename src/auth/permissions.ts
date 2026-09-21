import type { Dashboard, Mutation, MutationFailure } from "../dashboard/types";

import type { Account } from "./types";

/** The four permission categories from `CONTEXT.md`, each ranked `noAccess < read < edit < write`. */
export type Category = "data" | "tiles" | "integrations" | "roles";
export type Level = "noAccess" | "read" | "edit" | "write";

const LEVEL_RANK: Readonly<Record<Level, number>> = {
  noAccess: 0,
  read: 1,
  edit: 2,
  write: 3,
};

export type Role = Readonly<Record<Category, Level>>;

/**
 * The two default roles named in `ARCHITECTURE.md`. Neither gets `write` on
 * `roles` — there is no in-app role-management surface.
 *
 * Exported (mutable at the type level) only so a test can register a role
 * that stops short of `write` on `data` — neither shipping role does, so
 * that is the only way to prove ownership's narrowing without changing what
 * `editor`/`contributor` themselves grant.
 */
export const ROLES: Record<string, Role> = {
  editor: {
    data: "write",
    tiles: "write",
    integrations: "write",
    roles: "read",
  },
  contributor: {
    data: "write",
    tiles: "read",
    integrations: "read",
    roles: "read",
  },
};

/**
 * The slice of a registry item's `meta.schema` this module reads: enough to
 * find, for an entry's own fields, which are marked `"interactive": true` on
 * that field's own property definition — nested one level, for the object
 * schema of an array field's `items` (a checklist row, a matrix task).
 */
type SchemaProperty = {
  readonly interactive?: boolean;
  readonly type?: string;
  readonly properties?: Readonly<Record<string, SchemaProperty>>;
  readonly items?: SchemaProperty;
};

/**
 * Registry item name -> its declared `meta.schema`. Supplied per request by
 * the caller rather than imported here: the registry that matters is the
 * workspace's, which an agent adds items to while the server runs, not the
 * copy sitting in this repo.
 */
export type ItemSchemas = Readonly<Record<string, SchemaProperty>>;

/**
 * The property definitions an entry's own fields are checked against: an
 * array field's item schema, for every array-shaped property (matching
 * `entriesOf`'s own notion of an entry), or the item's top-level properties
 * for a flat, scalar tile with no array-shaped value.
 */
const entryPropertiesOf = (
  itemName: string,
  itemSchemas: ItemSchemas,
): readonly Readonly<Record<string, SchemaProperty>>[] => {
  const schema = itemSchemas[itemName];
  const properties = schema?.properties ?? {};
  const arrayItemProperties = Object.values(properties)
    .filter((property) => property.type === "array" && property.items)
    .map((property) => property.items!.properties ?? {});
  return arrayItemProperties.length > 0 ? arrayItemProperties : [properties];
};

/** Names of the fields a registry item marks `"interactive": true`, wherever an entry of that item declares them. */
const interactiveFieldsOf = (
  itemName: string,
  itemSchemas: ItemSchemas,
): ReadonlySet<string> =>
  new Set(
    entryPropertiesOf(itemName, itemSchemas).flatMap((properties) =>
      Object.entries(properties)
        .filter(([, property]) => property.interactive === true)
        .map(([key]) => key),
    ),
  );

/**
 * Everything a permission question may be asked about, and nothing else: the
 * mutation, who is asking, and the state it would apply to. The acting
 * account is part of the request rather than ambient, so a mutation's origin
 * (manual edit, agent, or an integration's query running under the credential
 * of the user who supplied it) reaches the decision the same way and none of
 * them can be privileged.
 */
export type PermissionRequest = {
  readonly mutation: Mutation;
  readonly account: Account;
  readonly dashboard: Dashboard;
  /**
   * The registry items in play, by name. An item this map does not carry
   * contributes no interactive fields, so an unknown item is gated by
   * ownership rather than exempted from it — the decision fails closed.
   */
  readonly itemSchemas: ItemSchemas;
};

/**
 * A predicate answers one yes-or-no question about a request. Pure, total,
 * and in-process: no I/O, no clock, no network, so a decision is reproducible
 * from its inputs alone and testable without a server.
 */
type Predicate = (request: PermissionRequest) => boolean;

/**
 * A guard answers the permission question itself — `null` to allow, or the
 * `MutationFailure` naming the denial. Guards compose from predicates, so the
 * rule ("who may do this") stays separate from the report ("what it is
 * called when they may not").
 */
type Guard = (request: PermissionRequest) => MutationFailure | null;

/**
 * Turns a predicate into a guard: hold the predicate, or be denied under
 * `failure`. Named `guard` rather than `require` so it never reads as the
 * CommonJS function of that name.
 */
const guard =
  (predicate: Predicate, failure: MutationFailure): Guard =>
  (request) =>
    predicate(request) ? null : failure;

/**
 * The acting account's role holds `required` or better on `category`. An
 * account whose role name is not a known role holds nothing, so every guard
 * built on this predicate denies it — no separate unknown-role branch.
 */
const hasLevel =
  (category: Category, required: Level): Predicate =>
  ({ account }) => {
    const role = ROLES[account.role];
    return (
      role !== undefined && LEVEL_RANK[role[category]] >= LEVEL_RANK[required]
    );
  };

const mayWriteTiles = guard(hasLevel("tiles", "write"), "forbidden");

/**
 * The two server-stamped fields on an entry (an object inside an
 * array-shaped value in a tile's state, or — for a tile with no array-shaped
 * value — the state itself): a stable id and the account that owns it. Set
 * once, when the entry is first created, never altered afterward. Neither
 * name is a display-role key a registry item's schema would declare, so
 * their presence is what marks a value as ownership metadata rather than
 * tile content.
 */
export const ENTRY_ID_FIELD = "entryId";
export const ENTRY_OWNER_FIELD = "owner";

type Entry = Readonly<Record<string, unknown>>;

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const arrayFields = (
  state: Record<string, unknown>,
): readonly (readonly [string, readonly unknown[]])[] =>
  Object.entries(state).filter(
    (candidate): candidate is [string, readonly unknown[]] =>
      Array.isArray(candidate[1]),
  );

/**
 * Every entry a tile's state is made of: one per element across every
 * array-shaped value, or, for a tile with no array-shaped value, the whole
 * state as the single entry a flat tile has.
 */
const entriesOf = (state: Record<string, unknown>): readonly Entry[] => {
  const arrays = arrayFields(state);
  return arrays.length > 0
    ? arrays.flatMap(([, values]) => values.filter(isEntry))
    : isEntry(state)
      ? [state]
      : [];
};

/**
 * Applies `transform` to every entry in a tile's state, leaving everything
 * else — array positions, non-array fields — untouched. The one place that
 * knows how to find an entry to change it, shared by stamping and stripping.
 */
const mapEntries = (
  state: Record<string, unknown>,
  transform: (entry: Entry) => Entry,
): Record<string, unknown> => {
  const arrays = arrayFields(state);
  if (arrays.length === 0) {
    return isEntry(state) ? transform(state) : state;
  }
  const next = { ...state };
  for (const [key, values] of arrays) {
    next[key] = values.map((value) =>
      isEntry(value) ? transform(value) : value,
    );
  }
  return next;
};

/**
 * Removes the two stamped fields from every entry, so neither the registry
 * item's declared schema nor its rendered component ever sees them.
 */
export const stripEntryOwnership = (
  state: Record<string, unknown>,
): Record<string, unknown> =>
  mapEntries(state, (entry) => {
    const {
      [ENTRY_ID_FIELD]: _id,
      [ENTRY_OWNER_FIELD]: _owner,
      ...rest
    } = entry;
    return rest;
  });

const indexById = (state: Record<string, unknown>): Map<string, Entry> =>
  new Map(
    entriesOf(state)
      .filter((entry) => typeof entry[ENTRY_ID_FIELD] === "string")
      .map((entry) => [entry[ENTRY_ID_FIELD] as string, entry]),
  );

/** Deep-equal ignoring key order, so an entry re-sent with reordered keys never reads as edited. */
const canonicalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonicalize)
    : isEntry(value)
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
        )
      : value;

const withoutStamps = (entry: Entry): Entry => {
  const { [ENTRY_ID_FIELD]: _id, [ENTRY_OWNER_FIELD]: _owner, ...rest } = entry;
  return rest;
};

/** Field names changed between two versions of the same entry, ignoring the two stamped fields. */
const changedFields = (previous: Entry, next: Entry): readonly string[] => {
  const a = withoutStamps(previous);
  const b = withoutStamps(next);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) =>
      JSON.stringify(canonicalize(a[key])) !==
      JSON.stringify(canonicalize(b[key])),
  );
};

type EntryChange =
  | { readonly kind: "create" }
  | {
      readonly kind: "edit";
      readonly owner: string;
      /** Every changed field is marked `interactive`: the ownership gate lifts, the level below still applies. */
      readonly interactiveOnly: boolean;
    }
  | { readonly kind: "delete"; readonly owner: string };

/**
 * Classifies every change between a tile's current state and a proposed one,
 * entry by entry, by comparing entries by their stamped id rather than
 * position — which is what makes reordering (the same ids, different array
 * positions) never read as a change. An entry with no id is being created.
 * An edit where every changed field is marked `interactive` in `interactive`
 * is flagged `interactiveOnly`, so the caller can lift ownership for it.
 */
const diffEntries = (
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>,
  interactive: ReadonlySet<string>,
): readonly EntryChange[] => {
  const oldById = indexById(oldState);
  const seenIds = new Set<string>();
  const changes: EntryChange[] = [];

  for (const entry of entriesOf(newState)) {
    const id = entry[ENTRY_ID_FIELD];
    const previous = typeof id === "string" ? oldById.get(id) : undefined;
    if (!previous) {
      changes.push({ kind: "create" });
      continue;
    }
    seenIds.add(id as string);
    const changed = changedFields(previous, entry);
    if (changed.length > 0) {
      changes.push({
        kind: "edit",
        owner: previous[ENTRY_OWNER_FIELD] as string,
        interactiveOnly: changed.every((key) => interactive.has(key)),
      });
    }
  }
  for (const [id, entry] of oldById) {
    if (!seenIds.has(id)) {
      changes.push({
        kind: "delete",
        owner: entry[ENTRY_OWNER_FIELD] as string,
      });
    }
  }
  return changes;
};

const mayCreateData = hasLevel("data", "write");
const mayEditData = hasLevel("data", "edit");
const mayWriteAnyData = hasLevel("data", "write");

/**
 * The `data` category's guard. The level always grants and ownership only
 * ever narrows: a create needs `write` outright (there is no "adding needs
 * no level" exemption); an edit or a delete needs a level on `data`, and —
 * unless that level is `write`, which widens the gate back to every entry —
 * is narrowed to entries the acting account owns. An edit whose changed
 * fields are all marked `interactive` in the item's schema still needs that
 * same level on `data`, but skips the ownership narrowing entirely: the
 * marker lifts the ownership gate, never the level.
 */
const dataOwnershipGuard: Guard = (request) => {
  const { mutation, dashboard, account } = request;
  if (mutation.type !== "set-tile-state") return null;

  const existing = dashboard.tiles.find(
    (candidate) => candidate.id === mutation.tileId,
  );
  const interactive = interactiveFieldsOf(
    existing?.item ?? "",
    request.itemSchemas,
  );
  const changes = diffEntries(
    existing?.state ?? {},
    mutation.state,
    interactive,
  );

  for (const change of changes) {
    if (change.kind === "create") {
      if (!mayCreateData(request)) return "forbidden";
    } else if (!mayEditData(request)) {
      return "forbidden";
    } else if (change.kind === "edit" && change.interactiveOnly) {
      // Level already checked above; ownership never narrows an interactive field.
    } else if (!mayWriteAnyData(request) && change.owner !== account.id) {
      return "forbidden";
    }
  }
  return null;
};

/**
 * Stamps every newly created entry with a fresh id and the acting account as
 * owner, and re-stamps every matched entry with its original id and owner —
 * regardless of what the caller sent for those two fields — since ownership
 * is set once and never altered afterward. Not part of the permission
 * decision itself (it allocates an id, so it isn't pure); called by the
 * store only after `dataOwnershipGuard` has already allowed the mutation.
 */
export const stampEntryOwnership = (
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>,
  accountId: string,
): Record<string, unknown> => {
  const oldById = indexById(oldState);
  return mapEntries(newState, (entry) => {
    const id = entry[ENTRY_ID_FIELD];
    const previous = typeof id === "string" ? oldById.get(id) : undefined;
    return previous
      ? {
          ...entry,
          [ENTRY_ID_FIELD]: previous[ENTRY_ID_FIELD],
          [ENTRY_OWNER_FIELD]: previous[ENTRY_OWNER_FIELD],
        }
      : {
          ...entry,
          [ENTRY_ID_FIELD]: crypto.randomUUID(),
          [ENTRY_OWNER_FIELD]: accountId,
        };
  });
};

/**
 * One guard per mutation type. `Record<Mutation["type"], Guard>` is what
 * makes the scheme fail closed: adding a member to the `Mutation` union
 * breaks the build here until it declares a guard, so a new mutation type
 * cannot reach `applyMutation` unchecked.
 */
const GUARDS: Readonly<Record<Mutation["type"], Guard>> = {
  // A tile belongs to the dashboard, not to whoever added it, so these four
  // are role-only — there is no ownership exception for a tile an account
  // added itself.
  "add-tile": mayWriteTiles,
  "remove-tile": mayWriteTiles,
  "set-tile-title": mayWriteTiles,
  "place-tile": mayWriteTiles,
  "set-tile-state": dataOwnershipGuard,
};

/**
 * The one permission decision, called once per mutation from the same place
 * `apply` already applies mutations atomically. There is no second
 * enforcement point and no per-mutation-type check outside this table.
 */
export const checkMutationPermission: Guard = (request) =>
  GUARDS[request.mutation.type](request);
