import { defineConfig } from "@playwright/test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { loadE2EConfig } from "./e2e/support/config";
import { loadEnvLocal } from "./scripts/load-env-local";

const REPO_ROOT = path.resolve(import.meta.dirname);
// Same `.env.local` convention as `dev`/`mcp` (see scripts/load-env-local.ts),
// so specs run by `playwright test` see a locally-set credential.
loadEnvLocal(REPO_ROOT);

const config = loadE2EConfig();

/**
 * Deletes throwaway workspaces left by a run that never reached its own
 * teardown — a crashed webServer, a killed process. Only runs when this
 * invocation is about to make its own workspace; a pinned E2E_RUN_WORKSPACE
 * is left alone.
 */
function sweepStaleWorkspaces(): void {
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(config.workspacePrefix))
      rmSync(path.join(REPO_ROOT, entry.name), {
        recursive: true,
        force: true,
      });
  }
}

let workspace = process.env.E2E_RUN_WORKSPACE;
if (!workspace) {
  sweepStaleWorkspaces();
  workspace = mkdtempSync(path.join(REPO_ROOT, config.workspacePrefix));
}
process.env.E2E_RUN_WORKSPACE = workspace;

// Playwright starts `webServer` before running `globalSetup` (never the
// reverse), so seeding the workspace from globalSetup let the server boot,
// build its own registry into this directory, and then have globalSetup's
// wipe-and-recopy delete that output out from under it — the very first
// request in a test could 404 on /r/registry.json. Seeding here instead runs
// before webServer's command is even spawned, so the server only ever sees a
// workspace that's already in its final starting state.
const fixtureDir = path.resolve(REPO_ROOT, config.fixtureDirectory);
rmSync(workspace, { recursive: true, force: true });
cpSync(fixtureDir, workspace, { recursive: true });
for (const entry of config.excludeFromWorkspace)
  rmSync(path.join(workspace, entry), { force: true });

/**
 * Browser checks, kept out of the pull-request lane: they boot a real server
 * and a real browser, which is the expensive half of CI. `.github/workflows`
 * runs them on `main` and on demand.
 *
 * The server is started against a unique throwaway workspace so a run never
 * touches `.dashboard/` — the developer's real dashboard data and their real
 * local-user token. Run settings live in `e2e/config.json`.
 */
export const E2E_WORKSPACE = workspace;
export const E2E_CONFIG = config;
export const E2E_PORT = config.server.port;
export const E2E_ORIGIN = `http://${config.server.host}:${config.server.port}`;

export default defineConfig({
  testDir: config.playwright.testDirectory,
  // On the way out, proves the run never wrote back to the `dry-run/workspace/`
  // fixture this config already copied into the run's workspace above.
  globalSetup: "./e2e/support/workspace.ts",
  // One worker, one server, one workspace. B3 adds and removes a registry item
  // while the server watches it, which would rewrite the registry underneath
  // B1's discovery assertions if the two specs overlapped.
  fullyParallel: config.playwright.fullyParallel,
  workers: config.playwright.workers,
  use: { baseURL: E2E_ORIGIN, viewport: config.playwright.viewport },
  webServer: {
    command: config.server.command,
    url: `${E2E_ORIGIN}${config.server.healthPath}`,
    reuseExistingServer: config.server.reuseExistingServer,
    timeout: config.server.timeout,
    env: {
      DASHBOARD_WORKSPACE: E2E_WORKSPACE,
      PORT: String(config.server.port),
    },
  },
});
