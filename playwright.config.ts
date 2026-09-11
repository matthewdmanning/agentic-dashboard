import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import path from "node:path";

import { loadE2EConfig } from "./e2e/support/config";

const config = loadE2EConfig();
const REPO_ROOT = path.resolve(import.meta.dirname);
const workspace =
  process.env.E2E_RUN_WORKSPACE ??
  mkdtempSync(path.join(REPO_ROOT, config.workspacePrefix));
process.env.E2E_RUN_WORKSPACE = workspace;

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
  // Seeds the run's workspace from `test-dashboard-config/` and, on the way
  // out, proves the run never wrote back to it.
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
