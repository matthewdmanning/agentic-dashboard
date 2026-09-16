import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const APP_ROOT = path.resolve(import.meta.dirname, "..");

export function workspaceDirectory(): string {
  const configured = process.env.DASHBOARD_WORKSPACE;
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("DASHBOARD_WORKSPACE must be an absolute path");
  }
  // Local development keeps its old default. Installed deployments set the
  // absolute path to a separate, writable directory.
  return configured ?? path.join(APP_ROOT, ".dashboard");
}

export function dashboardOrigin(): string {
  return (
    process.env.DASHBOARD_ORIGIN ??
    `http://localhost:${process.env.PORT ?? 5173}`
  ).replace(/\/$/, "");
}

function assertInsideWorkspace(
  workspace: string,
  relativePath: string,
  what: string,
): void {
  const resolved = path.resolve(workspace, relativePath);
  const boundary = workspace.endsWith(path.sep)
    ? workspace
    : `${workspace}${path.sep}`;
  if (resolved !== workspace && !resolved.startsWith(boundary)) {
    throw new Error(
      `${what} "${relativePath}" resolves outside the workspace (${workspace})`,
    );
  }
}

/**
 * Rejects a `components.json` or `registry.json` that points outside the
 * workspace. OS filesystem permissions are the real enforcement boundary
 * (agents never get write access to the app installation); this catches a
 * misconfigured or malicious registry item before anything reads or writes
 * through it.
 */
export function validateWorkspaceConfig(workspace: string): void {
  const componentsPath = path.join(workspace, "components.json");
  if (existsSync(componentsPath)) {
    const components = JSON.parse(readFileSync(componentsPath, "utf8")) as {
      tailwind?: { css?: string };
      aliases?: Record<string, string>;
    };
    if (components.tailwind?.css) {
      assertInsideWorkspace(
        workspace,
        components.tailwind.css,
        "components.json tailwind.css",
      );
    }
    for (const [name, alias] of Object.entries(components.aliases ?? {})) {
      // Aliases are "@/..." import specifiers resolved against baseUrl via
      // tsconfig.json's "@/*": ["./*"] mapping — the filesystem path is
      // whatever follows the "@/" prefix (or the whole value, for an alias
      // that was never namespaced that way in the first place).
      const relative = alias.replace(/^@\//, "");
      assertInsideWorkspace(
        workspace,
        relative,
        `components.json aliases.${name}`,
      );
    }
  }

  const registryPath = path.join(workspace, "registry.json");
  if (existsSync(registryPath)) {
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
      items?: readonly {
        name: string;
        files?: readonly { path: string }[];
      }[];
    };
    for (const item of registry.items ?? []) {
      for (const file of item.files ?? []) {
        assertInsideWorkspace(
          workspace,
          file.path,
          `registry item "${item.name}" file`,
        );
      }
    }
  }
}

/** Copy starter assets only when absent; existing workspace work is never reset. */
export function seedWorkspace(): string {
  const workspace = workspaceDirectory();
  mkdirSync(workspace, { recursive: true });

  for (const [source, target] of [
    ["components", "components"],
    ["registry", "registry"],
    ["registry.json", "registry.json"],
    ["src/lib", "lib"],
    ["src/hooks", "hooks"],
  ]) {
    cpSync(path.join(APP_ROOT, source), path.join(workspace, target), {
      recursive: true,
      force: false,
      errorOnExist: false,
      // The registry's own test suite belongs to this repo, not the
      // starter tiles copied into a deployed workspace.
      filter: (src) => !src.endsWith(".test.ts"),
    });
  }

  const styles = path.join(workspace, "styles.css");
  if (!existsSync(styles)) {
    writeFileSync(
      styles,
      `${readFileSync(path.join(APP_ROOT, "src/index.css"), "utf8")}\n@source "./components";\n@source "./registry";\n`,
    );
  }

  const componentsConfig = path.join(workspace, "components.json");
  if (!existsSync(componentsConfig)) {
    const config = JSON.parse(
      readFileSync(path.join(APP_ROOT, "components.json"), "utf8"),
    ) as Record<string, unknown>;
    config.tailwind = { ...(config.tailwind as object), css: "styles.css" };
    config.aliases = {
      components: "@/components",
      ui: "@/components/ui",
      utils: "@/lib/utils",
      lib: "@/lib",
      hooks: "@/hooks",
      blocks: "@/registry",
    };
    config.registries = {
      ...(config.registries as object),
      "@dashboard": `${dashboardOrigin()}/r/{name}.json`,
    };
    writeFileSync(componentsConfig, `${JSON.stringify(config, null, 2)}\n`);
  }

  const tsconfig = path.join(workspace, "tsconfig.json");
  if (!existsSync(tsconfig)) {
    writeFileSync(
      tsconfig,
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { "@/*": ["./*"], "@components/*": ["./components/*"] },
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["registry", "components", "lib", "hooks"],
        },
        null,
        2,
      )}\n`,
    );
  }

  const packageJson = path.join(workspace, "package.json");
  if (!existsSync(packageJson)) {
    writeFileSync(
      packageJson,
      `${JSON.stringify({ name: "dashboard-tiles", private: true, type: "module" }, null, 2)}\n`,
    );
  }

  validateWorkspaceConfig(workspace);
  return workspace;
}
