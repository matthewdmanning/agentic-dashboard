import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { defaultDashboardConfiguration } from "../contract";
import { serializableCardTemplateManifest } from "../card-templates/manifest";
import { createFilePersistence } from "../service";

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
  const credentialsPath =
    process.env.DASHBOARD_INTEGRATION_CREDENTIALS_PATH ??
    join(workspace, ".dashboard", "integration-credentials.json");
  const componentsPath =
    process.env.DASHBOARD_COMPONENTS_PATH ?? join(workspace, "components.json");
  const manifestPath =
    process.env.DASHBOARD_TEMPLATE_MANIFEST_PATH ??
    join(workspace, ".dashboard", "card-templates", "manifest.json");
  const clientBuildPath =
    process.env.DASHBOARD_CLIENT_BUILD_PATH ??
    join(workspace, ".dashboard", "card-templates", "client-build.json");

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

  await writeIfAbsent(credentialsPath, "{}\n");
  console.log(`Initialized credential store: ${credentialsPath}`);

  const projectComponents = await readFile(
    join(process.cwd(), "components.json"),
    "utf8",
  );
  await writeIfAbsent(componentsPath, projectComponents);
  console.log(`Initialized shadcn configuration: ${componentsPath}`);

  const manifest = serializableCardTemplateManifest();
  await writeIfAbsent(manifestPath, `${JSON.stringify(manifest, null, 2)}
`);
  await writeIfAbsent(
    clientBuildPath,
    `${JSON.stringify(
      {
        templates: Object.values(manifest).map(({ name, sourceFile }) => ({
          name,
          sourceFile: `src/client/cards/${sourceFile}`,
        })),
      },
      null,
      2,
    )}
`,
  );
  console.log(`Initialized card-template manifest: ${manifestPath}`);
}

main();
