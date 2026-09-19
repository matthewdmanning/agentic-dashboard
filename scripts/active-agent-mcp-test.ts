import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Drives the tile-creator subagents (`.claude/agents/tile-creator-*.md`)
 * end to end, via `claude -p --agent <tier>` — the same agent definition a
 * real invocation would use, not a re-implemented copy of it.
 *
 * One dashboard per subagent, not one per prompt: each tier gets a single
 * empty dashboard, seeded once, and that tier's 5 prompts run against it
 * one after another in the same order a person would actually ask for
 * them — replicating a dashboard being built up from scratch by that
 * subagent, tile by tile, rather than 5 disconnected single-tile trials.
 *
 * Results are for a human to judge, not for this script to grade — it only
 * collects each run's report and screenshot into one folder per trial.
 *
 * Usage:
 *   tsx scripts/tile-creator-e2e.ts [--tier haiku|sonnet|opus|all] [--dry-run]
 *
 * `--dry-run` prints the commands this would run without spending anything.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
const TIERS = ["haiku", "sonnet", "opus"] as const;
type Tier = (typeof TIERS)[number];

const PROMPTS: readonly { slug: string; text: string }[] = [
  {
    slug: "active-projects-count",
    text: "Add a tile up top that shows how many active projects I've got right now, just a big number with a label.",
  },
  {
    slug: "reading-queue-checklist",
    text: "Can you drop in a checklist for my reading queue? I want to tick things off as I finish them.",
  },
  {
    slug: "week-over-week-comparison",
    text: "I want a widget comparing this week's completed tasks against last week's, side by side.",
  },
  {
    slug: "streak-days",
    text: "Put a small tile in the corner that just says how many days I've kept my streak going.",
  },
  {
    slug: "upcoming-this-week",
    text: "Add a list tile for what's coming up this week — meetings, deadlines, that kind of thing — nothing fancy, just the highlights.",
  },
];

function parseArgs(argv: readonly string[]): {
  tiers: Tier[];
  dryRun: boolean;
} {
  const tierArg = argv[argv.indexOf("--tier") + 1];
  const dryRun = argv.includes("--dry-run");
  if (!argv.includes("--tier") || tierArg === "all")
    return { tiers: [...TIERS], dryRun };
  if (!TIERS.includes(tierArg as Tier))
    throw new Error(
      `--tier must be one of ${TIERS.join(", ")}, or "all" (got "${tierArg}")`,
    );
  return { tiers: [tierArg as Tier], dryRun };
}

function agentFileFor(tier: Tier): string {
  const file = path.join(
    REPO_ROOT,
    ".claude/agents",
    `tile-creator-${tier}.md`,
  );
  if (!existsSync(file))
    throw new Error(
      `Missing subagent definition: ${file}\n` +
        `This script drives the existing tile-creator-${tier} subagent — it does not create one. ` +
        `Create it first, then re-run.`,
    );
  return file;
}

/**
 * Copies the dry run's own fixture (registry, public assets, components —
 * everything a dashboard needs to boot) but replaces its dashboard.json
 * with an empty one, so the tier's first prompt lands on a dashboard with
 * nothing on it yet, the same as a brand new user.
 */
function createEmptyDashboardWorkspace(tier: Tier, dateStamp: string): string {
  const dest = path.join(
    REPO_ROOT,
    ".codex-tmp/dry-runs",
    `tile-creator-e2e-${tier}-${dateStamp}`,
  );
  rmSync(dest, { recursive: true, force: true });
  cpSync(path.join(REPO_ROOT, "dry-run/workspace"), dest, { recursive: true });
  rmSync(path.join(dest, "README.md"), { force: true });
  writeFileSync(
    path.join(dest, "dashboard.json"),
    `${JSON.stringify({ tiles: [], references: [] }, null, 2)}\n`,
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

/** Kills the dashboard's whole process tree — `child.kill()` alone can leave its own server child running on Windows. */
function stopDashboard(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGTERM");
}

/** Claude Code's `--output-format json` result shape (the fields this script relies on). */
type CliResult = { readonly result?: string; readonly is_error?: boolean };

function runAgent(
  tier: Tier,
  prompt: string,
  dryRunWorkspace: string,
): { text: string; ok: boolean } {
  const args = [
    "-p",
    prompt,
    "--agent",
    `tile-creator-${tier}`,
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
    "json",
  ];

  const result = spawnSync("claude", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    // Pins the dashboard MCP (dry-run/runner.ts) to this tier's one
    // workspace instead of letting it spin up a fresh throwaway one per
    // prompt — see dry-run/runner.ts's `pinnedWorkspace()`.
    env: { ...process.env, DRY_RUN_WORKSPACE: dryRunWorkspace },
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.status !== 0)
    return { text: `(exit ${result.status})\n${stdout}\n${stderr}`, ok: false };

  try {
    const parsed = JSON.parse(stdout) as CliResult;
    return { text: parsed.result ?? stdout, ok: parsed.is_error !== true };
  } catch {
    // Not JSON — fall back to raw stdout so nothing is lost.
    return { text: stdout, ok: true };
  }
}

/** Pulls `Screenshot: <path>` out of the agent's own report format (see the tile-creator agent files). */
function findScreenshotPath(reportText: string): string | undefined {
  const match = /^Screenshot:\s*(.+)$/m.exec(reportText);
  const value = match?.[1]?.trim();
  return value && value.toLowerCase() !== "none" ? value : undefined;
}

async function main(): Promise<void> {
  const { tiers, dryRun } = parseArgs(process.argv.slice(2));
  for (const tier of tiers) agentFileFor(tier);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const trialRoot = path.join(REPO_ROOT, "docs/tile-creator-trials", dateStamp);
  mkdirSync(trialRoot, { recursive: true });

  const indexLines: string[] = [
    `# Tile creator trial — ${dateStamp}`,
    "",
    "One dashboard per tier, seeded empty, built up by that tier's 5 prompts",
    "run in order — not 5 disconnected single-tile trials. Judge each report",
    "+ screenshot yourself; this script only collects results.",
    "",
    "| Tier | # | Prompt | Status | Report | Screenshot |",
    "| ---- | - | ------ | ------ | ------ | ---------- |",
  ];

  for (const tier of tiers) {
    if (dryRun) {
      console.log(
        `\n=== ${tier}: dashboard workspace (dry-run — none created) ===`,
      );
      for (const [index, prompt] of PROMPTS.entries()) {
        const ordinal = String(index + 1).padStart(2, "0");
        const cmd = `DRY_RUN_WORKSPACE=<one persistent workspace for this tier> claude -p ${JSON.stringify(prompt.text)} --agent tile-creator-${tier} --mcp-config .mcp.json --permission-mode bypassPermissions --output-format json`;
        console.log(`[dry-run] ${tier}/${ordinal}-${prompt.slug}\n  ${cmd}\n`);
      }
      continue;
    }

    const workspace = createEmptyDashboardWorkspace(tier, dateStamp);
    console.log(`\n=== ${tier}: starting one dashboard for ${workspace} ===`);
    const { child: dashboard, port } =
      await startPersistentDashboard(workspace);
    console.log(
      `  up at http://127.0.0.1:${port} — every prompt below attaches to this same instance`,
    );

    try {
      for (const [index, prompt] of PROMPTS.entries()) {
        const ordinal = String(index + 1).padStart(2, "0");
        const label = `${tier}/${ordinal}-${prompt.slug}`;
        const outDir = path.join(trialRoot, tier, `${ordinal}-${prompt.slug}`);
        mkdirSync(outDir, { recursive: true });

        console.log(`Running ${label}...`);
        const { text, ok } = runAgent(tier, prompt.text, workspace);
        writeFileSync(
          path.join(outDir, "prompt.txt"),
          `${prompt.text}\n`,
          "utf8",
        );
        writeFileSync(path.join(outDir, "report.md"), text, "utf8");

        let screenshotCell = "—";
        const screenshotPath = findScreenshotPath(text);
        if (screenshotPath) {
          const absolute = path.isAbsolute(screenshotPath)
            ? screenshotPath
            : path.join(REPO_ROOT, screenshotPath);
          if (existsSync(absolute)) {
            const dest = path.join(outDir, path.basename(absolute));
            copyFileSync(absolute, dest);
            screenshotCell = `[screenshot](${path.relative(REPO_ROOT, dest).replace(/\\/g, "/")})`;
          } else {
            screenshotCell = `reported but not found: \`${screenshotPath}\``;
          }
        }

        indexLines.push(
          `| ${tier} | ${index + 1} | ${prompt.text.replace(/\|/g, "\\|")} | ${ok ? "ran" : "error"} | [report](${path.relative(trialRoot, path.join(outDir, "report.md")).replace(/\\/g, "/")}) | ${screenshotCell} |`,
        );
        console.log(`  -> ${outDir}`);
      }
    } finally {
      stopDashboard(dashboard);
      console.log(`  dashboard for ${tier} stopped`);
    }

    const dashboardJson = path.join(workspace, "dashboard.json");
    if (existsSync(dashboardJson))
      copyFileSync(
        dashboardJson,
        path.join(trialRoot, tier, "final-dashboard.json"),
      );
  }

  if (!dryRun) {
    writeFileSync(
      path.join(trialRoot, "index.md"),
      `${indexLines.join("\n")}\n`,
      "utf8",
    );
    console.log(`\nDone. Review: ${path.join(trialRoot, "index.md")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
