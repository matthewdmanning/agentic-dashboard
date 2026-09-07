import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";

import type { AuthStore } from "../auth";
import { isLocalUserToken } from "../auth/local-user";
import type { ConnectionStore } from "../server/integrations/connections";
import {
  dynamicIntegrationEntry,
  type IntegrationCatalog,
  type IntegrationCatalogEntry,
} from "../server/integrations/catalog";
import { connectableTypesFromCatalog } from "../server/integrations/catalog-queries";
import { reconcileIntegrationRetention } from "../server/integrations/retention";
import {
  newQuerySchema,
  storedQuerySchema,
  type NewQuery,
  type StoredQuery,
  type UserQueryStore,
} from "./queries";
import { generateComponentSource } from "../card-templates/codegen";
import {
  prepareCardTemplatePromotion,
  type CardTemplateCandidate,
  type PreparedCardTemplateFiles,
} from "../card-templates/build";
import {
  defaultCardTemplateClientBuildPath,
  defaultCardTemplateManifestPath,
  readActiveCardTemplateManifest,
} from "../card-templates/active-manifest";
import {
  defaultDashboardConfiguration,
  localUser,
  mutationRequirements,
  unauthenticatedUser,
  mutationsSchema,
  parseDashboardConfiguration,
  roles,
  type Card,
  type CardMapper,
  type Dashboard,
  type DashboardConfiguration,
  type Integration,
  type Mutation,
  type PermissionCategory,
  type PermissionLevel,
  type Role,
  type Theme,
} from "../contract";

/**
 * Why a service call failed, named in the service's own terms. Adapters map a
 * code to their vocabulary — a status, a tool result, a message — so no caller
 * has to match on the message text.
 */
export type ServiceFailureCode =
  | "unknown-credential"
  | "authentication-unavailable"
  | "permission-denied"
  | "unknown-role"
  | "unknown-id"
  | "duplicate-id"
  | "in-use"
  | "connections-unavailable"
  | "queries-unavailable"
  | "invalid-card-template"
  | "integration-blocked";

export class ServiceFailure extends Error {
  constructor(
    readonly code: ServiceFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceFailure";
  }
}

export interface DashboardPersistence {
  read(): Promise<unknown>;
  write(configuration: DashboardConfiguration): Promise<void>;
}

/** What `read` returns for each scope. `all` omits categories the role cannot read. */
export interface ReadScopes {
  all: ReadableConfiguration;
  /** The caller's own resolved role. Never gated — a caller may always see what it may do. */
  role: Role;
  data: { id: string; state: unknown }[];
  cards: Card[];
  presentation: {
    dashboard: Dashboard;
    themes: Theme[];
    fontScale: number;
  };
  integrations: Integration[];
  roles: Role[];
  /**
   * The caller's own queries, and nobody else's (D31, D32). Ungated like
   * `role` — a user's queries are theirs by structure, not by permission
   * (D35) — so this is never checked against the permission matrix.
   */
  queries: StoredQuery[];
  /** The shared card mapper store (D38). Gated at `cards: read`, like `cards` itself. */
  cardMappers: CardMapper[];
}

export type ReadScope = keyof ReadScopes;

/**
 * What `read("all")` returns. Roles are not part of dashboard configuration
 * (D35) — they come from the roles file — so they ride alongside it here.
 */
export type ReadableConfiguration = Partial<DashboardConfiguration> & {
  roles?: Role[];
};

interface Dependencies {
  persistence: DashboardPersistence;
  authStore?: AuthStore;
  /** Where a user's connection credentials live — see `ConnectionStore` (D28, D40, #88). */
  connections?: ConnectionStore;
  /** Where each user's own queries live — a query belongs to the user who supplied it, never to a card (D32). */
  queries?: UserQueryStore;
  /** The service types this build can pull from — how a caller learns what may be connected. */
  connectableTypes?: readonly string[];
  /** Shared file-backed catalog; dashboard configuration remains connection-free. */
  catalog?: IntegrationCatalog;
  /**
   * The roles file (D35). Defaults to the one `contract` imports; overridden
   * only by tests, since configuring roles means editing that file.
   */
  roles?: readonly Role[];
  /** What a caller proving it is the local user resolves to. Defaults to `localUser` (D35). */
  localUser?: Role;
  /**
   * The local-user token this process provisioned (`src/auth/local-user.ts`).
   * When set, only a caller presenting it is the local user and an unproven
   * caller gets nothing. When unset — tests, and a build with no server door —
   * an unproven caller is treated as local.
   */
  localUserToken?: string;
  /** Test seam for the local OS identity; production uses the running account. */
  localUserName?: string;
  /** Where the active card-template manifest is read from and promoted to (D24, D39). Defaults to the workspace's `.dashboard/card-templates/manifest.json`. */
  cardTemplateManifestPath?: string;
  /** Pairs with `cardTemplateManifestPath` — the promoted client build. */
  cardTemplateClientBuildPath?: string;
}

export interface AuthenticatedCaller {
  user: string | undefined;
  role: Role;
}

export interface DashboardService {
  read<Scope extends ReadScope>(
    scope: Scope,
    credential?: string,
  ): Promise<ReadScopes[Scope]>;
  /**
   * Returns the same projection `read("all")` would — the categories the
   * caller may read, denied ones omitted — never the full configuration
   * regardless of what changed.
   */
  apply(
    mutations: readonly Mutation[],
    credential?: string,
  ): Promise<ReadScopes["all"]>;
  /**
   * The live credential handoff for connecting the caller's own account to
   * one catalog entry (D14, D28, D40): stores the secret outside dashboard
   * configuration and the offline queue. Not a mutation — a credential
   * never enters `DashboardConfiguration` or a read projection (`contract`
   * already refuses a credential-shaped `integration.settings` key; this
   * keeps the same promise for the store `apply` never touches). Ungated
   * (D35) — a user's own connection is theirs by structure, keyed by the
   * resolved caller and the catalog entry, never by a permission check.
   */
  connect(
    catalogEntryId: string,
    connectionCredential: string,
    credential?: string,
  ): Promise<void>;
  /**
   * The matching live handoff for disconnecting: destroys the caller's own
   * stored credential for that catalog entry immediately and leaves the
   * entry itself intact (D40). Ungated for the same reason `connect` is.
   */
  disconnect(catalogEntryId: string, credential?: string): Promise<void>;
  /** The services this build can connect to. Gated at `integrations: read`. */
  connectableTypes(credential?: string): Promise<string[]>;
  /**
   * Adds a query owned by the resolved caller (D32, D35). The payload never
   * names a user — there is nothing to select, the owner is always the caller
   * — so an ownership-bearing request cannot name someone else.
   */
  addQuery(query: NewQuery, credential?: string): Promise<StoredQuery>;
  /** Edits one of the caller's own queries. Unknown to the caller — whether it doesn't exist or belongs to someone else — fails the same way (D31). */
  editQuery(query: StoredQuery, credential?: string): Promise<void>;
  /** Removes one of the caller's own queries. */
  removeQuery(id: string, credential?: string): Promise<void>;
  /**
   * The one door onto another user's queries (D32, D35): an administrator may
   * delete one without ever reading its contents back through the service.
   */
  removeUserQuery(user: string, id: string, credential?: string): Promise<void>;
  /**
   * The resolved caller's own identity, or `undefined` for an unauthenticated
   * caller (D35) — the one way outside `service` to learn who a credential
   * belongs to, without exposing anyone else's. Refresh (#90) uses this to
   * scope a connection lookup by owner, the same identity `connect` and
   * `disconnect` already key a caller's own connection by.
   */
  owner(credential?: string): Promise<string | undefined>;
  /**
   * The blocked catalog entries the caller is affected by — the ones they
   * hold a connection to (D40, #92). Ungated (D35), the same way `read`
   * never checks a permission before handing back the caller's own queries:
   * a user's own connection is theirs by structure, and so is knowing it
   * stopped working. Never names another user or reveals a credential.
   */
  blockedIntegrationNotices(credential?: string): Promise<string[]>;
  /**
   * Distinct integration ids the caller's own queries name that no longer
   * exist in the catalog (D40, #93) — force-removing a dependent integration
   * never cascade-deletes a query, so this is how an owner learns theirs
   * went unavailable. Ungated (D35), the same reasoning as
   * `blockedIntegrationNotices`.
   */
  unavailableQueryIntegrations(credential?: string): Promise<string[]>;
}

export function createService(dependencies: Dependencies): DashboardService {
  let tail = Promise.resolve();
  // ponytail: one global queue serializes every read and apply across the
  // whole dashboard, not per card or per resource — the simplest way to make
  // D30's "last write wins" true for concurrent query refreshes without a
  // locking scheme. Ceiling: throughput is capped at one apply at a time,
  // dashboard-wide. Upgrade path: per-card (or per-resource) locks if
  // concurrent refreshes ever become the bottleneck.
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(
      () => operation(),
      () => operation(),
    );
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    read: (scope, credential) =>
      enqueue(() => readState(dependencies, scope, credential)),
    apply: (mutations, credential) =>
      enqueue(() => applyMutations(dependencies, mutations, credential)),
    connect: (catalogEntryId, connectionCredential, credential) =>
      enqueue(() =>
        connectIntegration(
          dependencies,
          catalogEntryId,
          connectionCredential,
          credential,
        ),
      ),
    disconnect: (catalogEntryId, credential) =>
      enqueue(() =>
        disconnectIntegration(dependencies, catalogEntryId, credential),
      ),
    connectableTypes: (credential) =>
      enqueue(() => readConnectableTypes(dependencies, credential)),
    addQuery: (query, credential) =>
      enqueue(() => addQuery(dependencies, query, credential)),
    editQuery: (query, credential) =>
      enqueue(() => editQuery(dependencies, query, credential)),
    removeQuery: (id, credential) =>
      enqueue(() => removeQuery(dependencies, id, credential)),
    removeUserQuery: (user, id, credential) =>
      enqueue(() => removeUserQuery(dependencies, user, id, credential)),
    owner: (credential) =>
      enqueue(() =>
        resolveCaller(dependencies, credential).then((caller) => caller.user),
      ),
    blockedIntegrationNotices: (credential) =>
      enqueue(() => blockedIntegrationNotices(dependencies, credential)),
    unavailableQueryIntegrations: (credential) =>
      enqueue(() => unavailableQueryIntegrations(dependencies, credential)),
  };
}

export function createFilePersistence(path: string): DashboardPersistence {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return structuredClone(defaultDashboardConfiguration);
      }
    },
    async write(configuration) {
      const temporaryPath = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(
          temporaryPath,
          `${JSON.stringify(configuration, null, 2)}\n`,
        );
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    },
  };
}

async function readConfiguration(
  persistence: DashboardPersistence,
): Promise<DashboardConfiguration> {
  return parseDashboardConfiguration(await persistence.read());
}

async function readIntegrations(
  dependencies: Dependencies,
  configuration: DashboardConfiguration,
): Promise<Integration[]> {
  return dependencies.catalog
    ? await dependencies.catalog.read()
    : configuration.integrations;
}

export async function resolveCaller(
  dependencies: Dependencies,
  credential: string | undefined,
): Promise<AuthenticatedCaller> {
  const asLocalUser = dependencies.localUser ?? localUser;
  const asLocalUserName = dependencies.localUserName ?? userInfo().username;

  // The local user proves itself with the token only that OS account can read.
  if (isLocalUserToken(credential, dependencies.localUserToken)) {
    return { user: asLocalUserName, role: asLocalUser };
  }

  if (credential === undefined) {
    // With a token provisioned, proving nothing gets nothing. Without one
    // there is no door to prove anything at, so the caller is the local user.
    return dependencies.localUserToken === undefined
      ? { user: asLocalUserName, role: asLocalUser }
      : { user: undefined, role: unauthenticatedUser };
  }

  if (!dependencies.authStore) {
    throw new ServiceFailure(
      "authentication-unavailable",
      "Authentication is not configured",
    );
  }
  const account = await dependencies.authStore.resolve(credential);
  if (!account) {
    throw new ServiceFailure("unknown-credential", "Unknown credential");
  }

  const role = (dependencies.roles ?? roles).find(
    ({ name }) => name === account.role,
  );
  if (!role) {
    throw new ServiceFailure("unknown-role", `Unknown role: ${account.role}`);
  }
  return { user: account.user, role };
}

async function readState<Scope extends ReadScope>(
  dependencies: Dependencies,
  scope: Scope,
  credential: string | undefined,
): Promise<ReadScopes[Scope]> {
  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  const caller = await resolveCaller(dependencies, credential);
  const role = caller.role;

  if (scope !== "all" && scope !== "role" && scope !== "queries") {
    // Card mappers ride under the `cards` category (D20) rather than having
    // their own; there is no `cardMappers` permission level to check.
    requireRead(role, scope === "cardMappers" ? "cards" : scope);
  }

  // Built per scope, not all at once: `all` refuses a role that may read
  // nothing, which must not decide the answer for a scope nobody asked for.
  const scoped: {
    [Scope in ReadScope]: () => ReadScopes[Scope] | Promise<ReadScopes[Scope]>;
  } = {
    all: () =>
      projectReadable(
        configuration,
        role,
        dependencies.roles ?? roles,
        integrations,
      ),
    role: () => role,
    data: () => configuration.cards.map(({ id, state }) => ({ id, state })),
    cards: () => configuration.cards,
    presentation: () => ({
      dashboard: configuration.dashboard,
      themes: configuration.themes,
      fontScale: configuration.fontScale,
    }),
    integrations: () => integrations,
    roles: () => [...(dependencies.roles ?? roles)],
    // Ungated (D35): a user's own queries are theirs by structure, and there
    // is nothing of anyone else's in this file to filter out (D31).
    queries: () =>
      caller.user ? requireQueryStore(dependencies).list(caller.user) : [],
    cardMappers: () => configuration.cardMappers,
  };

  return scoped[scope]();
}

/**
 * `all` returns the categories the role may read rather than demanding every
 * category, so the shipped `local` role — write on everything except `roles` —
 * can still load a whole dashboard.
 *
 * `apply` projects its result the same way (`allowEmpty: true`): a role that
 * may change something it cannot read — `data: edit`, `read` otherwise
 * `none` everywhere — must not be handed a `permission-denied` for a
 * mutation that just succeeded. An empty projection is the honest answer:
 * it changed something, and may read nothing back.
 */
function projectReadable(
  configuration: DashboardConfiguration,
  role: Role,
  availableRoles: readonly Role[],
  integrations = configuration.integrations,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): ReadableConfiguration {
  const readable: ReadableConfiguration = {};

  // ponytail: `data` adds nothing past `cards`; split them if a role ever needs
  // card state without the cards themselves.
  if (
    role.permissions.cards !== "noAccess" ||
    role.permissions.data !== "noAccess"
  ) {
    readable.cards = configuration.cards;
  }
  // Card mappers ride under `cards` (D20), not `data` — card state and card
  // mappers are different owners in the same table row.
  if (role.permissions.cards !== "noAccess") {
    readable.cardMappers = configuration.cardMappers;
  }
  if (role.permissions.presentation !== "noAccess") {
    readable.dashboard = configuration.dashboard;
    readable.themes = configuration.themes;
    readable.fontScale = configuration.fontScale;
  }
  if (role.permissions.integrations !== "noAccess") {
    readable.integrations = integrations;
    readable.integrationRetentionDays = configuration.integrationRetentionDays;
  }
  if (role.permissions.roles !== "noAccess")
    readable.roles = [...availableRoles];

  if (Object.keys(readable).length === 0 && !allowEmpty) {
    throw new ServiceFailure("permission-denied", "Permission denied: read");
  }
  return readable;
}

async function applyMutations(
  dependencies: Dependencies,
  input: readonly Mutation[],
  credential: string | undefined,
): Promise<ReadScopes["all"]> {
  const mutations = mutationsSchema.parse(input);
  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  const caller = await resolveCaller(dependencies, credential);
  const role = caller.role;

  for (const mutation of mutations) {
    const { category, level } = mutationRequirements[mutation.type];
    requireLevel(role, category, level);

    // Removing a placed card rewrites the dashboard holding it, which is a
    // presentation write however it was reached.
    if (
      mutation.type === "remove-card" &&
      configuration.dashboard.cards.includes(mutation.cardId)
    ) {
      requireLevel(role, "presentation", "write");
    }

    // `edit-integration` replaces the whole entry, including `state` — a
    // caller with only `integrations: edit` must not be able to block or
    // unblock through it, since #92 gates that at `write` (D40). This is the
    // one runtime fact `mutationRequirements`'s static table can't express.
    if (mutation.type === "edit-integration") {
      const existing = integrations.find(
        ({ id }) => id === mutation.integration.id,
      );
      if (existing && existing.state !== mutation.integration.state) {
        requireLevel(role, "integrations", "write");
      }
    }

    // Removing an entry with live dependents needs an explicit override
    // (D40, #93): the ordinary confirmation (no override, or `false`) never
    // proceeds past a dependent entry. The warning names only aggregate
    // counts — never which user, what a query asks for, or a credential.
    if (mutation.type === "remove-integration") {
      const connectionCount = dependencies.connections
        ? await dependencies.connections.countForEntry(mutation.integrationId)
        : 0;
      const queryCount = dependencies.queries
        ? await dependencies.queries.countReferencingIntegration(
            mutation.integrationId,
          )
        : 0;
      if ((connectionCount > 0 || queryCount > 0) && !mutation.override) {
        throw new ServiceFailure(
          "in-use",
          `Integration '${mutation.integrationId}' has ${connectionCount} connection(s) and ${queryCount} quer${queryCount === 1 ? "y" : "ies"} depending on it. Removing it destroys those connections; queries stay stored but become unavailable. Pass override to proceed.`,
        );
      }
    }

    // Adding a card mapper is ungated by structure (D38) — the resolved
    // caller becomes its owner, so there must be a caller to own it.
    if (mutation.type === "add-card-mapper" && !caller.user) {
      throw new ServiceFailure(
        "permission-denied",
        "No caller identity to own a card mapper",
      );
    }

    // Editing or removing needs the mapper's current owner and whether any
    // private query still references it (D38) — both runtime facts
    // `mutationRequirements`'s static table can't express.
    if (
      mutation.type === "edit-card-mapper" ||
      mutation.type === "remove-card-mapper"
    ) {
      const existing = configuration.cardMappers.find(
        ({ name }) => name === mutation.name,
      );
      if (!existing) {
        throw new ServiceFailure(
          "unknown-id",
          `Unknown card mapper: ${mutation.name}`,
        );
      }
      const referenced = dependencies.queries
        ? await dependencies.queries.isReferencedByAnyQuery(mutation.name)
        : false;

      // Removing a referenced mapper always fails, for every caller
      // including an administrator — never a permission this check can
      // waive (D38) — and never touches the private queries that reference
      // it.
      if (mutation.type === "remove-card-mapper" && referenced) {
        throw new ServiceFailure(
          "in-use",
          `Card mapper '${mutation.name}' is referenced by a query`,
        );
      }

      // An owner may edit or remove their own unreferenced mapper with no
      // permission check at all (D38, like a query). Every other case —
      // someone else's mapper, or a referenced one — falls back to
      // `cards: write`.
      const ownerActingOnUnreferenced =
        existing.owner === caller.user && !referenced;
      if (!ownerActingOnUnreferenced) {
        requireLevel(role, "cards", "write");
      }
    }
  }

  // Real filesystem writes, unlike the in-memory mutations below. Every
  // composition in the batch is validated, schema-compiled, and type-checked
  // up front — but not promoted (manifest, client build, or tracked source)
  // until the rest of the batch (in-memory mutations, config persistence)
  // has also succeeded, so a `remove-card`/`add-card`-style failure
  // elsewhere in the same batch can't leave a template half-landed.
  const prepared = await applyAssembledCardTemplates(
    dependencies,
    mutations.filter(
      (
        mutation,
      ): mutation is Extract<Mutation, { type: "assemble-card-template" }> =>
        mutation.type === "assemble-card-template",
    ),
  );
  let next: DashboardConfiguration;
  try {
    const candidate = structuredClone({ ...configuration, integrations });
    for (const mutation of mutations) {
      applyMutation(
        candidate,
        mutation,
        dependencies.catalog !== undefined,
        caller.user,
      );
    }
    next = parseDashboardConfiguration(candidate);
    await dependencies.persistence.write(
      dependencies.catalog
        ? { ...next, integrations: configuration.integrations }
        : next,
    );
    if (
      dependencies.catalog &&
      mutations.some(({ type }) =>
        [
          "add-integration",
          "edit-integration",
          "remove-integration",
          "block-integration",
          "unblock-integration",
        ].includes(type),
      )
    ) {
      await dependencies.catalog.write(
        next.integrations as IntegrationCatalogEntry[],
      );
    }

    if (prepared) await prepared.commit();
  } catch (error) {
    if (prepared) await prepared.discard();
    throw error;
  }

  // Removing a catalog entry destroys every user's stored connection for it
  // (D40) — not just one caller's, since a connection is now keyed by user
  // and catalog entry rather than by entry alone. This is the superset of
  // the single-key credential revoke this replaced; #93 adds a gate in
  // front of removal itself (a dependency warning and explicit override)
  // but does not own the destruction that follows a removal that proceeds.
  //
  // ponytail: after the write, so a failed destroy orphans an already-gone
  // entry's connections rather than the reverse. Recovers by retrying —
  // `removeAllForEntry` is idempotent, and a stray connection for a
  // nonexistent entry is inert (no `catalogEntryId` will ever match it
  // again) until the retry clears it. Make the pair atomic if this ever
  // fails often enough to matter.
  if (dependencies.connections) {
    const removed = mutations.filter(
      (
        mutation,
      ): mutation is Extract<Mutation, { type: "remove-integration" }> =>
        mutation.type === "remove-integration",
    );
    await Promise.all(
      removed.map((mutation) =>
        dependencies.connections!.removeAllForEntry(mutation.integrationId),
      ),
    );
  }

  return projectReadable(
    next,
    role,
    dependencies.roles ?? roles,
    dependencies.catalog
      ? await readIntegrations(dependencies, next)
      : next.integrations,
    {
      allowEmpty: true,
    },
  );
}

function requireConnectionStore(dependencies: Dependencies): ConnectionStore {
  if (!dependencies.connections) {
    throw new ServiceFailure(
      "connections-unavailable",
      "Connection storage is not configured",
    );
  }
  return dependencies.connections;
}

async function connectIntegration(
  dependencies: Dependencies,
  catalogEntryId: string,
  connectionCredential: string,
  credential: string | undefined,
): Promise<void> {
  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  // A connection is keyed by user and catalog entry (D40, #88), never by
  // catalog entry alone — the caller resolved here is always that user.
  const user = await requireOwner(dependencies, credential, "a connection");

  const integration = integrations.find(({ id }) => id === catalogEntryId);
  if (!integration) {
    throw new ServiceFailure(
      "unknown-id",
      `Unknown integration: ${catalogEntryId}`,
    );
  }
  // Blocked (D40, #92): rejects a new connection immediately, without
  // touching any connection or query the entry already has.
  if (integration.state === "blocked") {
    throw new ServiceFailure(
      "integration-blocked",
      `Integration '${catalogEntryId}' is blocked`,
    );
  }

  await requireConnectionStore(dependencies).set(
    user,
    catalogEntryId,
    connectionCredential,
  );
  // A connection just appeared, which cancels any unused clock the entry was
  // running (#89) — reconciled here rather than waiting for the next
  // unrelated connection change to notice.
  await reconcileRetention(
    dependencies,
    configuration.integrationRetentionDays,
  );
}

async function disconnectIntegration(
  dependencies: Dependencies,
  catalogEntryId: string,
  credential: string | undefined,
): Promise<void> {
  // Ungated like `connectIntegration` (D35): destroys only the caller's own
  // credential and leaves the shared catalog entry untouched (D40).
  const user = await requireOwner(dependencies, credential, "a connection");
  await requireConnectionStore(dependencies).remove(user, catalogEntryId);
  const configuration = await readConfiguration(dependencies.persistence);
  // This may have been the entry's last connection — starts its unused
  // clock, or removes it outright if a prior clock already ran out (#89).
  await reconcileRetention(
    dependencies,
    configuration.integrationRetentionDays,
  );
}

/** No-op when this build has no catalog or no connection store — retention only applies to a catalog-backed deployment (#89). */
async function reconcileRetention(
  dependencies: Dependencies,
  retentionDays: number,
): Promise<void> {
  if (!dependencies.catalog || !dependencies.connections) return;
  await reconcileIntegrationRetention(
    { catalog: dependencies.catalog, connections: dependencies.connections },
    retentionDays,
  );
}

async function readConnectableTypes(
  dependencies: Dependencies,
  credential: string | undefined,
): Promise<string[]> {
  const configuration = await readConfiguration(dependencies.persistence);
  const caller = await resolveCaller(dependencies, credential);
  const role = caller.role;
  requireRead(role, "integrations");
  if (dependencies.catalog) {
    return connectableTypesFromCatalog(await dependencies.catalog.read());
  }
  return [...(dependencies.connectableTypes ?? [])];
}

/**
 * Which blocked catalog entries the caller holds a connection to (D40,
 * #92) — Settings' one source for "this integration you connected stopped
 * working." No connection store or no resolved identity both mean nothing to
 * report, not an error.
 */
async function blockedIntegrationNotices(
  dependencies: Dependencies,
  credential: string | undefined,
): Promise<string[]> {
  const caller = await resolveCaller(dependencies, credential);
  if (!caller.user || !dependencies.connections) return [];

  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  const blocked = integrations.filter(
    (integration) => integration.state === "blocked",
  );
  const connectedFlags = await Promise.all(
    blocked.map((integration) =>
      dependencies.connections!.get(caller.user!, integration.id),
    ),
  );
  return blocked
    .filter((_, index) => connectedFlags[index] !== undefined)
    .map((integration) => integration.id);
}

/**
 * Which of the caller's own queries name an integration the catalog no
 * longer has (D40, #93) — Settings' one source for "this saved query stopped
 * working because its integration was removed." No query store or no
 * resolved identity both mean nothing to report, not an error.
 */
async function unavailableQueryIntegrations(
  dependencies: Dependencies,
  credential: string | undefined,
): Promise<string[]> {
  const caller = await resolveCaller(dependencies, credential);
  if (!caller.user || !dependencies.queries) return [];

  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  const knownIds = new Set(integrations.map(({ id }) => id));
  const queries = await dependencies.queries.list(caller.user);
  return [
    ...new Set(
      queries
        .map((query) => query.integration)
        .filter((integrationId) => !knownIds.has(integrationId)),
    ),
  ];
}

function requireQueryStore(dependencies: Dependencies): UserQueryStore {
  if (!dependencies.queries) {
    throw new ServiceFailure(
      "queries-unavailable",
      "Query storage is not configured",
    );
  }
  return dependencies.queries;
}

/**
 * The identity a query mutation owns it under. Never taken from a payload —
 * an ownership-bearing request has nowhere to name someone else (D32, D35).
 */
async function requireOwner(
  dependencies: Dependencies,
  credential: string | undefined,
  owns = "a query",
): Promise<string> {
  const caller = await resolveCaller(dependencies, credential);
  if (!caller.user) {
    throw new ServiceFailure(
      "permission-denied",
      `No caller identity to own ${owns}`,
    );
  }
  return caller.user;
}

async function addQuery(
  dependencies: Dependencies,
  input: NewQuery,
  credential: string | undefined,
): Promise<StoredQuery> {
  const owner = await requireOwner(dependencies, credential);
  const query = storedQuerySchema.parse({
    ...newQuerySchema.parse(input),
    id: randomUUID(),
  });
  await requireQueryStore(dependencies).add(owner, query);
  return query;
}

async function editQuery(
  dependencies: Dependencies,
  input: StoredQuery,
  credential: string | undefined,
): Promise<void> {
  const owner = await requireOwner(dependencies, credential);
  const query = storedQuerySchema.parse(input);
  const found = await requireQueryStore(dependencies).edit(owner, query);
  if (!found) {
    throw new ServiceFailure("unknown-id", `Unknown query: ${query.id}`);
  }
}

async function removeQuery(
  dependencies: Dependencies,
  id: string,
  credential: string | undefined,
): Promise<void> {
  const owner = await requireOwner(dependencies, credential);
  const found = await requireQueryStore(dependencies).remove(owner, id);
  if (!found) {
    throw new ServiceFailure("unknown-id", `Unknown query: ${id}`);
  }
}

/**
 * The one administrative door onto another user's queries (D32, D35):
 * deletes by id without ever reading the query back, so its integration,
 * arguments, and card mapper never pass through the service to the caller.
 *
 * Gated at `roles: read` — the one category where the two default roles
 * (`admin`, `user`) diverge on a plain yes/no, the closest existing signal to
 * "this caller administers the dashboard" now that user-owned data sits
 * outside the five-category matrix (D35). Docs settle *that* `admin` holds
 * this capability, not *which* category identifies it; if a deployment ever
 * separates "may see the role list" from "may administer other users'
 * queries", this gate should move to a purpose-built check instead.
 */
async function removeUserQuery(
  dependencies: Dependencies,
  user: string,
  id: string,
  credential: string | undefined,
): Promise<void> {
  const caller = await resolveCaller(dependencies, credential);
  requireRead(caller.role, "roles");
  const found = await requireQueryStore(dependencies).remove(user, id);
  if (!found) {
    throw new ServiceFailure("unknown-id", `Unknown query: ${id}`);
  }
}

function requireRead(role: Role, category: PermissionCategory): void {
  if (role.permissions[category] === "noAccess") {
    throw new ServiceFailure(
      "permission-denied",
      `Permission denied: ${category}: read`,
    );
  }
}

const permissionRank: Record<PermissionLevel, number> = {
  noAccess: 0,
  read: 1,
  edit: 2,
  write: 3,
};

function requireLevel(
  role: Role,
  category: PermissionCategory,
  level: PermissionLevel,
): void {
  if (permissionRank[role.permissions[category]] < permissionRank[level]) {
    throw new ServiceFailure(
      "permission-denied",
      `Permission denied: ${category}: ${level}`,
    );
  }
}

function applyMutation(
  configuration: DashboardConfiguration,
  mutation: Mutation,
  catalogBacked = false,
  /** The resolved caller, recorded as a new card mapper's owner (D38). */
  owner?: string,
): void {
  switch (mutation.type) {
    case "patch-card-state": {
      const card = requireById(configuration.cards, mutation.cardId, "card");
      // ponytail: shallow object patch; add JSON Merge Patch if nested updates are needed.
      card.state =
        isRecord(card.state) && isRecord(mutation.patch)
          ? { ...card.state, ...mutation.patch }
          : mutation.patch;
      return;
    }
    case "add-card":
      addById(configuration.cards, mutation.card, "card");
      return;
    case "edit-card":
      replaceById(configuration.cards, mutation.card, "card");
      return;
    case "remove-card":
      configuration.cards = removeById(
        configuration.cards,
        mutation.cardId,
        "card",
      );
      configuration.dashboard.cards = configuration.dashboard.cards.filter(
        (id) => id !== mutation.cardId,
      );
      return;
    case "insert-card": {
      const { dashboard } = configuration;
      if (dashboard.id !== mutation.dashboardId) {
        throw new ServiceFailure(
          "unknown-id",
          `Unknown dashboard: ${mutation.dashboardId}`,
        );
      }
      requireById(configuration.cards, mutation.cardId, "card");
      if (dashboard.cards.includes(mutation.cardId)) {
        throw new ServiceFailure(
          "duplicate-id",
          `Dashboard '${mutation.dashboardId}' already contains card '${mutation.cardId}'`,
        );
      }
      dashboard.cards.splice(
        mutation.index ?? dashboard.cards.length,
        0,
        mutation.cardId,
      );
      return;
    }
    case "edit-dashboard":
      if (configuration.dashboard.id !== mutation.dashboard.id) {
        throw new ServiceFailure(
          "unknown-id",
          `Unknown dashboard: ${mutation.dashboard.id}`,
        );
      }
      configuration.dashboard = mutation.dashboard;
      return;
    case "add-theme":
      addById(configuration.themes, mutation.theme, "theme");
      return;
    case "edit-theme":
      replaceById(configuration.themes, mutation.theme, "theme");
      return;
    case "remove-theme": {
      const { dashboard } = configuration;
      if (dashboard.theme === mutation.themeId) {
        throw new ServiceFailure(
          "in-use",
          `Cannot remove theme '${mutation.themeId}' because dashboard '${dashboard.id}' uses it`,
        );
      }
      configuration.themes = removeById(
        configuration.themes,
        mutation.themeId,
        "theme",
      );
      return;
    }
    case "set-font-scale":
      configuration.fontScale = mutation.fontScale;
      return;
    case "set-integration-retention-policy":
      configuration.integrationRetentionDays = mutation.retentionDays;
      return;
    case "add-integration":
      addById(
        configuration.integrations,
        catalogBacked
          ? dynamicIntegrationEntry(mutation.integration)
          : mutation.integration,
        "integration",
      );
      return;
    case "edit-integration":
      replaceById(
        configuration.integrations,
        mutation.integration,
        "integration",
      );
      return;
    case "remove-integration":
      // ponytail: no longer checks query dependents — a query lives in a
      // private per-user store (D32), and there is no cross-user store to
      // scan here without breaking D31's privacy. Add a dependency check when
      // integration removal grows the warn-then-override flow D40 describes.
      configuration.integrations = removeById(
        configuration.integrations,
        mutation.integrationId,
        "integration",
      );
      return;
    case "block-integration":
      requireById(
        configuration.integrations,
        mutation.integrationId,
        "integration",
      ).state = "blocked";
      return;
    case "unblock-integration":
      requireById(
        configuration.integrations,
        mutation.integrationId,
        "integration",
      ).state = "available";
      return;
    case "assemble-card-template":
      // Built, type-checked, and promoted through build.ts's seam above,
      // before this loop runs — nothing left to change on the configuration
      // itself (#76 registers the template's schema so cards can reference
      // it).
      return;
    case "add-card-mapper":
      // Permission-checked above (ungated, but needs a caller identity) —
      // `owner` is guaranteed defined by the time this runs.
      addByName(
        configuration.cardMappers,
        { name: mutation.name, owner: owner!, spec: mutation.spec },
        "card mapper",
      );
      return;
    case "edit-card-mapper": {
      const mapper = requireByName(
        configuration.cardMappers,
        mutation.name,
        "card mapper",
      );
      mapper.spec = mutation.spec;
      return;
    }
    case "remove-card-mapper":
      configuration.cardMappers = configuration.cardMappers.filter(
        ({ name }) => name !== mutation.name,
      );
      return;
  }
}

const cardTemplatesDir = join(process.cwd(), "src", "client", "cards");

function toComponentName(template: string): string {
  return template
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Assembles a registry item (D22, D32) per `assemble-card-template` mutation
 * and submits the *complete* candidate set — every currently active template
 * plus the newly assembled ones — to `card-templates/build.ts`'s deferred
 * seam, the one module that owns validation, type-checking, and promotion
 * (D39). One rebuild per mutation batch, not one per template.
 *
 * Validation, schema compilation, and type-checking all run here, up front —
 * a bad composition or schema throws before this returns. A valid one is
 * only *staged*: nothing lands at the manifest, client build, or tracked
 * source paths yet. The caller commits promotion and the new templates'
 * tracked source **together**, once the rest of its own mutation batch has
 * also succeeded, or discards both — so a sibling mutation failing later in
 * the same batch can never leave a template half-landed.
 */
async function applyAssembledCardTemplates(
  dependencies: Dependencies,
  mutations: Extract<Mutation, { type: "assemble-card-template" }>[],
): Promise<PreparedCardTemplateFiles | undefined> {
  if (mutations.length === 0) return undefined;

  const manifestPath =
    dependencies.cardTemplateManifestPath ?? defaultCardTemplateManifestPath();
  const clientBuildPath =
    dependencies.cardTemplateClientBuildPath ??
    defaultCardTemplateClientBuildPath();
  const activeManifest = await readActiveCardTemplateManifest(manifestPath);
  const assembledNames = new Set(mutations.map(({ template }) => template));

  const existingCandidates: CardTemplateCandidate[] = await Promise.all(
    Object.values(activeManifest)
      .filter((entry) => !assembledNames.has(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        title: entry.title,
        sourceFile: entry.sourceFile,
        clientSourcePath: `src/client/cards/${entry.sourceFile}`,
        source: await readFile(
          join(cardTemplatesDir, entry.sourceFile),
          "utf8",
        ),
        jsonSchema: entry.jsonSchema,
      })),
  );

  const assembledCandidates: CardTemplateCandidate[] = mutations.map(
    (mutation) => ({
      name: mutation.template,
      title: mutation.template,
      sourceFile: `${mutation.template}.tsx`,
      clientSourcePath: `src/client/cards/${mutation.template}.tsx`,
      source: generateComponentSource(
        mutation.composition,
        toComponentName(mutation.template),
      ),
      jsonSchema: mutation.jsonSchema,
    }),
  );

  const result = await prepareCardTemplatePromotion(
    [...existingCandidates, ...assembledCandidates],
    { manifestPath, clientBuildPath },
  );
  if (!result.ok) {
    const templates = mutations
      .map(({ template }) => `'${template}'`)
      .join(", ");
    throw new ServiceFailure(
      "invalid-card-template",
      `Card template(s) ${templates} failed to build (${result.stage}): ${result.message}`,
    );
  }

  return {
    commit: async () => {
      await mkdir(cardTemplatesDir, { recursive: true });
      await Promise.all(
        assembledCandidates.map((candidate) =>
          writeFile(
            join(cardTemplatesDir, candidate.sourceFile),
            candidate.source,
          ),
        ),
      );
      await result.prepared.commit();
    },
    discard: () => result.prepared.discard(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireById<T extends { id: string }>(
  values: T[],
  id: string,
  label: string,
): T {
  const value = values.find((candidate) => candidate.id === id);
  if (!value) throw new ServiceFailure("unknown-id", `Unknown ${label}: ${id}`);
  return value;
}

function addById<T extends { id: string }>(
  values: T[],
  addition: T,
  label: string,
): void {
  if (values.some(({ id }) => id === addition.id)) {
    throw new ServiceFailure(
      "duplicate-id",
      `Duplicate ${label}: ${addition.id}`,
    );
  }
  values.push(addition);
}

function replaceById<T extends { id: string }>(
  values: T[],
  replacement: T,
  label: string,
): void {
  const index = values.findIndex(({ id }) => id === replacement.id);
  if (index === -1) {
    throw new ServiceFailure(
      "unknown-id",
      `Unknown ${label}: ${replacement.id}`,
    );
  }
  values[index] = replacement;
}

/** Same as `addById`, keyed by `name` — card mappers are addressed by name, not id (D38). */
function addByName<T extends { name: string }>(
  values: T[],
  addition: T,
  label: string,
): void {
  if (values.some(({ name }) => name === addition.name)) {
    throw new ServiceFailure(
      "duplicate-id",
      `Duplicate ${label}: ${addition.name}`,
    );
  }
  values.push(addition);
}

function requireByName<T extends { name: string }>(
  values: T[],
  name: string,
  label: string,
): T {
  const value = values.find((candidate) => candidate.name === name);
  if (!value)
    throw new ServiceFailure("unknown-id", `Unknown ${label}: ${name}`);
  return value;
}

function removeById<T extends { id: string }>(
  values: T[],
  id: string,
  label: string,
): T[] {
  const remaining = values.filter((value) => value.id !== id);
  if (remaining.length === values.length) {
    throw new ServiceFailure("unknown-id", `Unknown ${label}: ${id}`);
  }
  return remaining;
}
