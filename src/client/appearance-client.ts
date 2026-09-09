import * as z from "zod/v4";

import {
  namedPresetSchema,
  type NamedPreset,
  type PartialUserAppearance,
  type UserAppearance,
} from "../contract";
import { authorized, failureFrom } from "./request";

/** A user's own appearance preference plus its derived stylesheet (D26, #94). */
export interface AppearanceView extends UserAppearance {
  css: string;
}

/** The caller's own appearance preference and its derived stylesheet (D26, D33-D35, #94). */
export async function loadAppearance(): Promise<AppearanceView> {
  const response = await fetch("/api/appearance", authorized());
  if (!response.ok) {
    throw await failureFrom(response, "Could not load appearance");
  }
  return (await response.json()) as AppearanceView;
}

/** Merges an update onto the caller's stored appearance (#95). Ungated — not a mutation, like `connectIntegration`. */
export async function setAppearance(
  update: PartialUserAppearance,
): Promise<AppearanceView> {
  const response = await fetch(
    "/api/appearance",
    authorized({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    }),
  );
  if (!response.ok) {
    throw await failureFrom(response, "Could not save appearance");
  }
  return (await response.json()) as AppearanceView;
}

/**
 * Reads a pasted token set as one of the caller's own presets (#96). A preset
 * is a complete set -- both token blocks, a radius, a theme mapping, and the
 * base rules -- so this validates against the same `namedPresetSchema` the
 * service and the MCP tool accept, and reports what is missing rather than
 * letting a partial set reach the store and be rejected there.
 */
export function parsePersonalPreset(id: string, tokenSet: string): NamedPreset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenSet);
  } catch {
    throw new Error("Preset is not valid JSON");
  }
  const result = namedPresetSchema.safeParse({ id, preset: parsed });
  if (!result.success) {
    throw new Error(`Not a complete preset: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** The caller's own preset list with `preset` added, or replacing the entry that already had its id (#96) -- the same upsert `add-personal-preset` performs. */
export function withPersonalPreset(
  presets: readonly NamedPreset[],
  preset: NamedPreset,
): NamedPreset[] {
  return [...presets.filter(({ id }) => id !== preset.id), preset];
}
