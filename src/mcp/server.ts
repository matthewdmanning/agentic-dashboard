import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  baseColourSchema,
  menuAccentSchema,
  menuColourSchema,
  mutationSchema,
  namedPresetSchema,
  typesetSchema,
  type Mutation,
  type NamedPreset,
} from "../contract";
import { ServiceFailure, type DashboardService } from "../service";

const readScopeSchema = z.enum([
  "all",
  "role",
  "data",
  "cards",
  "presentation",
  "integrations",
  "roles",
  "queries",
]);

function result(
  text: string,
  isError = false,
  structuredContent?: Record<string, unknown>,
) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
    ...(structuredContent ? { structuredContent } : {}),
  };
}

/**
 * Service failures — denied permissions, unknown ids, refused removals — are
 * answers the caller can act on, so they come back as tool results rather than
 * protocol errors. Per D14, the service's own name for the failure travels
 * with the result as `structuredContent.code`, so a caller can act on the
 * code rather than matching on the message text.
 */
async function reply(operation: () => Promise<string>) {
  try {
    return result(await operation());
  } catch (error) {
    if (error instanceof ServiceFailure) {
      return result(error.message, true, { code: error.code });
    }
    return result(error instanceof Error ? error.message : String(error), true);
  }
}

interface MutationToolDescriptor {
  name: string;
  description: string;
  successMessage: string;
}

/**
 * One MCP tool per `Mutation` variant, driven off `mutationSchema` itself
 * (contract) rather than a hand-copied input schema per tool -- the payload
 * shape and its validation (including `.strict()`) come straight from the
 * same schema `apply` enforces, so the two can't quietly drift apart.
 * `null` marks a variant deliberately excluded from this generic table --
 * `insert-card` needs `dashboard.id` fetched first (registered by hand
 * below), and `add-card-mapper`/`edit-card-mapper`/`remove-card-mapper`
 * have no MCP tool at all today (exposing them is its own decision, not a
 * side effect of this table). `satisfies Record<Mutation["type"], ...>`
 * mirrors `mutationRequirements`'s own pattern in contract -- a mutation
 * type added there without a decision here fails `tsc`, not silently.
 */
const mutationToolDescriptors = {
  "add-card": {
    name: "add-card",
    description: "Add a new card.",
    successMessage: "Card added",
  },
  "edit-card": {
    name: "edit-card",
    description: "Replace an existing card.",
    successMessage: "Card edited",
  },
  "remove-card": {
    name: "remove-card",
    description: "Delete a card.",
    successMessage: "Card removed",
  },
  "patch-card-state": {
    name: "patch-card-state",
    description: "Patch the state displayed by an existing card.",
    successMessage: "Card state updated",
  },
  "insert-card": null,
  "assemble-card-template": {
    name: "assemble-card-template",
    description:
      "Assemble a complete card template from a name, a mandatory JSON Schema, and a declarative composition tree of shadcn/ui components.",
    successMessage: "Card template assembled",
  },
  "edit-dashboard": {
    name: "edit-dashboard",
    description: "Replace the dashboard document.",
    successMessage: "Dashboard updated",
  },
  "add-theme": {
    name: "add-theme",
    description: "Add a theme.",
    successMessage: "Theme added",
  },
  "edit-theme": {
    name: "edit-theme",
    description: "Replace an existing theme.",
    successMessage: "Theme edited",
  },
  "remove-theme": {
    name: "remove-theme",
    description: "Delete an unused theme.",
    successMessage: "Theme removed",
  },
  "add-preset": {
    name: "add-preset",
    description:
      "Add a server-listed preset (a complete token set: theme mapping, light and dark blocks, radius, base rules) visible to every user.",
    successMessage: "Preset added",
  },
  "remove-preset": {
    name: "remove-preset",
    description:
      "Delete a server-listed preset. Any user who had it selected falls back to their base colour.",
    successMessage: "Preset removed",
  },
  "add-integration": {
    name: "add-integration",
    description: "Add an integration.",
    successMessage: "Integration added",
  },
  "edit-integration": {
    name: "edit-integration",
    description: "Replace an existing integration.",
    successMessage: "Integration edited",
  },
  "remove-integration": {
    name: "remove-integration",
    description:
      "Delete an integration. Fails naming aggregate connection and query counts if anything depends on it -- pass override to remove it anyway. Removing destroys its connections; queries stay stored but become unavailable.",
    successMessage: "Integration removed",
  },
  "block-integration": {
    name: "block-integration",
    description:
      "Suspend an integration: rejects new connections and query refreshes, but keeps every connection and query stored.",
    successMessage: "Integration blocked",
  },
  "unblock-integration": {
    name: "unblock-integration",
    description:
      "Restore a blocked integration to normal connection and refresh behavior. No reauthorization is needed.",
    successMessage: "Integration unblocked",
  },
  "set-integration-retention-policy": {
    name: "set-integration-retention-policy",
    description:
      "Set how many days an unused dynamic integration is kept before it is automatically removed. Never applies to a default or recommended integration.",
    successMessage: "Retention policy updated",
  },
  "add-card-mapper": null,
  "edit-card-mapper": null,
  "remove-card-mapper": null,
} as const satisfies Record<Mutation["type"], MutationToolDescriptor | null>;

export function createDashboardMcpServer(service: DashboardService) {
  const server = new McpServer({
    name: "personal-dashboard",
    version: "0.0.0",
  });

  const apply = (mutation: Mutation, message: string) =>
    reply(async () => {
      await service.apply([mutation]);
      return message;
    });

  server.registerTool(
    "read-dashboard",
    {
      description:
        "Read the dashboard state allowed by the caller's role. Scope 'role' returns the caller's own permissions.",
      inputSchema: z.object({
        scope: readScopeSchema.default("all"),
      }),
    },
    async ({ scope }) =>
      reply(async () => JSON.stringify(await service.read(scope))),
  );

  // Cast away the 20-way union of exact `.omit` overloads: every variant is
  // `z.object({ type: z.literal(...), ...}).strict()`, so `.shape.type.value`
  // and `.omit({type: true})` are safe on all of them, but TS can't unify the
  // overload across a union this wide.
  for (const option of mutationSchema.options as z.ZodObject<z.ZodRawShape>[]) {
    const type = (option.shape.type as z.ZodLiteral<string>)
      .value as Mutation["type"];
    const descriptor = mutationToolDescriptors[type];
    if (!descriptor) continue;
    server.registerTool(
      descriptor.name,
      {
        description: descriptor.description,
        inputSchema: option.omit({ type: true }),
      },
      async (args: Record<string, unknown>) =>
        apply({ type, ...args } as Mutation, descriptor.successMessage),
    );
  }

  server.registerTool(
    "insert-card",
    {
      description: "Place an existing card on the dashboard.",
      inputSchema: z.object({
        cardId: z.string(),
        index: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ cardId, index }) =>
      reply(async () => {
        const { dashboard } = await service.read("presentation");
        await service.apply([
          {
            type: "insert-card",
            dashboardId: dashboard.id,
            cardId,
            index,
          },
        ]);
        return "Card inserted";
      }),
  );

  server.registerTool(
    "connect-integration",
    {
      description:
        "Hand off an already-obtained credential (an access token, an API key) to connect your own account to an existing integration.",
      inputSchema: z.object({
        integrationId: z.string(),
        credential: z.string(),
      }),
    },
    async ({ integrationId, credential }) =>
      reply(async () => {
        await service.connect(integrationId, credential);
        return "Connected";
      }),
  );

  server.registerTool(
    "disconnect-integration",
    {
      description:
        "Destroy your own stored credential for an integration. The integration itself is unaffected.",
      inputSchema: z.object({ integrationId: z.string() }),
    },
    async ({ integrationId }) =>
      reply(async () => {
        await service.disconnect(integrationId);
        return "Disconnected";
      }),
  );

  server.registerTool(
    "read-appearance",
    {
      description:
        "Read your own appearance preference (base colour, typeset, menu treatment) and its derived stylesheet.",
      inputSchema: z.object({}),
    },
    async () =>
      reply(async () => JSON.stringify(await service.readAppearance())),
  );

  server.registerTool(
    "set-base-colour",
    {
      description:
        "Set your own base colour. Recolours every card for you; never affects another user or the project's own component-library configuration.",
      inputSchema: z.object({ baseColour: baseColourSchema }),
    },
    async ({ baseColour }) =>
      reply(async () => {
        await service.setAppearance({ baseColour });
        return "Appearance updated";
      }),
  );

  server.registerTool(
    "set-typeset",
    {
      description:
        "Set your own complete typeset (size, leading, flow, body/heading/monospace font). Replaces fontScale — size is the same setting under shadcn's own vocabulary. Applies only to you.",
      inputSchema: z.object({ typeset: typesetSchema }),
    },
    async ({ typeset }) =>
      reply(async () => {
        await service.setAppearance({ typeset });
        return "Typeset updated";
      }),
  );

  server.registerTool(
    "set-menu-appearance",
    {
      description:
        "Set your own shadcn menu colour and/or accent. Applies only to you.",
      inputSchema: z.object({
        menuColour: menuColourSchema.optional(),
        menuAccent: menuAccentSchema.optional(),
      }),
    },
    async ({ menuColour, menuAccent }) =>
      reply(async () => {
        await service.setAppearance({
          ...(menuColour ? { menuColour } : {}),
          ...(menuAccent ? { menuAccent } : {}),
        });
        return "Menu appearance updated";
      }),
  );

  /**
   * Personal-preset add/update/remove (#96) go through `readAppearance` then
   * `setAppearance`, the same pair the HTTP appearance endpoint composes
   * from — there is no dedicated service method. ponytail: two round trips
   * on the same global operation queue, not one atomic update; a known
   * ceiling for the same user editing their own list from two places at
   * once, not for concurrent users (each keyed by their own identity).
   * Upgrade path: a dedicated `DashboardService` method if that ever bites.
   */
  function upsertPersonalPreset(preset: NamedPreset) {
    return reply(async () => {
      const current = await service.readAppearance();
      const personalPresets = [
        ...current.personalPresets.filter(({ id }) => id !== preset.id),
        preset,
      ];
      await service.setAppearance({ personalPresets });
      return "Personal preset saved";
    });
  }

  server.registerTool(
    "add-personal-preset",
    {
      description:
        "Add or update one of your own presets (a complete token set). Ungated — never affects another user or the server-listed presets.",
      inputSchema: z.object({ preset: namedPresetSchema }),
    },
    async ({ preset }) => upsertPersonalPreset(preset),
  );

  server.registerTool(
    "remove-personal-preset",
    {
      description: "Remove one of your own presets by id.",
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) =>
      reply(async () => {
        const current = await service.readAppearance();
        await service.setAppearance({
          personalPresets: current.personalPresets.filter(
            (preset) => preset.id !== id,
          ),
        });
        return "Personal preset removed";
      }),
  );

  server.registerTool(
    "select-preset",
    {
      description:
        "Select a preset by id — a server-listed one, or one of your own. Overrides your base colour until cleared. Applies only to you.",
      inputSchema: z.object({
        source: z.enum(["server", "personal"]),
        id: z.string(),
      }),
    },
    async ({ source, id }) =>
      reply(async () => {
        await service.setAppearance({ selectedPreset: { source, id } });
        return "Preset selected";
      }),
  );

  server.registerTool(
    "clear-preset-selection",
    {
      description:
        "Clear your selected preset. Your base colour governs again.",
      inputSchema: z.object({}),
    },
    async () =>
      reply(async () => {
        await service.setAppearance({ selectedPreset: null });
        return "Preset selection cleared";
      }),
  );

  return server;
}
