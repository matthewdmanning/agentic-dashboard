import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import {
  applyMutations,
  readDashboard,
  writeDashboard,
} from "../dashboard/store";
import { MutationError } from "../dashboard/types";
import { INSTRUCTIONS } from "./instructions";
import {
  dashboardCategorySchema,
  dashboardSchema,
  mutationFailureSchema,
  mutationSchema,
  tileReferenceSchema,
  tileSchema,
} from "./schemas";

const ALL_CATEGORIES = ["tiles", "references"] as const;

const server = new McpServer(
  { name: "agentic-dashboard", version: "0.0.0" },
  { instructions: INSTRUCTIONS },
);

server.registerTool(
  "read-dashboard",
  {
    title: "Read dashboard",
    description:
      "Reads the dashboard's current tiles and/or references (placement: order and size). " +
      'Pass "scope" to read only some categories; omit it to read everything. ' +
      "The result always names which categories it carries and which were withheld, " +
      "so a category missing from the result is never ambiguous with an empty one.",
    inputSchema: z.object({
      scope: z
        .array(dashboardCategorySchema)
        .optional()
        .describe(
          'Categories to read: "tiles", "references", or both. Omit for both.',
        ),
    }),
    outputSchema: z.object({
      carried: z
        .array(dashboardCategorySchema)
        .describe("Categories included in this result."),
      withheld: z
        .array(dashboardCategorySchema)
        .describe("Categories denied to this caller (always empty for now)."),
      tiles: z.array(tileSchema).optional(),
      references: z.array(tileReferenceSchema).optional(),
    }),
  },
  async ({ scope }) => {
    const dashboard = await readDashboard();
    const carried = scope && scope.length > 0 ? scope : ALL_CATEGORIES;
    const result = {
      carried,
      // No roles or permissions exist yet, so nothing is ever actually withheld.
      withheld: [] as (typeof ALL_CATEGORIES)[number][],
      ...(carried.includes("tiles") ? { tiles: dashboard.tiles } : {}),
      ...(carried.includes("references")
        ? { references: dashboard.references }
        : {}),
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
);

server.registerTool(
  "apply",
  {
    title: "Apply mutations",
    description:
      "Applies one or more mutations to the dashboard atomically and persists the result. " +
      'Reports "status": "applied" when the change is live now, or "queued" when it will replay later — ' +
      "never leave a caller to infer which. " +
      "If any mutation fails, none are applied; the failure is reported by the interface's own name " +
      '("unknown-tile", "duplicate-tile", "unknown-item", or "invalid-state"), never as prose to pattern-match.',
    inputSchema: z.object({
      mutations: z
        .array(mutationSchema)
        .min(1)
        .describe(
          "One or more mutations, applied in order, atomically: all succeed or none are persisted.",
        ),
    }),
    outputSchema: z.discriminatedUnion("status", [
      z.object({
        status: z.literal("applied"),
        dashboard: dashboardSchema,
      }),
      z.object({
        status: z.literal("queued"),
        dashboard: dashboardSchema,
      }),
      z.object({
        status: z.literal("error"),
        failure: mutationFailureSchema,
        message: z.string(),
      }),
    ]),
  },
  async ({ mutations }) => {
    const current = await readDashboard();
    try {
      const dashboard = applyMutations(current, mutations);
      await writeDashboard(dashboard);
      // There is no offline queue yet, so this is always "applied" — reported
      // explicitly rather than left for the caller to assume.
      const result = { status: "applied" as const, dashboard };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      if (error instanceof MutationError) {
        const result = {
          status: "error" as const,
          failure: error.failure,
          message: error.message,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
          isError: true,
        };
      }
      throw error;
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
