import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import assert from "node:assert";
import path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Runs the active agent MCP test (see CONTEXT.md's "Active agent MCP test"
 * entry) end to end, driving the active-agent-mcp tier subagents
 * (`.claude/agents/active-agent-mcp-*.md`) via `claude -p --agent <tier>` —
 * the same agent definition a real invocation would use, not a
 * re-implemented copy of it.
 *
 * One dashboard per subagent, not one per prompt: each tier gets a single
 * empty dashboard, seeded once, and that tier's 6 prompts (5 tile requests
 * plus a place-all-tiles follow-up) run against it one after another in the
 * same order a person would actually ask for them.
 *
 * Every file this script produces lives under
 * active-agent-trials/trials/<date>_run<n>/ — see `trialLayout()` for the
 * exact shape. Results are for a human to
 * judge, not for this script to grade: it only collects raw evidence
 * (stream-json agent log, MCP call log, one screenshot per prompt).
 *
 * Usage:
 *   tsx active-agent-trials/active-agent-mcp-test.ts [--tier haiku|sonnet|opus|all] [--dry-run]
 *   tsx active-agent-trials/active-agent-mcp-test.ts --self-check
 *
 * `--dry-run` prints the commands this would run without spending anything.
 * `--self-check` checks the pure helpers below and exits.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
const TIERS = ["haiku", "sonnet", "opus"] as const;
type Tier = (typeof TIERS)[number];
const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PROMPTS_FILE = path.join(
  REPO_ROOT,
  "active-agent-trials/active-agent-mcp-test.prompts.json",
);
const THEME_FILE = path.join(
  REPO_ROOT,
  "active-agent-trials/active-agent-mcp-test.theme.css",
);
const TRIALS_DIR = path.join(REPO_ROOT, "active-agent-trials/trials");

type PromptSpec = { readonly step: string; readonly text: string; readonly tags: readonly string[] };

/**
 * `data` is the fixture's dummy dataset — realistic API/memory-shaped JSON,
 * not keyed or grouped by which step it's for; the agent infers relevance
 * from each prompt the same way it would against a real data source. `steps`
 * is the prompt sequence run against that same data.
 */
type Fixture = { readonly data: unknown; readonly steps: readonly PromptSpec[] };

/** Throws on a malformed entry rather than silently dropping or coercing it. */
function parsePromptSpec(value: unknown): PromptSpec {
  const record = value as Record<string, unknown> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.step !== "string" ||
    typeof record.text !== "string" ||
    !Array.isArray(record.tags) ||
    !record.tags.every((tag) => typeof tag === "string")
  )
    throw new Error(
      `Invalid prompt entry (needs string "step", string "text", string[] "tags"): ${JSON.stringify(value)}`,
    );
  return { step: record.step, text: record.text, tags: record.tags as string[] };
}

/** Throws on a malformed fixture rather than silently dropping or coercing it. */
function parseFixture(value: unknown): Fixture {
  const record = value as Record<string, unknown> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    !("data" in record) ||
    !Array.isArray(record.steps)
  )
    throw new Error(
      `Invalid fixture (needs "data" object and "steps" array): ${JSON.stringify(value)}`,
    );
  return { data: record.data, steps: record.steps.map(parsePromptSpec) };
}

/**
 * Reads a fixture (dummy data + prompt sequence) from a JSON file. The
 * schema is identical to the `prompts.json` this script writes per trial, so
 * a prior trial's `prompts.json` can be fed straight back in via `--prompts`.
 */
function loadFixture(filePath: string): Fixture {
  const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  const fixture = parseFixture(raw);
  if (fixture.steps.length === 0)
    throw new Error(`${filePath} "steps" must be a non-empty array of prompts.`);
  return fixture;
}

/**
 * The seed message sent once, before any prompt, in the same session so
 * every later prompt already has it in context. Deliberately thin — the
 * data should read like something handed over by agent memory or a
 * third-party API, not pre-sorted for the tiles about to be requested.
 */
function buildDataSeedPrompt(data: unknown): string {
  return (
    "Here is the user's data, available for you to reference in later requests. " +
    "No action is needed right now.\n\n" +
    JSON.stringify(data, null, 2)
  );
}

function parseArgs(argv: readonly string[]): {
  tiers: Tier[];
  dryRun: boolean;
  selfCheck: boolean;
  promptsFile: string;
} {
  const selfCheck = argv.includes("--self-check");
  const tierArg = argv[argv.indexOf("--tier") + 1];
  const dryRun = argv.includes("--dry-run");
  const promptsFile = argv.includes("--prompts")
    ? argv[argv.indexOf("--prompts") + 1]!
    : DEFAULT_PROMPTS_FILE;
  if (selfCheck) return { tiers: [], dryRun: false, selfCheck, promptsFile };
  if (!argv.includes("--tier") || tierArg === "all")
    return { tiers: [...TIERS], dryRun, selfCheck, promptsFile };
  if (!TIERS.includes(tierArg as Tier))
    throw new Error(
      `--tier must be one of ${TIERS.join(", ")}, or "all" (got "${tierArg}")`,
    );
  return { tiers: [tierArg as Tier], dryRun, selfCheck, promptsFile };
}

function agentFileFor(tier: Tier): string {
  const file = path.join(
    REPO_ROOT,
    ".claude/agents",
    `active-agent-mcp-${tier}.md`,
  );
  if (!existsSync(file))
    throw new Error(
      `Missing subagent definition: ${file}\n` +
        `This script drives the existing active-agent-mcp-${tier} subagent — it does not create one. ` +
        `Create it first, then re-run.`,
    );
  return file;
}

/** Pure — the run number to use next for `dateStamp`, given the trials directory's current entries. */
function nextRunNumber(existingNames: readonly string[], dateStamp: string): number {
  const prefix = `${dateStamp}_run`;
  const numbers = existingNames
    .filter((name) => name.startsWith(prefix))
    .map((name) => Number(name.slice(prefix.length)))
    .filter((n) => Number.isInteger(n) && n > 0);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/** Pure — the folder name a given run of `dateStamp` is stored under. */
function runFolderName(dateStamp: string, runNumber: number): string {
  return `${dateStamp}_run${runNumber}`;
}

/**
 * Picks this run's folder name under `active-agent-trials/trials/`, numbering
 * it one past whatever runs already exist for today — so a second run on the
 * same day never overwrites the first.
 */
function determineRunFolder(dateStamp: string): string {
  mkdirSync(TRIALS_DIR, { recursive: true });
  return runFolderName(dateStamp, nextRunNumber(readdirSync(TRIALS_DIR), dateStamp));
}

/** Single source of truth for every path this script writes. Pure — no I/O. */
type TrialLayout = ReturnType<typeof trialLayout>;
function trialLayout(runFolder: string) {
  const root = path.join(TRIALS_DIR, runFolder);
  const logsDir = path.join(root, "logs");
  const screenshotsDir = path.join(root, "screenshots");
  return {
    root,
    logsDir,
    screenshotsDir,
    promptsJson: path.join(root, "prompts.json"),
    indexMd: path.join(root, "index.md"),
    cleanupLog: path.join(logsDir, "cleanup.log"),
    agentLog: (tier: Tier) => path.join(logsDir, `${tier}-agent-log.jsonl`),
    mcpLog: (tier: Tier) => path.join(logsDir, `${tier}-mcp.log`),
    screenshot: (tier: Tier, index: number, step: string) =>
      path.join(
        screenshotsDir,
        `${tier}-${String(index + 1).padStart(2, "0")}-${step}.png`,
      ),
    finalScreenshot: (tier: Tier) => path.join(root, `${tier}-final.png`),
    finalDashboardJson: (tier: Tier) =>
      path.join(root, `${tier}-final-dashboard.json`),
  };
}

function writePromptsJson(layout: TrialLayout, fixture: Fixture): void {
  writeFileSync(
    layout.promptsJson,
    `${JSON.stringify(fixture, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Copies the dry run's own fixture (public assets, components — everything
 * a dashboard needs to boot) but replaces its dashboard.json with an empty
 * one, so the tier's first prompt lands on a dashboard with nothing on it
 * yet, the same as a brand new user.
 *
 * Also seeds an empty `registry.json` ahead of `seedWorkspace()` (see
 * `src/workspace.ts`), which only fills in a registry.json that's missing —
 * an existing empty one is left alone. Without this, the workspace would
 * inherit this repo's own four dashboard tile items (stat-tile, list-tile,
 * etc), letting the agent solve every prompt by reuse. The test is meant to
 * exercise authoring: only the base shadcn/ui components (in `components/`)
 * are available to build from, not this repo's own tile registry.
 *
 * Also pre-writes `styles.css` from `THEME_FILE`, for the same
 * fill-in-if-missing reason: `seedWorkspace()` only writes a `styles.css`
 * that doesn't exist yet, normally copying the app's own `src/index.css`.
 * Writing ours first makes every tier's dashboard (and Vite's `@styles`
 * alias — see `vite.config.ts`) render this fixed, deliberately distinct
 * theme instead, so a human judging screenshots can tell the agent's own
 * styling choices apart from the app's default look, and so every tier is
 * compared against the exact same backdrop.
 */
function createEmptyDashboardWorkspace(tier: Tier, runFolder: string): string {
  const dest = path.join(
    REPO_ROOT,
    ".codex-tmp/dry-runs",
    `active-agent-mcp-test-${tier}-${runFolder}`,
  );
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(REPO_ROOT, "dry-run/workspace"), dest, { recursive: true });
  rmSync(path.join(dest, "README.md"), { force: true });
  writeFileSync(
    path.join(dest, "dashboard.json"),
    `${JSON.stringify({ tiles: [], references: [] }, null, 2)}\n`,
    "utf8",
  );
  const registrySeed = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "registry.json"), "utf8"),
  ) as Record<string, unknown>;
  writeFileSync(
    path.join(dest, "registry.json"),
    `${JSON.stringify({ ...registrySeed, items: [] }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(dest, "styles.css"),
    `${readFileSync(THEME_FILE, "utf8")}\n@source "./components";\n@source "./registry";\n`,
    "utf8",
  );
  // The trial's tile registry must start truly empty, not with this
  // project's own authored tiles (stat-tile.tsx etc.) — `seedWorkspace()`
  // only copies its starter files into a target that doesn't already exist,
  // so pre-creating an empty one here keeps the project's registry out.
  mkdirSync(path.join(dest, "registry"), { recursive: true });
  // The shadcn base components (`components/ui/*`) are the one thing every
  // trial does start with — copied in up front so no trial ever needs to
  // re-add them from a registry over the network. A real copy, not a
  // symlink: a symlinked workspace/components is the same file as this
  // project's real one, so an agent writing through it (a formatter, an
  // in-place edit) lands directly on this project's source — happened once
  // already (components/ui/progress.tsx, restored via git). A copy is this
  // trial's own to modify or ruin.
  cpSync(path.join(REPO_ROOT, "components"), path.join(dest, "components"), {
    recursive: true,
  });
  // Pre-written for the same reason as the files above: `seedWorkspace()`
  // only generates a components.json when one is missing, and its generated
  // aliases point `ui` at `@/components/ui` rather than this project's own
  // `@components/ui` scheme. Copying the project's real components.json
  // keeps the trial's shadcn CLI resolution identical to it.
  const componentsConfigSeed = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "components.json"), "utf8"),
  ) as { tailwind?: Record<string, unknown> };
  writeFileSync(
    path.join(dest, "components.json"),
    `${JSON.stringify(
      {
        ...componentsConfigSeed,
        tailwind: { ...componentsConfigSeed.tailwind, css: "styles.css" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return dest;
}

/**
 * Starts one `dry-run/runner.ts dashboard` process for this workspace and
 * waits until it actually answers, the same readiness check the runner uses
 * on itself (`/api/workspace` echoing back this exact workspace path).
 *
 * Kept running for the whole tier: `dry-run/runner.ts`'s "mcp" mode tears
 * its dashboard down the moment that MCP connection closes — which, run
 * once per prompt, restarted the dashboard from scratch every single time.
 * Starting it here instead, and pointing each prompt's `DRY_RUN_WORKSPACE`
 * at an already-live run, makes `chooseTarget()` attach to it (see
 * `dry-run/runner.ts`) rather than start (and later kill) one of its own.
 */
async function startPersistentDashboard(
  workspace: string,
): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn("node", [TSX_CLI, "dry-run/runner.ts", "dashboard"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DRY_RUN_WORKSPACE: workspace },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  const runFile = path.join(workspace, "run.json");
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `Dashboard process for ${workspace} exited early (code ${child.exitCode}):\n${stderr}`,
      );
    if (existsSync(runFile)) {
      try {
        const { port } = JSON.parse(readFileSync(runFile, "utf8")) as {
          port: number;
        };
        const response = await fetch(`http://127.0.0.1:${port}/api/workspace`, {
          signal: AbortSignal.timeout(1000),
        }).catch(() => undefined);
        if (response?.ok) {
          const { workspace: served } = (await response.json()) as {
            workspace?: string;
          };
          if (served && path.resolve(served) === path.resolve(workspace))
            return { child, port };
        }
      } catch {
        // run.json mid-write, or a stale port from a previous attempt — retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Dashboard for ${workspace} did not become ready within 90s.\n${stderr}`,
  );
}

/** Resolves once nothing is listening on `port`, or after `timeoutMs`. */
async function waitPortFree(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Kills the dashboard's whole process tree, then waits for its port to free up before the next tier reuses the port range. */
async function stopDashboard(child: ChildProcess, port: number): Promise<void> {
  if (child.pid !== undefined) {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
  }
  await waitPortFree(port);
}

type AgentOutcome = {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly sessionId?: string;
  readonly rawLines: readonly string[];
};

/**
 * One prompt in one continuing conversation, not one fresh agent per call:
 * `resumeSessionId` (from a prior call's `session_id`) reattaches to that
 * same session via `--resume`, so the agent sees earlier prompts — and its
 * own earlier tool calls — still in context, instead of relitigating each
 * tile from a blank slate.
 *
 * Captures raw `stream-json` output (every event, including reasoning) —
 * this is the evidence `CONTEXT.md`'s "Active agent MCP test" promises, not
 * just a final message. No report is synthesized here; `appendAgentLog`
 * writes the raw lines straight through.
 */
function runAgent(
  tier: Tier,
  prompt: string,
  dryRunWorkspace: string,
  resumeSessionId?: string,
): AgentOutcome {
  const args = [
    "-p",
    prompt,
    "--agent",
    `active-agent-mcp-${tier}`,
    // `-p` skips the trust dialog and silently ignores a not-yet-trusted
    // .mcp.json — the dashboard MCP would never load, and the agent would
    // (did, once) improvise a hand-rolled MCP client script instead. Naming
    // the config file explicitly loads it regardless of trust state.
    "--mcp-config",
    path.join(REPO_ROOT, ".mcp.json"),
    // Fully non-interactive: this script's whole point is unattended,
    // one-by-one runs. The agent's own tool list (its frontmatter) is the
    // actual scope limit, not the permission prompt.
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
  ];

  const result = spawnSync("claude", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    timeout: PROMPT_TIMEOUT_MS,
    // Pins the dashboard MCP (dry-run/runner.ts) to this tier's one
    // workspace instead of letting it spin up a fresh throwaway one per
    // prompt — see dry-run/runner.ts's `pinnedWorkspace()`.
    env: { ...process.env, DRY_RUN_WORKSPACE: dryRunWorkspace },
  });

  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const rawLines = (result.stdout ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const lastResultLine = [...rawLines]
    .reverse()
    .find((line) => {
      try {
        return (JSON.parse(line) as { type?: string }).type === "result";
      } catch {
        return false;
      }
    });

  let sessionId: string | undefined;
  let isError = timedOut || result.status !== 0;
  if (lastResultLine) {
    try {
      const parsed = JSON.parse(lastResultLine) as {
        session_id?: string;
        is_error?: boolean;
      };
      sessionId = parsed.session_id;
      if (!timedOut) isError = parsed.is_error === true;
    } catch {
      // Keep the status-derived isError; the marker line + raw output still
      // carry whatever the process produced.
    }
  }

  return { ok: !isError, timedOut, sessionId, rawLines };
}

/** Pure — the exact line written before a prompt's raw stream-json output. */
function buildMarkerLine(index: number, step: string): string {
  return JSON.stringify({ trial_marker: "prompt", index, step });
}

function appendAgentLog(
  logPath: string,
  index: number,
  step: string,
  rawLines: readonly string[],
): void {
  appendFileSync(
    logPath,
    `${buildMarkerLine(index, step)}\n${rawLines.join("\n")}\n`,
    "utf8",
  );
}

async function takeScreenshot(port: number, outPath: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: outPath, fullPage: true });
  } finally {
    await browser.close();
  }
}

function snapshotUntrackedFiles(): ReadonlySet<string> {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const paths = new Set<string>();
  for (const line of (result.stdout ?? "").split("\n")) {
    if (!line.startsWith("??")) continue;
    paths.add(line.slice(3).trim());
  }
  return paths;
}

const STRAY_EXEMPT_PREFIXES = ["active-agent-trials/", ".codex-tmp/dry-runs/"];

/** Pure — true when a repo-relative path is not somewhere this trial run is allowed to leave files. */
function isStrayPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return !STRAY_EXEMPT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Script-owned cleanup, not agent-trusted: whatever the agent (or a bug in
 * this script) wrote outside the trial/workspace trees during this tier is
 * deleted and recorded, not left for a human to notice later.
 */
function cleanupStrayFiles(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  tier: Tier,
  layout: TrialLayout,
): void {
  const created = [...after].filter((p) => !before.has(p) && isStrayPath(p));
  if (created.length === 0) return;
  const logLines = created.map((relativePath) => {
    rmSync(path.join(REPO_ROOT, relativePath), { recursive: true, force: true });
    return `[${new Date().toISOString()}] ${tier}: deleted stray ${relativePath}`;
  });
  appendFileSync(layout.cleanupLog, `${logLines.join("\n")}\n`, "utf8");
}

type IndexRow = { readonly tier: Tier; readonly index: number; readonly step: string; readonly status: string };

/** Rewritten wholly after every prompt, so a crash mid-tier never loses rows already earned. */
function writeIndexMd(
  layout: TrialLayout,
  runFolder: string,
  rows: readonly IndexRow[],
): void {
  const lines = [
    `# Active agent MCP test — ${runFolder}`,
    "",
    "One dashboard, one dashboard MCP server, per tier — seeded empty, built",
    "up by that tier's 6 prompts run in order (5 tile requests, then one",
    "place-all-tiles follow-up). Raw evidence (agent log, MCP log, one",
    "screenshot per prompt) is in logs/ and screenshots/; judge it yourself —",
    "this script only collects it.",
    "",
    "| Tier | # | Step | Status |",
    "| ---- | - | ---- | ------ |",
    ...rows.map((row) => `| ${row.tier} | ${row.index} | ${row.step} | ${row.status} |`),
  ];
  writeFileSync(layout.indexMd, `${lines.join("\n")}\n`, "utf8");
}

function runSelfCheck(): void {
  assert.strictEqual(runFolderName("2026-01-01", 1), "2026-01-01_run1");
  assert.strictEqual(nextRunNumber([], "2026-01-01"), 1);
  assert.strictEqual(nextRunNumber(["2026-01-01_run1"], "2026-01-01"), 2);
  assert.strictEqual(nextRunNumber(["2026-01-01_run1", "2026-01-01_run3"], "2026-01-01"), 4);
  assert.strictEqual(nextRunNumber(["2026-01-02_run1"], "2026-01-01"), 1);
  assert.strictEqual(nextRunNumber(["not-a-run-folder"], "2026-01-01"), 1);

  const layout = trialLayout("2026-01-01_run1");
  assert.strictEqual(layout.root, path.join(TRIALS_DIR, "2026-01-01_run1"));
  assert.strictEqual(layout.logsDir, path.join(layout.root, "logs"));
  assert.strictEqual(layout.screenshotsDir, path.join(layout.root, "screenshots"));
  assert.strictEqual(layout.mcpLog("haiku"), path.join(layout.logsDir, "haiku-mcp.log"));
  assert.strictEqual(
    layout.screenshot("haiku", 0, "active-projects-count"),
    path.join(layout.screenshotsDir, "haiku-01-active-projects-count.png"),
  );
  assert.strictEqual(
    layout.screenshot("opus", 5, "place-all-tiles"),
    path.join(layout.screenshotsDir, "opus-06-place-all-tiles.png"),
  );

  assert.strictEqual(
    buildMarkerLine(2, "streak-days"),
    JSON.stringify({ trial_marker: "prompt", index: 2, step: "streak-days" }),
  );

  assert.strictEqual(isStrayPath("verify-tiles.js"), true);
  assert.strictEqual(isStrayPath("screenshot-fresh.ts"), true);
  assert.strictEqual(isStrayPath("active-agent-trials/trials/2026-09-18_run1/index.md"), false);
  assert.strictEqual(isStrayPath(".codex-tmp/dry-runs/active-agent-mcp-test-haiku-2026-09-18_run1/run.json"), false);
  assert.strictEqual(isStrayPath("active-agent-trials\\trials\\2026-09-18_run1\\index.md"), false);

  assert.deepStrictEqual(
    parsePromptSpec({ step: "foo", text: "bar", tags: ["x"] }),
    { step: "foo", text: "bar", tags: ["x"] },
  );
  assert.throws(() => parsePromptSpec({ step: "foo" }));
  assert.throws(() => parsePromptSpec({ step: "foo", text: "bar", tags: [1] }));

  assert.throws(() => parseFixture({ steps: [] }));
  assert.throws(() => parseFixture({ data: {} }));
  assert.deepStrictEqual(parseFixture({ data: { a: 1 }, steps: [] }), { data: { a: 1 }, steps: [] });

  assert.ok(buildDataSeedPrompt({ a: 1 }).startsWith("Here is the user's data"));
  assert.ok(buildDataSeedPrompt({ a: 1 }).includes(JSON.stringify({ a: 1 }, null, 2)));

  const defaultFixture = loadFixture(DEFAULT_PROMPTS_FILE);
  assert.ok(defaultFixture.steps.length > 0);
  assert.strictEqual(defaultFixture.steps.at(-1)!.step, "place-all-tiles");
  assert.ok(defaultFixture.data !== undefined);

  console.log("self-check: ok");
}

async function main(): Promise<void> {
  const { tiers, dryRun, selfCheck, promptsFile } = parseArgs(process.argv.slice(2));
  if (selfCheck) return runSelfCheck();
  for (const tier of tiers) agentFileFor(tier);

  const fixture = loadFixture(promptsFile);
  const { steps } = fixture;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const runFolder = determineRunFolder(dateStamp);
  const layout = trialLayout(runFolder);

  if (dryRun) {
    for (const tier of tiers) {
      console.log(`\n=== ${tier}: dry run ===`);
      const seedCmd =
        `DRY_RUN_WORKSPACE=<one persistent workspace for this tier> claude -p <data seed prompt> ` +
        `--agent active-agent-mcp-${tier} --mcp-config .mcp.json --permission-mode bypassPermissions ` +
        `--output-format stream-json --verbose`;
      console.log(`[dry-run] ${tier} 0/${steps.length + 1} seed-data\n  ${seedCmd}\n`);
      steps.forEach((step, index) => {
        const cmd =
          `DRY_RUN_WORKSPACE=<one persistent workspace for this tier> claude -p ${JSON.stringify(step.text)} ` +
          `--agent active-agent-mcp-${tier} --mcp-config .mcp.json --permission-mode bypassPermissions ` +
          `--output-format stream-json --verbose --resume <session>`;
        console.log(`[dry-run] ${tier} ${index + 1}/${steps.length + 1} ${step.step}\n  ${cmd}\n`);
      });
    }
    return;
  }

  mkdirSync(layout.logsDir, { recursive: true });
  mkdirSync(layout.screenshotsDir, { recursive: true });
  writePromptsJson(layout, fixture);

  const rows: IndexRow[] = [];
  writeIndexMd(layout, runFolder, rows);

  for (const tier of tiers) {
    const workspace = createEmptyDashboardWorkspace(tier, runFolder);
    console.log(`\n=== ${tier}: starting one dashboard for ${workspace} ===`);
    const { child: dashboard, port } = await startPersistentDashboard(workspace);
    console.log(
      `  up at http://127.0.0.1:${port} — every prompt below attaches to this same instance`,
    );

    const filesBefore = snapshotUntrackedFiles();
    let sessionId: string | undefined;

    try {
      console.log(`Seeding ${tier} with fixture data...`);
      const seedOutcome = runAgent(tier, buildDataSeedPrompt(fixture.data), workspace);
      sessionId = seedOutcome.sessionId;
      appendAgentLog(layout.agentLog(tier), 0, "seed-data", seedOutcome.rawLines);
      rows.push({
        tier,
        index: 0,
        step: "seed-data",
        status: seedOutcome.ok ? "ran" : seedOutcome.timedOut ? "timeout" : "error",
      });
      writeIndexMd(layout, runFolder, rows);

      for (const [index, step] of steps.entries()) {
        console.log(`Running ${tier} ${index + 1}/${steps.length} ${step.step}...`);
        const outcome = runAgent(tier, step.text, workspace, sessionId);
        sessionId = outcome.sessionId ?? sessionId;
        appendAgentLog(layout.agentLog(tier), index, step.step, outcome.rawLines);

        const status = outcome.ok ? "ran" : outcome.timedOut ? "timeout" : "error";
        rows.push({ tier, index: index + 1, step: step.step, status });
        writeIndexMd(layout, runFolder, rows);

        try {
          await takeScreenshot(port, layout.screenshot(tier, index, step.step));
        } catch (error) {
          console.error(`  screenshot failed: ${error instanceof Error ? error.message : error}`);
        }
        console.log(`  -> ${status}`);
      }

      copyFileSync(
        layout.screenshot(tier, steps.length - 1, steps[steps.length - 1]!.step),
        layout.finalScreenshot(tier),
      );
    } finally {
      await stopDashboard(dashboard, port);
      console.log(`  dashboard for ${tier} stopped`);
    }

    const dashboardJson = path.join(workspace, "dashboard.json");
    if (existsSync(dashboardJson))
      copyFileSync(dashboardJson, layout.finalDashboardJson(tier));

    // The MCP process spawned per prompt is pinned to this same workspace,
    // so every prompt's calls already accumulated in one file there.
    const mcpLogSrc = path.join(workspace, "mcp.log");
    if (existsSync(mcpLogSrc)) copyFileSync(mcpLogSrc, layout.mcpLog(tier));

    rmSync(workspace, { recursive: true, force: true });

    cleanupStrayFiles(filesBefore, snapshotUntrackedFiles(), tier, layout);
  }

  console.log(`\nDone. Review: ${layout.indexMd}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
