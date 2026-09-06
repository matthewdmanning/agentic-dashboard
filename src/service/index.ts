import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";

import type { AuthStore } from "../auth";
import { isLocalUserToken } from "../auth/local-user";
import type { CredentialStore } from "../server/integrations/credentials";
import {
  dynamicIntegrationEntry,
  type IntegrationCatalog,
  type IntegrationCatalogEntry,
} from "../server/integrations/catalog";
import { connectableTypesFromCatalog } from "../server/integrations/catalog-queries";
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
  | "credentials-unavailable"
  | "invalid-card-template";

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
  /** Where an integration's authorization secret lives — see `CredentialStore` (D16). */
  credentials?: CredentialStore;
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
   * The authorization handoff for one connection (D16): stores its secret
   * outside dashboard configuration. Not a mutation — a credential never
   * enters `DashboardConfiguration` or a read projection (`contract`
   * already refuses a credential-shaped `integration.settings` key; this
   * keeps the same promise for the store `apply` never touches). Gated at
   * `integrations: edit` — the connection already exists via
   * `add-integration`; authorizing it changes something that exists (D20).
   */
  authorize(
    connectionId: string,
    connectionCredential: string,
    credential?: string,
  ): Promise<void>;
  /** The services this build can connect to. Gated at `integrations: read`. */
  connectableTypes(credential?: string): Promise<string[]>;
}

export function createService(dependencies: Dependencies): DashboardService {
  let tail = Promise.resolve();
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
    authorize: (connectionId, connectionCredential, credential) =>
      enqueue(() =>
        authorizeConnection(
          dependencies,
          connectionId,
          connectionCredential,
          credential,
        ),
      ),
    connectableTypes: (credential) =>
      enqueue(() => readConnectableTypes(dependencies, credential)),
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

  if (scope !== "all" && scope !== "role") requireRead(role, scope);

  // Built per scope, not all at once: `all` refuses a role that may read
  // nothing, which must not decide the answer for a scope nobody asked for.
  const scoped: { [Scope in ReadScope]: () => ReadScopes[Scope] } = {
    all: () =>
      projectReadable(configuration, role, dependencies.roles ?? roles, integrations),
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
  if (role.permissions.cards !== "noAccess" || role.permissions.data !== "noAccess") {
    readable.cards = configuration.cards;
  }
  if (role.permissions.presentation !== "noAccess") {
    readable.dashboard = configuration.dashboard;
    readable.themes = configuration.themes;
    readable.fontScale = configuration.fontScale;
  }
  if (role.permissions.integrations !== "noAccess") {
    readable.integrations = integrations;
  }
  if (role.permissions.roles !== "noAccess") readable.roles = [...availableRoles];

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
      applyMutation(candidate, mutation, dependencies.catalog !== undefined);
    }
    next = parseDashboardConfiguration(candidate);
    await dependencies.persistence.write(
      dependencies.catalog ? { ...next, integrations: configuration.integrations } : next,
    );
    if (
      dependencies.catalog &&
      mutations.some(({ type }) =>
        ["add-integration", "edit-integration", "remove-integration"].includes(type),
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

  // Revoking an integration's authorization rides along with removing it
  // (D16) — there is no "disconnect without removing" action to hang a
  // separate revoke on, and it fires here so every caller of `apply` gets
  // it, not just the ones that happen to go through one adapter.
  //
  // ponytail: after the write, so a failed revoke orphans the secret of an
  // integration that is already gone. Re-authorizing then removing it again
  // clears it. Make the pair atomic if a credential store ever fails often
  // enough to matter.
  if (dependencies.credentials) {
    const removed = mutations.filter(
      (
        mutation,
      ): mutation is Extract<Mutation, { type: "remove-integration" }> =>
        mutation.type === "remove-integration",
    );
    await Promise.all(
      removed.map((mutation) =>
        dependencies.credentials!.remove(mutation.integrationId),
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

async function authorizeConnection(
  dependencies: Dependencies,
  connectionId: string,
  connectionCredential: string,
  credential: string | undefined,
): Promise<void> {
  const configuration = await readConfiguration(dependencies.persistence);
  const integrations = await readIntegrations(dependencies, configuration);
  const caller = await resolveCaller(dependencies, credential);
  const role = caller.role;
  requireLevel(role, "integrations", "edit");

  if (!integrations.some(({ id }) => id === connectionId)) {
    throw new ServiceFailure(
      "unknown-id",
      `Unknown integration: ${connectionId}`,
    );
  }

  if (!dependencies.credentials) {
    throw new ServiceFailure(
      "credentials-unavailable",
      "Credential storage is not configured",
    );
  }
  await dependencies.credentials.set(connectionId, connectionCredential);
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
    case "remove-integration": {
      const card = configuration.cards.find(({ queries }) =>
        queries.some(
          ({ integration }) => integration === mutation.integrationId,
        ),
      );
      if (card) {
        throw new ServiceFailure(
          "in-use",
          `Cannot remove integration '${mutation.integrationId}' because card '${card.id}' uses it`,
        );
      }
      configuration.integrations = removeById(
        configuration.integrations,
        mutation.integrationId,
        "integration",
      );
      return;
    }
    case "assemble-card-template":
      // Built, type-checked, and promoted through build.ts's seam above,
      // before this loop runs — nothing left to change on the configuration
      // itself (#76 registers the template's schema so cards can reference
      // it).
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
        source: await readFile(join(cardTemplatesDir, entry.sourceFile), "utf8"),
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
    const templates = mutations.map(({ template }) => `'${template}'`).join(", ");
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
          writeFile(join(cardTemplatesDir, candidate.sourceFile), candidate.source),
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
