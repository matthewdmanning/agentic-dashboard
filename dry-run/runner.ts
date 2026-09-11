import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_PATH = path.join(import.meta.dirname, "config.json");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type DryRunConfig = {
  readonly fixtureDirectory: string;
  readonly workingDirectory: string;
  readonly workingFolderPrefix: string;
  readonly activeRunFile: string;
  readonly commands: Readonly<Record<string, string>>;
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly startupTimeout: number;
    readonly pollInterval: number;
  };
  readonly supportingFiles: readonly {
    readonly source: string;
    readonly target: string;
  }[];
  readonly defaults: {
    readonly componentsConfig: string;
    readonly themeStylesheet: string;
    readonly registry: string;
  };
};

type ActiveRun = { readonly workspace: string };

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as DryRunConfig;
const mode = process.argv[2] ?? "dashboard";

function activeRunPath(): string {
  return path.join(REPO_ROOT, config.workingDirectory, config.activeRunFile);
}

function createWorkspace(): string {
  const workingDirectory = path.resolve(REPO_ROOT, config.workingDirectory);
  mkdirSync(workingDirectory, { recursive: true });
  const workspace = mkdtempSync(
    path.join(workingDirectory, config.workingFolderPrefix),
  );
  cpSync(path.resolve(REPO_ROOT, config.fixtureDirectory), workspace, {
    recursive: true,
  });
  for (const file of config.supportingFiles) {
    const destination = path.join(workspace, file.target);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.resolve(REPO_ROOT, file.source), destination);
  }
  writeFileSync(activeRunPath(), `${JSON.stringify({ workspace })}\n`, "utf8");
  return workspace;
}

function existingWorkspace(): string | undefined {
  try {
    const { workspace } = JSON.parse(
      readFileSync(activeRunPath(), "utf8"),
    ) as ActiveRun;
    return existsSync(workspace) ? workspace : undefined;
  } catch {
    return undefined;
  }
}

function startServer(
  entry: string,
  workspace: string,
  stdio: "inherit" | ["ignore", "ignore", "ignore"],
) {
  return spawn(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, entry)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DASHBOARD_WORKSPACE: workspace,
      PORT: String(config.server.port),
    },
    stdio,
  });
}

async function waitForDashboard(): Promise<void> {
  const url = `http://${config.server.host}:${config.server.port}/api/dashboard`;
  const deadline = Date.now() + config.server.startupTimeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) =>
      setTimeout(resolve, config.server.pollInterval),
    );
  }
  throw new Error(`Dry-run dashboard did not start at ${url}.`);
}

async function dashboardIsReachable(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://${config.server.host}:${config.server.port}/api/dashboard`,
      { signal: AbortSignal.timeout(1000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function cleanup(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(activeRunPath(), { force: true });
}

async function run(): Promise<void> {
  const entry = config.commands[mode];
  if (!entry) throw new Error(`Unknown dry-run mode "${mode}".`);

  if (mode === "dashboard") {
    const workspace = createWorkspace();
    const child = startServer(entry, workspace, "inherit");
    const stop = () => child.kill();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("exit", () => cleanup(workspace));
    return;
  }

  let workspace = existingWorkspace();
  let dashboard = undefined;
  let ownsWorkspace = false;
  let ownsDashboard = false;
  if (!workspace) {
    workspace = createWorkspace();
    ownsWorkspace = true;
  }
  if (!(await dashboardIsReachable())) {
    dashboard = startServer(config.commands.dashboard, workspace, [
      "ignore",
      "ignore",
      "ignore",
    ]);
    ownsDashboard = true;
    await waitForDashboard();
  }

  const child = startServer(entry, workspace, "inherit");
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("exit", () => {
    if (ownsDashboard) {
      dashboard?.kill();
    }
    if (ownsWorkspace) {
      cleanup(workspace);
    }
  });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
