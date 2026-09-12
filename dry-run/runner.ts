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
import { createServer } from "node:net";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_PATH = path.join(import.meta.dirname, "config.json");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

type DryRunConfig = {
  readonly fixtureDirectory: string;
  readonly workingDirectory: string;
  readonly workingFolderPrefix: string;
  readonly runFile: string;
  readonly excludeFromWorkspace: readonly string[];
  readonly commands: Readonly<Record<string, string>>;
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly portAttempts: number;
    readonly startupTimeout: number;
    readonly pollInterval: number;
  };
  readonly leftoverWarningThreshold: number;
};

/** Written inside the workspace it describes, so no two runs share a pointer to clobber. */
type RunRecord = {
  readonly port: number;
  readonly pid: number;
  readonly startedAt: string;
};

/** What is answering a port. A dashboard reports the directory it serves. */
type PortState =
  | { readonly kind: "free" }
  | { readonly kind: "dashboard"; readonly workspace: string }
  | { readonly kind: "foreign" };

type LiveRun = { readonly workspace: string; readonly port: number };

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as DryRunConfig;
const mode = process.argv[2] ?? "dashboard";
const HOST = config.server.host;
const WORKING_DIR = path.resolve(REPO_ROOT, config.workingDirectory);
// Set to pin a run to one port or one workspace. Unset is the normal case: the
// runner picks both, so several dry runs coexist without being told about
// each other.
const PINNED_PORT = Number(process.env.PORT) || undefined;
const PINNED_WORKSPACE = process.env.DRY_RUN_WORKSPACE
  ? path.resolve(REPO_ROOT, process.env.DRY_RUN_WORKSPACE)
  : undefined;

const origin = (port: number): string => `http://${HOST}:${port}`;
const warn = (message: string): void => console.error(`dry run: ${message}`);

function workspaceFolders(): string[] {
  if (!existsSync(WORKING_DIR)) return [];
  return readdirSync(WORKING_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(config.workingFolderPrefix),
    )
    .map((entry) => path.join(WORKING_DIR, entry.name));
}

function readRun(workspace: string): RunRecord | undefined {
  try {
    return JSON.parse(
      readFileSync(path.join(workspace, config.runFile), "utf8"),
    ) as RunRecord;
  } catch {
    return undefined;
  }
}

function createWorkspace(): string {
  mkdirSync(WORKING_DIR, { recursive: true });
  // Nothing here is ever pruned: a folder left by a finished or crashed run
  // holds that run's dashboard, and another run may still be using it. Old
  // folders are the developer's to delete.
  const leftovers = workspaceFolders().length;
  if (leftovers >= config.leftoverWarningThreshold)
    warn(
      `${leftovers} workspaces are sitting in ${config.workingDirectory}. Delete the ones you are done with; nothing is removed automatically.`,
    );

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
  return workspace;
}

function recordRun(workspace: string, port: number): void {
  writeFileSync(
    path.join(workspace, config.runFile),
    `${JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

async function probePort(port: number, timeoutMs = 1000): Promise<PortState> {
  let response: Response;
  try {
    response = await fetch(`${origin(port)}/api/workspace`, {
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

const sameDirectory = (left: string, right: string): boolean =>
  path.resolve(left) === path.resolve(right);

const isDryRunWorkspace = (workspace: string): boolean =>
  path.resolve(workspace).startsWith(`${WORKING_DIR}${path.sep}`);

/**
 * Bindable right now. The probe listens the way the dashboard does — every
 * interface, no host — because a port held on "::" still accepts a bind on
 * 127.0.0.1, which would report a taken port as free and hand the next run a
 * server that dies on EADDRINUSE.
 */
const canBind = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });

async function choosePort(
  preferred: number | undefined,
  taken: ReadonlySet<number>,
): Promise<number> {
  if (preferred) return preferred;
  const base = config.server.port;
  for (let port = base; port < base + config.server.portAttempts; port++)
    if (!taken.has(port) && (await canBind(port))) return port;
  throw new Error(
    `No free port between ${base} and ${base + config.server.portAttempts - 1}.`,
  );
}

/**
 * Dashboards that are up right now, newest first. A run record whose port has
 * gone quiet is stale and simply ignored — its workspace stays where it is.
 */
async function liveRuns(): Promise<LiveRun[]> {
  const candidates = workspaceFolders()
    .map((workspace) => ({ workspace, run: readRun(workspace) }))
    .filter(
      (entry): entry is { workspace: string; run: RunRecord } =>
        entry.run !== undefined,
    )
    .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));

  const live: LiveRun[] = [];
  for (const { workspace, run } of candidates) {
    const state = await probePort(run.port);
    if (state.kind === "dashboard" && sameDirectory(state.workspace, workspace))
      live.push({ workspace, port: run.port });
  }
  return live;
}

function startServer(
  entry: string,
  workspace: string,
  port: number,
  stdio: "inherit" | "ignore",
) {
  return spawn(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, entry)], {
    cwd: REPO_ROOT,
    env: { ...process.env, DASHBOARD_WORKSPACE: workspace, PORT: String(port) },
    stdio,
  });
}

/**
 * Resolves true once the server is answering for this workspace, false if it
 * gave up first — which on a contested port means another run bound it in the
 * moment between the free-port check and this server's own listen.
 */
async function dashboardCameUp(
  workspace: string,
  port: number,
  child: ReturnType<typeof spawn>,
): Promise<boolean> {
  let exited = child.exitCode !== null;
  child.once("exit", () => (exited = true));

  const deadline = Date.now() + config.server.startupTimeout;
  while (Date.now() < deadline) {
    const state = await probePort(port);
    if (state.kind === "dashboard" && sameDirectory(state.workspace, workspace))
      return true;
    if (exited) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, config.server.pollInterval),
    );
  }
  throw new Error(`Dry-run dashboard did not start at ${origin(port)}.`);
}

function forwardSignals(child: ReturnType<typeof spawn>): void {
  const stop = () => child.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

/**
 * Starts a dashboard for a workspace, waits until it is actually serving, and
 * records the port it landed on. A free port can be claimed by another run in
 * the moment before this server binds it — two `npm run dry-run` calls in the
 * same instant do exactly that — so losing the port is answered by taking the
 * next one rather than by failing the run.
 */
async function startDashboard(
  workspace: string,
  stdio: "inherit" | "ignore",
  preferred?: number,
): Promise<{ child: ReturnType<typeof spawn>; port: number }> {
  const taken = new Set<number>();
  for (;;) {
    const port = await choosePort(preferred, taken);
    const child = startServer(
      config.commands.dashboard,
      workspace,
      port,
      stdio,
    );
    recordRun(workspace, port);
    child.once("exit", () => {
      // The workspace stays for inspection; only the record of a listening
      // server goes, so a later run does not chase a dead port.
      rmSync(path.join(workspace, config.runFile), { force: true });
    });

    if (await dashboardCameUp(workspace, port, child))
      return { child, port };

    if (preferred)
      throw new Error(
        `A dashboard for ${workspace} could not start on ${origin(port)}, and PORT pins it there.`,
      );
    taken.add(port);
    warn(`${origin(port)} was claimed while starting up; trying another port.`);
  }
}

/** A pinned workspace that is not there is a typo, not a reason to refuse to start. */
function pinnedWorkspace(): string | undefined {
  if (!PINNED_WORKSPACE) return undefined;
  if (existsSync(PINNED_WORKSPACE)) return PINNED_WORKSPACE;
  warn(
    `DRY_RUN_WORKSPACE ${PINNED_WORKSPACE} does not exist. Using a fresh workspace instead.`,
  );
  return undefined;
}

async function runDashboard(): Promise<void> {
  const workspace = pinnedWorkspace() ?? createWorkspace();

  if (PINNED_PORT) {
    const state = await probePort(PINNED_PORT);
    if (state.kind !== "free")
      warn(
        `${origin(PINNED_PORT)} is already in use, and PORT pins this run to it. The server will report the collision and stop.`,
      );
  }

  const { child, port } = await startDashboard(workspace, "inherit", PINNED_PORT);
  forwardSignals(child);
  console.log(`Dry run: ${origin(port)} serving ${workspace}`);
}

/**
 * Picks the dashboard an agent should drive. In order: the one it was pinned
 * to, the one already running, or a new one. Every fallback warns and carries
 * on — an agent working in the background has nobody to answer a prompt.
 */
async function chooseTarget(): Promise<{
  workspace: string;
  dashboard?: ReturnType<typeof spawn>;
  port: number;
}> {
  const pinned = pinnedWorkspace();
  if (pinned) {
    const run = readRun(pinned);
    if (run) {
      const state = await probePort(run.port);
      if (state.kind === "dashboard" && sameDirectory(state.workspace, pinned))
        return { workspace: pinned, port: run.port };
      // The record points at a port nobody answers: the run behind it is gone,
      // but its dashboard is still on disk and is what was asked for.
      warn(`${origin(run.port)} is not serving ${pinned} any more; restarting it.`);
    }
    const started = await startDashboard(pinned, "ignore", PINNED_PORT);
    return {
      workspace: pinned,
      dashboard: started.child,
      port: started.port,
    };
  }

  // Only while the pinned port is still a port this run could use. Once
  // something else has it, insisting on it would trade one refusal for a
  // server that cannot bind.
  let preferred = PINNED_PORT;
  if (PINNED_PORT) {
    const state = await probePort(PINNED_PORT);
    if (state.kind === "dashboard" && isDryRunWorkspace(state.workspace))
      return { workspace: state.workspace, port: PINNED_PORT };
    if (state.kind !== "free") {
      warn(
        `${origin(PINNED_PORT)} is serving ${state.kind === "dashboard" ? state.workspace : "something that is not a dashboard"}, which this run will not write into. Starting a dry run of its own instead.`,
      );
      preferred = undefined;
    }
  }

  const running = await liveRuns();
  if (running.length > 0) {
    const [target, ...others] = running;
    if (others.length > 0)
      warn(
        `${running.length} dry runs are up; attaching to the newest, ${origin(target.port)}. Set DRY_RUN_WORKSPACE or PORT to pick another.`,
      );
    return { workspace: target.workspace, port: target.port };
  }

  const workspace = createWorkspace();
  const started = await startDashboard(workspace, "ignore", preferred);
  return { workspace, dashboard: started.child, port: started.port };
}

async function runMcp(): Promise<void> {
  const { workspace, dashboard, port } = await chooseTarget();
  warn(`attached to ${origin(port)} serving ${workspace}`);

  const child = startServer(config.commands.mcp, workspace, port, "inherit");
  forwardSignals(child);
  child.once("exit", () => dashboard?.kill());
}

async function run(): Promise<void> {
  if (!config.commands[mode]) throw new Error(`Unknown dry-run mode "${mode}".`);
  await (mode === "dashboard" ? runDashboard() : runMcp());
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
