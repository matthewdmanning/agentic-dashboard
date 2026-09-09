import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PromotedCardTemplateManifestEntry } from "../card-templates/manifest";
import {
  defaultCardTemplateManifestPath,
  readActiveCardTemplateManifest,
} from "../card-templates/active-manifest";
import type { DashboardService } from "../service";
import { credentialFromRequest } from "./credential";

/**
 * Serves this dashboard's card templates (D22) as a shadcn-compatible
 * registry (https://ui.shadcn.com/docs/registry/mcp): the index at
 * `/r/registry.json`, each template's built payload at `/r/<name>.json`.
 * The active manifest (D24, D39) — the last build a promotion wrote to
 * `manifestPath` — is the source of truth for which templates are real,
 * paired with their JSON Schema and client source file.
 */

const REGISTRY_NAME = "agentic-dashboard";
const REGISTRY_HOMEPAGE =
  "https://github.com/matthewdmanning/agentic-dashboard";
const cardTemplatesDir = join(process.cwd(), "src", "client", "cards");

const SHADCN_UI_IMPORT_PATTERN = /@\/components\/ui\/([a-z-]+)/g;

interface RegistryFile {
  path: string;
  type: "registry:block";
  target: string;
  content?: string;
}

interface RegistryItem {
  name: string;
  type: "registry:block";
  title: string;
  files: RegistryFile[];
  dependencies?: string[];
  registryDependencies?: string[];
}

async function readTemplateSource(
  manifestEntry: PromotedCardTemplateManifestEntry,
): Promise<string> {
  return readFile(join(cardTemplatesDir, manifestEntry.sourceFile), "utf8");
}

/**
 * Bare names in `registryDependencies` mean official shadcn items, matching
 * how card templates import them (`@/components/ui/<name>`) — no manual
 * per-template dependency bookkeeping to fall out of sync with the source.
 */
function deriveDependencies(source: string): {
  registryDependencies: string[];
} {
  const registryDependencies = [
    ...new Set(
      [...source.matchAll(SHADCN_UI_IMPORT_PATTERN)].map((match) => match[1]),
    ),
  ].sort();
  return { registryDependencies };
}

async function buildRegistryItem(
  manifestEntry: PromotedCardTemplateManifestEntry,
  { includeContent }: { includeContent: boolean },
): Promise<RegistryItem> {
  const source = await readTemplateSource(manifestEntry);
  const { registryDependencies } = deriveDependencies(source);
  const path = `src/client/cards/${manifestEntry.sourceFile}`;
  return {
    name: manifestEntry.name,
    type: "registry:block",
    title: manifestEntry.title,
    files: [
      {
        path,
        type: "registry:block",
        target: path,
        ...(includeContent ? { content: source } : {}),
      },
    ],
    ...(registryDependencies.length ? { registryDependencies } : {}),
  };
}

async function buildRegistryIndex(
  manifest: Record<string, PromotedCardTemplateManifestEntry>,
) {
  const items = await Promise.all(
    Object.values(manifest).map((entry) =>
      buildRegistryItem(entry, { includeContent: false }),
    ),
  );
  return {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: REGISTRY_NAME,
    homepage: REGISTRY_HOMEPAGE,
    items,
  };
}

const ITEM_PATH_PATTERN = /^\/r\/([a-z][a-z0-9-]*)\.json$/;

export async function handleRegistryRequest(
  request: Request,
  options: { service: DashboardService; manifestPath?: string },
): Promise<Response> {
  // Same door as every `/api/*` route (D4): `cards: read` gates this file's
  // source disclosure too, checked once at `service.read`'s enforcement
  // point rather than a second check grown here. Denials propagate as a
  // thrown `ServiceFailure` for the caller to map to a status code.
  await options.service.read("cards", credentialFromRequest(request));

  const { pathname } = new URL(request.url);
  const manifest = await readActiveCardTemplateManifest(
    options.manifestPath ?? defaultCardTemplateManifestPath(),
  );

  if (pathname === "/r/registry.json" || pathname === "/r/registry") {
    return Response.json(await buildRegistryIndex(manifest));
  }

  const match = ITEM_PATH_PATTERN.exec(pathname);
  if (match) {
    const [, name] = match;
    const entry = manifest[name];
    if (!entry) {
      return Response.json({ message: "Item not found" }, { status: 404 });
    }
    return Response.json(
      await buildRegistryItem(entry, { includeContent: true }),
    );
  }

  return Response.json({ message: "Not found" }, { status: 404 });
}
