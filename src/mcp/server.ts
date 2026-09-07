import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  baseColourSchema,
  cardSchema,
  compositionNodeSchema,
  dashboardSchema,
  integrationSchema,
  menuAccentSchema,
  menuColourSchema,
  namedPresetSchema,
  themeSchema,
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

  server.registerTool(
    "add-card",
    {
      description: "Add a new card.",
      inputSchema: z.object({ card: cardSchema }),
    },
    async ({ card }) => apply({ type: "add-card", card }, "Card added"),
  );
  server.registerTool(
    "edit-card",
    {
      description: "Replace an existing card.",
      inputSchema: z.object({ card: cardSchema }),
    },
    async ({ card }) => apply({ type: "edit-card", card }, "Card edited"),
  );
  server.registerTool(
    "remove-card",
    {
      description: "Delete a card.",
      inputSchema: z.object({ cardId: z.string() }),
    },
    async ({ cardId }) =>
      apply({ type: "remove-card", cardId }, "Card removed"),
  );

  server.registerTool(
    "patch-card-state",
    {
      description: "Patch the state displayed by an existing card.",
      inputSchema: z.object({
        cardId: z.string(),
        patch: z.record(z.string(), z.unknown()),
      }),
    },
    async ({ cardId, patch }) =>
      apply({ type: "patch-card-state", cardId, patch }, "Card state updated"),
  );

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
    "assemble-card-template",
    {
      description:
        "Assemble a complete card template from a name, a mandatory JSON Schema, and a declarative composition tree of shadcn/ui components.",
      inputSchema: z.object({
        template: z.string().min(1),
        jsonSchema: z.record(z.string(), z.unknown()),
        composition: compositionNodeSchema,
      }),
    },
    async ({ template, jsonSchema, composition }) =>
      apply(
        { type: "assemble-card-template", template, jsonSchema, composition },
        "Card template assembled",
      ),
  );

  server.registerTool(
    "edit-dashboard",
    {
      description: "Replace the dashboard document.",
      inputSchema: z.object({ dashboard: dashboardSchema }),
    },
    async ({ dashboard }) =>
      apply({ type: "edit-dashboard", dashboard }, "Dashboard updated"),
  );

  server.registerTool(
    "add-theme",
    {
      description: "Add a theme.",
      inputSchema: z.object({ theme: themeSchema }),
    },
    async ({ theme }) => apply({ type: "add-theme", theme }, "Theme added"),
  );

  server.registerTool(
    "edit-theme",
    {
      description: "Replace an existing theme.",
      inputSchema: z.object({ theme: themeSchema }),
    },
    async ({ theme }) => apply({ type: "edit-theme", theme }, "Theme edited"),
  );

  server.registerTool(
    "remove-theme",
    {
      description: "Delete an unused theme.",
      inputSchema: z.object({ themeId: z.string() }),
    },
    async ({ themeId }) =>
      apply({ type: "remove-theme", themeId }, "Theme removed"),
  );

  server.registerTool(
    "add-preset",
    {
      description:
        "Add a server-listed preset (a complete token set: theme mapping, light and dark blocks, radius, base rules) visible to every user.",
      inputSchema: z.object({ preset: namedPresetSchema }),
    },
    async ({ preset }) => apply({ type: "add-preset", preset }, "Preset added"),
  );

  server.registerTool(
    "remove-preset",
    {
      description:
        "Delete a server-listed preset. Any user who had it selected falls back to their base colour.",
      inputSchema: z.object({ presetId: z.string() }),
    },
    async ({ presetId }) =>
      apply({ type: "remove-preset", presetId }, "Preset removed"),
  );

  server.registerTool(
    "add-integration",
    {
      description: "Add an integration.",
      inputSchema: z.object({ integration: integrationSchema }),
    },
    async ({ integration }) =>
      apply({ type: "add-integration", integration }, "Integration added"),
  );

  server.registerTool(
    "edit-integration",
    {
      description: "Replace an existing integration.",
      inputSchema: z.object({ integration: integrationSchema }),
    },
    async ({ integration }) =>
      apply({ type: "edit-integration", integration }, "Integration edited"),
  );

  server.registerTool(
    "remove-integration",
    {
      description:
        "Delete an integration. Fails naming aggregate connection and query counts if anything depends on it -- pass override to remove it anyway. Removing destroys its connections; queries stay stored but become unavailable.",
      inputSchema: z.object({
        integrationId: z.string(),
        override: z.boolean().optional(),
      }),
    },
    async ({ integrationId, override }) =>
      apply(
        {
          type: "remove-integration",
          integrationId,
          override,
        },
        "Integration removed",
      ),
  );

  server.registerTool(
    "block-integration",
    {
      description:
        "Suspend an integration: rejects new connections and query refreshes, but keeps every connection and query stored.",
      inputSchema: z.object({ integrationId: z.string() }),
    },
    async ({ integrationId }) =>
      apply(
        { type: "block-integration", integrationId },
        "Integration blocked",
      ),
  );

  server.registerTool(
    "unblock-integration",
    {
      description:
        "Restore a blocked integration to normal connection and refresh behavior. No reauthorization is needed.",
      inputSchema: z.object({ integrationId: z.string() }),
    },
    async ({ integrationId }) =>
      apply(
        { type: "unblock-integration", integrationId },
        "Integration unblocked",
      ),
  );

  server.registerTool(
    "set-integration-retention-policy",
    {
      description:
        "Set how many days an unused dynamic integration is kept before it is automatically removed. Never applies to a default or recommended integration.",
      inputSchema: z.object({ retentionDays: z.number().int().positive() }),
    },
    async ({ retentionDays }) =>
      apply(
        { type: "set-integration-retention-policy", retentionDays },
        "Retention policy updated",
      ),
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
