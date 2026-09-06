import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  cardSchema,
  compositionNodeSchema,
  dashboardSchema,
  integrationSchema,
  themeSchema,
  type Mutation,
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
      description: "Read the dashboard state allowed by the caller's role. Scope 'role' returns the caller's own permissions.",
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
    "set-font-scale",
    {
      description: "Set the dashboard font scale.",
      inputSchema: z.object({ fontScale: z.number().min(0.75).max(2) }),
    },
    async ({ fontScale }) =>
      apply({ type: "set-font-scale", fontScale }, "Font scale updated"),
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
      description: "Delete an integration not used by a card.",
      inputSchema: z.object({ integrationId: z.string() }),
    },
    async ({ integrationId }) =>
      apply(
        {
          type: "remove-integration",
          integrationId,
        },
        "Integration removed",
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

  return server;
}
