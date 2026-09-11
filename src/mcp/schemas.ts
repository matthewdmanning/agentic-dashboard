import { z } from "zod";

import type { Mutation } from "../dashboard/types";

/**
 * Placement width. The dashboard grid is four columns wide: two "md" tiles
 * fill one row, one "lg" tile fills a row alone, "sm" is a quarter-row.
 */
export const tileSizeSchema = z.enum(["sm", "md", "lg"]);

export const tileSchema = z.object({
  id: z
    .string()
    .describe("Stable identifier for this tile, unique within the dashboard."),
  title: z.string().describe("Human-readable title shown on the tile."),
  item: z
    .string()
    .describe(
      "Name of the registry item that renders this tile (the name shown by `shadcn search @dashboard`, without the `@dashboard/` prefix).",
    ),
  state: z
    .record(z.string(), z.unknown())
    .describe(
      "Data the tile's registry item renders. Must include every key in that item's `meta.schema.required` (read via `shadcn view @dashboard/<item>`).",
    ),
});

export const tileReferenceSchema = z.object({
  tileId: z.string(),
  size: tileSizeSchema,
});

export const dashboardSchema = z.object({
  tiles: z.array(tileSchema),
  references: z.array(tileReferenceSchema),
});

/** The two categories a read can carry. Mirrors the fields on `Dashboard`. */
export const dashboardCategorySchema = z.enum(["tiles", "references"]);

/** The interface's own names for a mutation failure — never a message to pattern-match. */
export const mutationFailureSchema = z.enum([
  "unknown-tile",
  "duplicate-tile",
  "unknown-item",
  "invalid-state",
]);

/** Mirrors the `Mutation` union in `src/dashboard/types.ts`. Keep the two in sync by hand. */
export const mutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add-tile"),
    tile: tileSchema,
    size: tileSizeSchema
      .optional()
      .describe(
        'Placement width for the new tile. Defaults to "md" if omitted.',
      ),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Position in the dashboard's tile order. Defaults to the end if omitted.",
      ),
  }),
  z.object({
    type: z.literal("remove-tile"),
    tileId: z
      .string()
      .describe("Id of the tile to remove. Also removes its placement."),
  }),
  z.object({
    type: z.literal("set-tile-state"),
    tileId: z.string(),
    state: z
      .record(z.string(), z.unknown())
      .describe(
        "Full replacement state for the tile, matching its registry item's `meta.schema`.",
      ),
  }),
  z.object({
    type: z.literal("set-tile-title"),
    tileId: z.string(),
    title: z.string(),
  }),
  z.object({
    type: z.literal("place-tile"),
    tileId: z
      .string()
      .describe("Id of an existing tile to reposition and/or resize."),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("New position in the dashboard's tile order."),
    size: tileSizeSchema.optional().describe("New placement width."),
  }),
]);

/**
 * The zod mirror above and the `Mutation` union it mirrors must stay the same
 * shape. This makes drift between them a type error rather than a review catch.
 */
type MutationMirror = z.infer<typeof mutationSchema>;
const _mutationsAgree: MutationMirror extends Mutation
  ? Mutation extends MutationMirror
    ? true
    : never
  : never = true;
void _mutationsAgree;
