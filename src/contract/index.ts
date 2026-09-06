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

export const integrationSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    settings: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine(({ settings }, context) => {
    if (Object.keys(settings).some((key) => credentialKey.test(key))) {
      context.addIssue({
        code: "custom",
        path: ["settings"],
        message: "Integration credentials are not allowed",
      });
    }
  });

export type Integration = z.infer<typeof integrationSchema>;

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

export const formatterSpecSchema = z.discriminatedUnion("shape", [
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

export type FormatterSpec = z.infer<typeof formatterSpecSchema>;
type FieldSpec = z.infer<typeof fieldSpecSchema>;

/**
 * A card template's component as data (D22): a tree of real
 * `react-aria-components` exports the service can turn into real source.
 * Structural only — no enum of component names, no per-component prop
 * schema (an earlier draft duplicated the library's own types and drifted;
 * `tsc --noEmit` on the assembled output is the correctness check, not this
 * schema). Same reasoning as `formatterSpecSchema`: closed on shape, open
 * on domain fields.
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
    formatter: formatterSpecSchema,
  })
  .strict();

export type Query = z.infer<typeof querySchema>;

export const cardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    template: cardTemplateNameSchema,
    state: z.unknown(),
    queries: z.array(querySchema),
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
  })
  .strict();

const removeThemeMutationSchema = z
  .object({
    type: z.literal("remove-theme"),
    themeId: z.string().min(1),
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
  assembleCardTemplateMutationSchema,
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
  "assemble-card-template": { category: "cards", level: "write" },
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
      queries: [],
    },
  ],
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
  const cardIds = new Set(configuration.cards.map(({ id }) => id));
  const themeIds = new Set(configuration.themes.map(({ id }) => id));
  const integrationIds = new Set(
    configuration.integrations.map(({ id }) => id),
  );

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
    for (const query of card.queries) {
      if (!integrationIds.has(query.integration)) {
        throw new Error(
          `Invalid dashboard configuration: card '${card.id}' references unknown integration '${query.integration}'`,
        );
      }
    }

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

export function compileFormatterSpec(
  spec: FormatterSpec,
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
