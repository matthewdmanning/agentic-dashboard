import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  activeCardTemplateManifest,
  type PromotedCardTemplateManifestEntry,
} from "./manifest";

/**
 * Node-only reads of the promoted generation (D24, D39) — kept out of
 * `manifest.ts` itself, since that module is also imported by the client
 * bundle (`src/client/cards/index.ts`), which cannot see `node:fs`.
 */

/** Where a workspace's promoted card-template manifest lives absent an override — the same default `init-dashboard.ts` and `server/index.ts` use. */
export function defaultCardTemplateManifestPath(
  workspace = process.cwd(),
): string {
  return join(workspace, ".dashboard", "card-templates", "manifest.json");
}

/** Where a workspace's promoted client build lives absent an override — pairs with `defaultCardTemplateManifestPath`. */
export function defaultCardTemplateClientBuildPath(
  workspace = process.cwd(),
): string {
  return join(workspace, ".dashboard", "card-templates", "client-build.json");
}

/**
 * The active generation (D24, D39): the manifest a build already promoted to
 * `manifestPath`, falling back to the compiled default when none has been
 * promoted yet — a fresh workspace before `init-dashboard` has run, or a test
 * that registers its own fixtures on the compiled object directly.
 */
export async function readActiveCardTemplateManifest(
  manifestPath: string,
): Promise<Record<string, PromotedCardTemplateManifestEntry>> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      PromotedCardTemplateManifestEntry
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return activeCardTemplateManifest;
  }
}
