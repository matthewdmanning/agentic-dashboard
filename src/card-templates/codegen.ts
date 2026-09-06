import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { CompositionNode } from "../contract";

const UI_COMPONENTS_DIR = join(process.cwd(), "src", "components", "ui");

/**
 * Component export name -> the `@/components/ui/<file>` it lives in. Read
 * from the real installed components rather than hand-maintained, so adding
 * a shadcn component makes it usable in a composition with no codegen change.
 */
function componentSourceFiles(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of readdirSync(UI_COMPONENTS_DIR)) {
    if (!entry.endsWith(".tsx")) continue;
    const file = basename(entry, ".tsx");
    const source = readFileSync(join(UI_COMPONENTS_DIR, entry), "utf8");
    const exportBlock = /export\s*{([^}]*)}/.exec(source);
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
 * Pure: composition tree in, TSX source text out. No IO beyond reading which
 * components `src/components/ui` currently exports. Does not validate that
 * `component`/`props` name real exports — `tsc` is the truth for that (D22).
 * Same tree always produces the same string.
 */
export function generateComponentSource(
  root: CompositionNode,
  componentName = "GeneratedCardTemplate",
): string {
  const usedComponents = new Set<string>();
  collectComponents(root, usedComponents);
  const knownFiles = componentSourceFiles();

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
