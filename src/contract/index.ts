import * as z from "zod/v4";

import { cardTemplateSchemas, type CardTemplateName } from "./card-templates";

export { cardTemplateSchemas, type CardTemplateName };
export { roles, localUser, unauthenticatedUser, findRole } from "./roles";

/**
 * A card template name is valid when this dashboard actually has that template.
 * Checked by membership rather than a fixed enum, because the set is empty
 * today (D32) and an enum needs at least one member.
 */
const cardTemplateNameSchema = z
  .string()
  .min(1)
  .refine((name) => name in cardTemplateSchemas, {
    message: "Unknown card template",
  });

const permissionLevelSchema = z.enum(["noAccess", "read", "edit", "write"]);

export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const permissionCategorySchema = z.enum([
  "data",
  "cards",
  "presentation",
  "integrations",
  "roles",
]);

export type PermissionCategory = z.infer<typeof permissionCategorySchema>;

export const permissionBundleSchema = z
  .object({
    data: permissionLevelSchema,
    cards: permissionLevelSchema,
    presentation: permissionLevelSchema,
    integrations: permissionLevelSchema,
    roles: permissionLevelSchema,
  })
  .strict();

export type PermissionBundle = z.infer<typeof permissionBundleSchema>;

export const roleSchema = z
  .object({
    name: z.string().min(1),
    permissions: permissionBundleSchema,
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;

const credentialKey = /credential|password|secret|token|api.?key|access.?key/i;

function containsCredentialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => credentialKey.test(key) || containsCredentialKey(nested),
  );
}

export const integrationSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
    origin: z.enum(["default", "recommended", "dynamic"]).optional(),
    state: z.enum(["available", "blocked"]).optional(),
    // When a dynamic entry's last connection was removed (D40, #89) -- unset
    // while connected, or for a default/recommended entry that never expires.
    // Maintained by the retention reconciler, not a caller-authored value.
    unusedSince: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine(({ settings }, context) => {
    if (containsCredentialKey(settings)) {
      context.addIssue({
        code: "custom",
        path: ["settings"],
        message: "Integration credentials are not allowed",
      });
    }
  });

export type Integration = z.infer<typeof integrationSchema>;

export const integrationCatalogEntrySchema = integrationSchema
  .safeExtend({
    origin: z.enum(["default", "recommended", "dynamic"]),
    state: z.enum(["available", "blocked"]),
  })
  .strict();

export type IntegrationCatalogEntry = z.infer<
  typeof integrationCatalogEntrySchema
>;

export const themeSchema = z
  .object({
    id: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;

const fieldSpecSchema = z
  .object({
    from: z.array(z.string().min(1)).min(1),
    default: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .optional(),
    coerce: z.literal("string").optional(),
  })
  .strict();

export const cardMapperSpecSchema = z.discriminatedUnion("shape", [
  z
    .object({
      shape: z.literal("object"),
      fields: z.record(z.string(), fieldSpecSchema),
    })
    .strict(),
  z
    .object({
      shape: z.literal("array"),
      from: z.array(z.string().min(1)).min(1),
      into: z.string().min(1),
      fields: z.record(z.string(), fieldSpecSchema),
    })
    .strict(),
]);

export type CardMapperSpec = z.infer<typeof cardMapperSpecSchema>;
type FieldSpec = z.infer<typeof fieldSpecSchema>;

/**
 * A card mapper stored in the shared store (D38): a declarative mapping spec,
 * named, with the resolved caller who added it recorded as `owner`. A query
 * references one by `name` rather than holding a copy.
 */
export const cardMapperSchema = z
  .object({
    name: z.string().min(1),
    owner: z.string().min(1),
    spec: cardMapperSpecSchema,
  })
  .strict();

export type CardMapper = z.infer<typeof cardMapperSchema>;

/**
 * A card template's component as data (D22): a tree of real shadcn/ui
 * component exports the service can turn into real source. Structural only —
 * no enum of component names, no per-component prop schema (an earlier draft
 * duplicated the library's own types and drifted; `tsc --noEmit` on the
 * assembled output is the correctness check, not this schema). Same
 * reasoning as `cardMapperSpecSchema`: closed on shape, open on domain fields.
 */
export interface CompositionNode {
  component: string;
  props: Record<string, unknown>;
  children: CompositionNode[];
}

export const compositionNodeSchema: z.ZodType<CompositionNode> = z.object({
  component: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.lazy(() => compositionNodeSchema)),
});

export const querySchema = z
  .object({
    integration: z.string().min(1),
    query: z.unknown(),
    // Names a card mapper in the shared store (D38) rather than holding a
    // spec inline. `"identity"` names the built-in, source-only mapper and
    // never resolves against the store.
    cardMapper: z.string().min(1),
  })
  .strict();

export type Query = z.infer<typeof querySchema>;

export const cardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    template: cardTemplateNameSchema,
    state: z.unknown(),
  })
  .strict();

export type Card = z.infer<typeof cardSchema>;

export const dashboardSchema = z
  .object({
    id: z.string().min(1),
    cards: z.array(z.string().min(1)),
    theme: z.string().min(1),
  })
  .strict();

export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardConfigurationSchema = z
  .object({
    integrations: z.array(integrationSchema),
    themes: z.array(themeSchema),
    dashboard: dashboardSchema,
    fontScale: z.number().min(0.75).max(2),
    cards: z.array(cardSchema),
    // The shared card mapper store (D38): a query names one of these by
    // `name` rather than holding a copy.
    cardMappers: z.array(cardMapperSchema),
    // How long a dynamic integration with zero connections is kept before
    // the retention reconciler removes it (D40, #89). Never applies to a
    // default or recommended entry.
    integrationRetentionDays: z.number().int().positive(),
  })
  .strict();

/**
 * What `read("all")` returns: the categories the caller may read, with the rest
 * omitted. Parsing a projection with the full schema would reject a caller who
 * is denied one category, which is what omitting rather than failing avoids.
 *
 * Roles are not part of dashboard configuration (D35) — they come from the
 * roles file — but `read("all")` returns them alongside it for a caller whose
 * `roles` level allows it, so the readable projection carries them too.
 */
export const readableDashboardSchema = dashboardConfigurationSchema
  .partial()
  .extend({ roles: z.array(roleSchema).optional() });

export type ReadableDashboard = z.infer<typeof readableDashboardSchema>;

export type DashboardConfiguration = z.infer<
  typeof dashboardConfigurationSchema
>;

const cardStateMutationSchema = z
  .object({
    type: z.literal("patch-card-state"),
    cardId: z.string().min(1),
    patch: z.unknown(),
  })
  .strict();

const addCardMutationSchema = z
  .object({
    type: z.literal("add-card"),
    card: cardSchema,
  })
  .strict();

const editCardMutationSchema = z
  .object({
    type: z.literal("edit-card"),
    card: cardSchema,
  })
  .strict();

const removeCardMutationSchema = z
  .object({
    type: z.literal("remove-card"),
    cardId: z.string().min(1),
  })
  .strict();

const insertCardMutationSchema = z
  .object({
    type: z.literal("insert-card"),
    dashboardId: z.string().min(1),
    cardId: z.string().min(1),
    index: z.number().int().nonnegative().optional(),
  })
  .strict();

const editDashboardMutationSchema = z
  .object({
    type: z.literal("edit-dashboard"),
    dashboard: dashboardSchema,
  })
  .strict();

const addThemeMutationSchema = z
  .object({
    type: z.literal("add-theme"),
    theme: themeSchema,
  })
  .strict();

const editThemeMutationSchema = z
  .object({
    type: z.literal("edit-theme"),
    theme: themeSchema,
  })
  .strict();

const setFontScaleMutationSchema = z
  .object({
    type: z.literal("set-font-scale"),
    fontScale: z.number().min(0.75).max(2),
  })
  .strict();

const addIntegrationMutationSchema = z
  .object({
    type: z.literal("add-integration"),
    integration: integrationSchema,
  })
  .strict();

const editIntegrationMutationSchema = z
  .object({
    type: z.literal("edit-integration"),
    integration: integrationSchema,
  })
  .strict();

const removeIntegrationMutationSchema = z
  .object({
    type: z.literal("remove-integration"),
    integrationId: z.string().min(1),
    // Required once a dependency count is nonzero (D40, #93): the ordinary
    // confirmation (this flag absent or false) never proceeds past a
    // dependent entry. Never destroys a query -- only its connections.
    override: z.boolean().optional(),
  })
  .strict();

/** Suspends a catalog entry (D40, #92): blocks new connections and refreshes, keeps everything stored. Gated at `integrations: write`, stricter than `edit-integration`'s `edit`. */
const blockIntegrationMutationSchema = z
  .object({
    type: z.literal("block-integration"),
    integrationId: z.string().min(1),
  })
  .strict();

/** Reverses `block-integration` (D40, #92): restores connection and refresh behavior without reauthorization, since nothing about the connection or query was touched. */
const unblockIntegrationMutationSchema = z
  .object({
    type: z.literal("unblock-integration"),
    integrationId: z.string().min(1),
  })
  .strict();

const removeThemeMutationSchema = z
  .object({
    type: z.literal("remove-theme"),
    themeId: z.string().min(1),
  })
  .strict();

/** Changes the project-wide unused-integration retention period (D40, #89). Default is 30 days; only `integrations: write` may change it. */
const setIntegrationRetentionPolicyMutationSchema = z
  .object({
    type: z.literal("set-integration-retention-policy"),
    retentionDays: z.number().int().positive(),
  })
  .strict();

/**
 * Adding is ungated by structure (D38): the resolved caller becomes the
 * mapper's `owner`, never a payload field, the same reasoning `addQuery`
 * uses for a query's owner. `mutationRequirements` still carries an entry
 * (a `noAccess` floor, which every role clears) so the type stays in the
 * exhaustive `Mutation` union `apply` enforces against.
 */
const addCardMapperMutationSchema = z
  .object({
    type: z.literal("add-card-mapper"),
    name: z.string().min(1),
    spec: cardMapperSpecSchema,
  })
  .strict();

/**
 * Replaces a stored mapper's spec, keeping its name and owner. Whether this
 * needs only ownership or `cards: write` depends on whether the mapper is
 * currently referenced by any query — runtime state `service` alone can
 * check, so the conditional gate lives there, the same way `remove-card`'s
 * extra `presentation: write` check does.
 */
const editCardMapperMutationSchema = z
  .object({
    type: z.literal("edit-card-mapper"),
    name: z.string().min(1),
    spec: cardMapperSpecSchema,
  })
  .strict();

/** Fails with `in-use` in `service` when any query still names it (D38). */
const removeCardMapperMutationSchema = z
  .object({
    type: z.literal("remove-card-mapper"),
    name: z.string().min(1),
  })
  .strict();

/**
 * D22's one card-template capability the service has: assemble a template's
 * component from a composition tree. An ordinary mutation, not a separate
 * operation like `authorize` — `authorize` is separate because it writes to
 * a store `apply` never touches (a credential, outside
 * `DashboardConfiguration`); this produces a card template, which (like
 * every other mutation) is gated by `mutationRequirements` and applied
 * through the same pipeline. Assembling the tree into real component source
 * is service-side work, out of scope here (#74).
 */
const assembleCardTemplateMutationSchema = z
  .object({
    type: z.literal("assemble-card-template"),
    // Becomes a filesystem path segment in `service` — no path separators,
    // no `.`, so it can't traverse out of the card-templates directory.
    template: z.string().regex(/^[A-Za-z0-9_-]+$/),
    // Mandatory (D22): the state a template displays is validated by this
    // schema, not inferred from the composition. Structural validity — is it
    // a compilable JSON Schema — is checked later, at the build seam.
    jsonSchema: z.record(z.string(), z.unknown()),
    composition: compositionNodeSchema,
  })
  .strict();

export const mutationSchema = z.discriminatedUnion("type", [
  cardStateMutationSchema,
  addCardMutationSchema,
  editCardMutationSchema,
  removeCardMutationSchema,
  insertCardMutationSchema,
  editDashboardMutationSchema,
  addThemeMutationSchema,
  editThemeMutationSchema,
  removeThemeMutationSchema,
  setFontScaleMutationSchema,
  addIntegrationMutationSchema,
  editIntegrationMutationSchema,
  removeIntegrationMutationSchema,
  blockIntegrationMutationSchema,
  unblockIntegrationMutationSchema,
  setIntegrationRetentionPolicyMutationSchema,
  assembleCardTemplateMutationSchema,
  addCardMapperMutationSchema,
  editCardMapperMutationSchema,
  removeCardMapperMutationSchema,
]);

export type Mutation = z.infer<typeof mutationSchema>;
export const mutationsSchema = z.array(mutationSchema).min(1);

export interface MutationRequirement {
  category: PermissionCategory;
  level: PermissionLevel;
}

/**
 * What each mutation type requires. Both facts belong to the type rather than
 * to an instance, so a caller states only its payload and `service` enforces
 * with one lookup. `edit` changes something that already exists; `write` also
 * creates and destroys.
 */
export const mutationRequirements = {
  "patch-card-state": { category: "data", level: "edit" },
  "add-card": { category: "cards", level: "write" },
  "edit-card": { category: "cards", level: "edit" },
  "remove-card": { category: "cards", level: "write" },
  "insert-card": { category: "presentation", level: "edit" },
  "edit-dashboard": { category: "presentation", level: "edit" },
  "add-theme": { category: "presentation", level: "write" },
  "edit-theme": { category: "presentation", level: "edit" },
  "remove-theme": { category: "presentation", level: "write" },
  "set-font-scale": { category: "presentation", level: "edit" },
  "add-integration": { category: "integrations", level: "write" },
  "edit-integration": { category: "integrations", level: "edit" },
  "remove-integration": { category: "integrations", level: "write" },
  "block-integration": { category: "integrations", level: "write" },
  "unblock-integration": { category: "integrations", level: "write" },
  "set-integration-retention-policy": {
    category: "integrations",
    level: "write",
  },
  "assemble-card-template": { category: "cards", level: "write" },
  // A floor only — real enforcement is ownership- and reference-conditional
  // and lives in `service` (D38): adding is always ungated, editing or
  // removing an unreferenced mapper needs only ownership, and only a
  // referenced mapper falls back to `cards: write` (never for removal,
  // which always fails `in-use` instead).
  "add-card-mapper": { category: "cards", level: "noAccess" },
  "edit-card-mapper": { category: "cards", level: "noAccess" },
  "remove-card-mapper": { category: "cards", level: "noAccess" },
} as const satisfies Record<Mutation["type"], MutationRequirement>;

export const defaultDashboardConfiguration: DashboardConfiguration = {
  integrations: [],
  themes: [{ id: "calm", settings: {} }],
  dashboard: { id: "home", cards: ["welcome"], theme: "calm" },
  fontScale: 1,
  cards: [
    {
      id: "welcome",
      title: "Welcome",
      template: "message",
      state: { message: "Welcome to your dashboard." },
    },
  ],
  cardMappers: [],
  integrationRetentionDays: 30,
};

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Invalid dashboard configuration: duplicate ${label}`);
  }
}

export function parseDashboardConfiguration(
  candidate: unknown,
): DashboardConfiguration {
  const configuration = dashboardConfigurationSchema.parse(candidate);

  assertUnique(
    configuration.integrations.map(({ id }) => id),
    "integration id",
  );
  assertUnique(
    configuration.themes.map(({ id }) => id),
    "theme id",
  );
  assertUnique(
    configuration.cards.map(({ id }) => id),
    "card id",
  );
  assertUnique(
    configuration.cardMappers.map(({ name }) => name),
    "card mapper name",
  );
  const cardIds = new Set(configuration.cards.map(({ id }) => id));
  const themeIds = new Set(configuration.themes.map(({ id }) => id));

  const { dashboard } = configuration;
  assertUnique(
    dashboard.cards,
    `card reference in dashboard '${dashboard.id}'`,
  );
  if (!themeIds.has(dashboard.theme)) {
    throw new Error(
      `Invalid dashboard configuration: dashboard '${dashboard.id}' references unknown theme '${dashboard.theme}'`,
    );
  }
  for (const cardId of dashboard.cards) {
    if (!cardIds.has(cardId)) {
      throw new Error(
        `Invalid dashboard configuration: dashboard '${dashboard.id}' references unknown card '${cardId}'`,
      );
    }
  }

  for (const card of configuration.cards) {
    const state = cardTemplateSchemas[card.template]!.safeParse(card.state);
    if (!state.success) {
      throw new Error(
        `Invalid dashboard configuration: card '${card.id}' state does not fit card template '${card.template}': ${z.prettifyError(state.error)}`,
      );
    }
  }

  return configuration;
}

function resolvePath(root: unknown, path: string, index?: number): unknown {
  let value: unknown = root;
  for (const segment of path.split(".")) {
    if (segment === "$index") {
      value = index;
      continue;
    }
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function resolveField(
  root: unknown,
  spec: FieldSpec,
  index: number | undefined,
): [present: true, value: unknown] | [present: false] {
  for (const path of spec.from) {
    const value = resolvePath(root, path, index);
    if (value !== undefined && value !== null) {
      return [true, spec.coerce === "string" ? String(value) : value];
    }
  }
  if (spec.default !== undefined) {
    const value =
      typeof spec.default === "string" && index !== undefined
        ? spec.default.replace("$index", String(index))
        : spec.default;
    return [true, value];
  }
  return [false];
}

function applyFields(
  root: unknown,
  fields: Record<string, FieldSpec>,
  index?: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const [present, value] = resolveField(root, spec, index);
    if (present) result[key] = value;
  }
  return result;
}

export function compileCardMapper(
  spec: CardMapperSpec,
): (input: unknown) => unknown {
  if (spec.shape === "object") {
    return (input) => applyFields(input, spec.fields);
  }

  return (input) => {
    let array: unknown;
    for (const path of spec.from) {
      array = resolvePath(input, path);
      if (array !== undefined && array !== null) break;
    }
    const sourceArray = Array.isArray(array) ? array : [];
    return {
      [spec.into]: sourceArray.map((item, index) =>
        applyFields(item, spec.fields, index),
      ),
    };
  };
}
