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

  return workspace;
}
