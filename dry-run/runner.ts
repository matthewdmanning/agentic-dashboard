import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  readonly excludeFromWorkspace: readonly string[];
  readonly commands: Readonly<Record<string, string>>;
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly startupTimeout: number;
    readonly pollInterval: number;
  };
};

type ActiveRun = { readonly workspace: string };

/**
 * What is answering the dry run's port. "foreign" covers both a non-dashboard
 * server and a dashboard serving somebody else's state: attaching to either
 * would send an agent's mutations somewhere other than the page a human is
 * watching, and neither is recoverable by guessing.
 */
type PortState =
  | { readonly kind: "free" }
  | { readonly kind: "dashboard"; readonly workspace: string }
  | { readonly kind: "foreign" };

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as DryRunConfig;
const mode = process.argv[2] ?? "dashboard";
// PORT wins over the config so a second run, or a run alongside `npm run dev`,
// needs no edit to a committed file.
const PORT = Number(process.env.PORT) || config.server.port;
const ORIGIN = `http://${config.server.host}:${PORT}`;
const WORKING_DIR = path.resolve(REPO_ROOT, config.workingDirectory);
const ACTIVE_RUN = path.join(WORKING_DIR, config.activeRunFile);

function createWorkspace(): string {
  mkdirSync(WORKING_DIR, { recursive: true });
  // Last run's folder is pruned here rather than deleted on exit, so a run's
  // final state survives for inspection and an attached MCP server never has
  // its workspace removed out from under it.
  for (const entry of readdirSync(WORKING_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(config.workingFolderPrefix))
      rmSync(path.join(WORKING_DIR, entry.name), {
        recursive: true,
        force: true,
      });
  }

  const workspace = mkdtempSync(
    path.join(WORKING_DIR, config.workingFolderPrefix),
  );
  cpSync(path.resolve(REPO_ROOT, config.fixtureDirectory), workspace, {
    recursive: true,
  });
  // Documentation, not dashboard state — the app would ignore it, but a copy
  // of it sitting in a workspace invites someone to treat it as one.
  for (const entry of config.excludeFromWorkspace)
    rmSync(path.join(workspace, entry), { force: true });
  writeFileSync(ACTIVE_RUN, `${JSON.stringify({ workspace })}\n`, "utf8");
  return workspace;
}

function existingWorkspace(): string | undefined {
  try {
    const { workspace } = JSON.parse(
      readFileSync(ACTIVE_RUN, "utf8"),
    ) as ActiveRun;
    return existsSync(workspace) ? workspace : undefined;
  } catch {
    return undefined;
  }
}

function startServer(
  entry: string,
  workspace: string,
  stdio: "inherit" | "ignore",
) {
  return spawn(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, entry)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DASHBOARD_WORKSPACE: workspace,
      PORT: String(PORT),
    },
    stdio,
  });
}

async function probePort(timeoutMs = 1000): Promise<PortState> {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}/api/workspace`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A timeout means something is listening and not answering; a refused
    // connection means nothing is there at all.
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return timedOut ? { kind: "foreign" } : { kind: "free" };
  }
  if (!response.ok) return { kind: "foreign" };
  try {
    const { workspace } = (await response.json()) as { workspace?: string };
    return workspace ? { kind: "dashboard", workspace } : { kind: "foreign" };
  } catch {
    // A dashboard answers this with JSON. Anything else on the port is not one.
    return { kind: "foreign" };
  }
}

const isDryRunWorkspace = (workspace: string): boolean =>
  path.resolve(workspace).startsWith(`${WORKING_DIR}${path.sep}`);

async function waitForDashboard(): Promise<string> {
  const deadline = Date.now() + config.server.startupTimeout;
  while (Date.now() < deadline) {
    const state = await probePort();
    if (state.kind === "dashboard") return state.workspace;
    await new Promise((resolve) =>
      setTimeout(resolve, config.server.pollInterval),
    );
  }
  throw new Error(`Dry-run dashboard did not start at ${ORIGIN}.`);
}

function forwardSignals(child: ReturnType<typeof spawn>): void {
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const portTaken = (state: PortState): string =>
  state.kind === "dashboard"
    ? `A dashboard is already serving ${ORIGIN} from ${state.workspace}.`
    : `Something other than a dashboard is already serving ${ORIGIN}.`;

async function runDashboard(): Promise<void> {
  const state = await probePort();
  if (state.kind !== "free")
    throw new Error(
      `${portTaken(state)} Stop it, or start this run with a different PORT.`,
    );

  const workspace = createWorkspace();
  const child = startServer(config.commands.dashboard, workspace, "inherit");
  forwardSignals(child);
  child.once("exit", () => {
    // The folder stays for inspection; only the pointer to it goes.
    rmSync(ACTIVE_RUN, { force: true });
  });
}

async function runMcp(): Promise<void> {
  const state = await probePort();
  if (state.kind === "foreign")
    throw new Error(
      `${portTaken(state)} The dry run cannot tell what state it serves, so it will not attach.`,
    );

  let workspace: string;
  let dashboard: ReturnType<typeof spawn> | undefined;

  if (state.kind === "dashboard") {
    // The running dashboard's own workspace wins over the recorded one: it is
    // the state a human is looking at, and writing anywhere else is invisible.
    if (!isDryRunWorkspace(state.workspace))
      throw new Error(
        `${portTaken(state)} That is not a dry-run workspace, and the dry run will not send an agent's changes into it.`,
      );
    workspace = state.workspace;
  } else {
    workspace = existingWorkspace() ?? createWorkspace();
    dashboard = startServer(config.commands.dashboard, workspace, "ignore");
    await waitForDashboard();
  }

  const child = startServer(config.commands.mcp, workspace, "inherit");
  forwardSignals(child);
  child.once("exit", () => {
    dashboard?.kill();
    if (dashboard) rmSync(ACTIVE_RUN, { force: true });
  });
}

async function run(): Promise<void> {
  if (!config.commands[mode]) throw new Error(`Unknown dry-run mode "${mode}".`);
  await (mode === "dashboard" ? runDashboard() : runMcp());
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
