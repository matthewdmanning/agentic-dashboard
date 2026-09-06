import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { defaultDashboardConfiguration } from "../contract";
import { activeCardTemplateManifest } from "../card-templates/manifest";
import {
  defaultCardTemplateClientBuildPath,
  defaultCardTemplateManifestPath,
} from "../card-templates/active-manifest";
import { promoteCardTemplates } from "../card-templates/build";
import { createFilePersistence } from "../service";
import { createFileIntegrationCatalog } from "../server/integrations/catalog";

async function writeIfAbsent(path: string, contents: string): Promise<void> {
  if (
    await access(path)
      .then(() => true)
      .catch(() => false)
  ) {
    console.error(`Already initialized: ${path}`);
    process.exit(1);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function main() {
  const workspace = resolve(process.env.DASHBOARD_WORKSPACE ?? ".");
  const dashboardPath =
    process.env.DASHBOARD_DATA_PATH ??
    join(workspace, ".dashboard", "dashboard.json");
  const authStorePath =
    process.env.DASHBOARD_AUTH_STORE_PATH ??
    join(workspace, ".dashboard", "accounts.json");
  const connectionsPath =
    process.env.DASHBOARD_CONNECTIONS_PATH ??
    join(workspace, ".dashboard", "connections.json");
  const catalogPath =
    process.env.DASHBOARD_INTEGRATION_CATALOG_PATH ??
    join(workspace, ".dashboard", "integrations.json");
  const componentsPath =
    process.env.DASHBOARD_COMPONENTS_PATH ?? join(workspace, "components.json");
  const manifestPath =
    process.env.DASHBOARD_TEMPLATE_MANIFEST_PATH ??
    defaultCardTemplateManifestPath(workspace);
  const clientBuildPath =
    process.env.DASHBOARD_CLIENT_BUILD_PATH ??
    defaultCardTemplateClientBuildPath(workspace);

  if (
    await access(dashboardPath)
      .then(() => true)
      .catch(() => false)
  ) {
    console.error(`Already initialized: ${dashboardPath}`);
    process.exit(1);
  }
  await createFilePersistence(dashboardPath).write(
    defaultDashboardConfiguration,
  );
  console.log(`Initialized dashboard: ${dashboardPath}`);

  await writeIfAbsent(authStorePath, "[]\n");
  console.log(`Initialized auth store: ${authStorePath}`);

  await writeIfAbsent(connectionsPath, "[]\n");
  console.log(`Initialized connection store: ${connectionsPath}`);

  await createFileIntegrationCatalog(catalogPath).read();
  console.log(`Initialized integration catalog: ${catalogPath}`);

  const projectComponents = await readFile(
    join(process.cwd(), "components.json"),
    "utf8",
  );
  await writeIfAbsent(componentsPath, projectComponents);
  console.log(`Initialized shadcn configuration: ${componentsPath}`);

  if (
    await access(manifestPath)
      .then(() => true)
      .catch(() => false)
  ) {
    console.error(`Already initialized: ${manifestPath}`);
    process.exit(1);
  }
  const candidates = await Promise.all(
    Object.values(activeCardTemplateManifest).map(async (entry) => {
      const clientSourcePath = `src/client/cards/${entry.sourceFile}`;
      return {
        name: entry.name,
        title: entry.title,
        sourceFile: entry.sourceFile,
        clientSourcePath,
        source: await readFile(join(process.cwd(), clientSourcePath), "utf8"),
        jsonSchema: entry.jsonSchema,
      };
    }),
  );
  const result = await promoteCardTemplates(candidates, {
    manifestPath,
    clientBuildPath,
  });
  if (!result.ok) {
    console.error(
      `Failed to build card templates (${result.stage}): ${result.message}`,
    );
    process.exit(1);
  }
  console.log(`Initialized card-template manifest: ${manifestPath}`);
}

main();
