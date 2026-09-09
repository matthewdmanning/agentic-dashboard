import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { CompositionNode } from "../contract";

const UI_COMPONENTS_DIR = join(process.cwd(), "src", "components", "ui");

/**
 * Component export name -> the `@/components/ui/<file>` it lives in. Read
 * from the real installed components rather than hand-maintained, so adding
 * a shadcn component makes it usable in a composition with no codegen
 * change. Async so a live `assemble-card-template` call never blocks the
 * event loop on this.
 *
 * Re-read on every call rather than cached for the process lifetime: the
 * directory has ~11 small files, so re-reading costs little, while a cache
 * would go stale and silently emit wrong imports once #104 lets `shadcn add`
 * write into `src/components/ui` against a running server. Not exported —
 * `service` has no business knowing codegen resolves this from disk.
 */
async function componentSourceFiles(): Promise<Record<string, string>> {
  let entries: string[];
  try {
    entries = await readdir(UI_COMPONENTS_DIR);
  } catch (error) {
    throw new Error(
      `Could not read component library directory "${UI_COMPONENTS_DIR}" to resolve card-template imports: ${(error as Error).message}`,
    );
  }

  const tsxEntries = entries.filter((entry) => entry.endsWith(".tsx"));
  const sources = await Promise.all(
    tsxEntries.map((entry) => readFile(join(UI_COMPONENTS_DIR, entry), "utf8")),
  );

  const map: Record<string, string> = {};
  for (const [index, entry] of tsxEntries.entries()) {
    const file = basename(entry, ".tsx");
    const exportBlock = /export\s*{([^}]*)}/.exec(sources[index]);
    if (!exportBlock) continue;
    for (const name of exportBlock[1].split(",").map((part) => part.trim())) {
      if (!name) continue;
      map[name.split(/\s+as\s+/).pop()!] = file;
    }
  }
  return map;
}

/** A component name that maps to no known export guesses a file name so `tsc` — not this module — is what reports it as unresolvable. */
function guessFile(componentName: string): string {
  return componentName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Composition tree in, TSX source text out. Its only IO is reading which
 * components `src/components/ui` currently exports (async, so this never
 * blocks the event loop); it does not validate that `component`/`props` name
 * real exports — `tsc` is the truth for that (D22). Same tree always
 * produces the same string.
 */
export async function generateComponentSource(
  root: CompositionNode,
  componentName = "GeneratedCardTemplate",
): Promise<string> {
  const usedComponents = new Set<string>();
  collectComponents(root, usedComponents);
  const knownFiles = await componentSourceFiles();

  const byFile = new Map<string, Set<string>>();
  for (const name of usedComponents) {
    const file = knownFiles[name] ?? guessFile(name);
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file)!.add(name);
  }

  const imports = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([file, names]) =>
        `import { ${[...names].sort().join(", ")} } from "@/components/ui/${file}";`,
    )
    .join("\n");

  return `${imports}

export function ${componentName}() {
  return (
${renderNode(root, 4)}
  );
}
`;
}

function collectComponents(node: CompositionNode, into: Set<string>): void {
  into.add(node.component);
  for (const child of node.children) collectComponents(child, into);
}

function renderNode(node: CompositionNode, indent: number): string {
  const pad = " ".repeat(indent);
  const props = renderProps(node.props);
  const attrs = props ? ` ${props}` : "";

  if (node.children.length === 0) {
    return `${pad}<${node.component}${attrs} />`;
  }

  const children = node.children
    .map((child) => renderNode(child, indent + 2))
    .join("\n");
  return `${pad}<${node.component}${attrs}>\n${children}\n${pad}</${node.component}>`;
}

function renderProps(props: Record<string, unknown>): string {
  return Object.keys(props)
    .sort()
    .map((key) => renderProp(key, props[key]))
    .join(" ");
}

function renderProp(key: string, value: unknown): string {
  if (typeof value === "string") return `${key}=${JSON.stringify(value)}`;
  return `${key}={${JSON.stringify(value)}}`;
}
