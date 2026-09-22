import { appendFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { resolveAccount } from "../auth/whitelist";
import {
  applyMutations,
  readDashboard,
  readItemSchemas,
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

/**
 * Opt-in only (unset `MCP_LOG_FILE` is a no-op): a trial run sets this to
 * the tier's workspace so every prompt's MCP calls append to one file.
 * Never writes to stdout — that channel is the stdio transport itself.
 */
const logFile = process.env.MCP_LOG_FILE;
function logCall(
  tool: string,
  input: unknown,
  result: unknown,
  startedAt: number,
): void {
  if (!logFile) return;
  appendFileSync(
    logFile,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      input,
      result,
      ms: Date.now() - startedAt,
    })}\n`,
  );
}

const server = new McpServer(
  { name: "agentic-dashboard", version: "0.0.0" },
  { instructions: INSTRUCTIONS },
);

/**
 * Stdio: one process per client, so the credential is read from the
 * environment and resolved exactly once, then reused for every tool call
 * this process ever makes — there is no per-call header to re-resolve from.
 */
const account = resolveAccount(process.env.DASHBOARD_CREDENTIAL);

const UNAUTHENTICATED_MESSAGE =
  "No credential presented, or the presented credential is not on the whitelist.";

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
    const startedAt = Date.now();
    if (!account) {
      logCall("read-dashboard", { scope }, { status: "error" }, startedAt);
      return {
        content: [{ type: "text" as const, text: UNAUTHENTICATED_MESSAGE }],
        isError: true,
      };
    }
    const dashboard = await readDashboard();
    const carried = scope && scope.length > 0 ? scope : ALL_CATEGORIES;
    const result = {
      carried,
      withheld: [] as (typeof ALL_CATEGORIES)[number][],
      ...(carried.includes("tiles") ? { tiles: dashboard.tiles } : {}),
      ...(carried.includes("references")
        ? { references: dashboard.references }
        : {}),
    };
    logCall("read-dashboard", { scope }, result, startedAt);
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
      'Reports "status": "applied" when the change is live now, or "queued" when it is held to replay later. ' +
      'Today it is always "applied": queueing exists for mutations made while the server cannot reach ' +
      "something they depend on, and nothing the dashboard currently does can be offline, so no path " +
      'returns "queued" yet. Read the status rather than assuming either one — that is why it is reported. ' +
      "If any mutation fails, none are applied; the failure is reported by the interface's own name " +
      '("unknown-tile", "duplicate-tile", "unknown-item", "invalid-state", "unauthenticated", or "forbidden"), never as prose to pattern-match.',
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
    const startedAt = Date.now();
    try {
      if (!account) {
        throw new MutationError("unauthenticated", UNAUTHENTICATED_MESSAGE);
      }
      const [current, itemSchemas] = await Promise.all([
        readDashboard(),
        readItemSchemas(),
      ]);
      const dashboard = applyMutations(
        current,
        mutations,
        account,
        itemSchemas,
      );
      await writeDashboard(dashboard);
      // There is no offline queue yet, so this is always "applied" — reported
      // explicitly rather than left for the caller to assume.
      const result = { status: "applied" as const, dashboard };
      logCall("apply", { mutations }, result, startedAt);
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
        logCall("apply", { mutations }, result, startedAt);
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
