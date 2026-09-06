import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { activeCardTemplateManifest } from "../card-templates/manifest";

/**
 * Serves this dashboard's card templates (D22) as a shadcn-compatible
 * registry (https://ui.shadcn.com/docs/registry/mcp): the index at
 * `/r/registry.json`, each template's built payload at `/r/<name>.json`.
 * The active manifest is the source of truth for which templates are real,
 * paired with their JSON Schema and client source file.
 */

const REGISTRY_NAME = "agentic-dashboard";
const REGISTRY_HOMEPAGE =
  "https://github.com/matthewdmanning/agentic-dashboard";
const cardTemplatesDir = join(process.cwd(), "src", "client", "cards");

const SHADCN_UI_IMPORT_PATTERN = /@\/components\/ui\/([a-z-]+)/g;
const REACT_ARIA_COMPONENTS_IMPORT_PATTERN = /["']react-aria-components["']/;

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

async function readTemplateSource(templateName: string): Promise<string> {
  return readFile(
    join(cardTemplatesDir, activeCardTemplateManifest[templateName].sourceFile),
    "utf8",
  );
}

/**
 * Bare names in `registryDependencies` mean official shadcn items, matching
 * how card templates import them (`@/components/ui/<name>`) — no manual
 * per-template dependency bookkeeping to fall out of sync with the source.
 */
function deriveDependencies(source: string): {
  dependencies: string[];
  registryDependencies: string[];
} {
  const dependencies = REACT_ARIA_COMPONENTS_IMPORT_PATTERN.test(source)
    ? ["react-aria-components"]
    : [];
  const registryDependencies = [
    ...new Set(
      [...source.matchAll(SHADCN_UI_IMPORT_PATTERN)].map((match) => match[1]),
    ),
  ].sort();
  return { dependencies, registryDependencies };
}

async function buildRegistryItem(
  templateName: string,
  { includeContent }: { includeContent: boolean },
): Promise<RegistryItem> {
  const source = await readTemplateSource(templateName);
  const manifestEntry = activeCardTemplateManifest[templateName];
  const { dependencies, registryDependencies } = deriveDependencies(source);
  const path = `src/client/cards/${manifestEntry.sourceFile}`;
  return {
    name: templateName,
    type: "registry:block",
    title: templateName,
    files: [
      {
        path,
        type: "registry:block",
        target: path,
        ...(includeContent ? { content: source } : {}),
      },
    ],
    ...(dependencies.length ? { dependencies } : {}),
    ...(registryDependencies.length ? { registryDependencies } : {}),
  };
}

async function buildRegistryIndex() {
  const items = await Promise.all(
    Object.keys(activeCardTemplateManifest).map((name) =>
      buildRegistryItem(name, { includeContent: false }),
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
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/r/registry.json" || pathname === "/r/registry") {
    return Response.json(await buildRegistryIndex());
  }

  const match = ITEM_PATH_PATTERN.exec(pathname);
  if (match) {
    const [, name] = match;
    if (!(name in activeCardTemplateManifest)) {
      return Response.json({ message: "Item not found" }, { status: 404 });
    }
    return Response.json(
      await buildRegistryItem(name, { includeContent: true }),
    );
  }

  return Response.json({ message: "Not found" }, { status: 404 });
}
