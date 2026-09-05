import { rm } from "node:fs/promises";

import { defaultDashboardConfiguration } from "../src/contract";
import { createFilePersistence } from "../src/service";
import { E2E_WORKSPACE } from "../playwright.config";

/**
 * A throwaway workspace, initialized the way `npm run init` does but through
 * the same functions rather than a child process.
 *
 * Run by `npm run test:e2e` before Playwright, not from `globalSetup`:
 * Playwright starts `webServer` first, so a setup hook that cleared this
 * directory would delete the local-user token the server had just written.
 */
await rm(E2E_WORKSPACE, { recursive: true, force: true });
await createFilePersistence(`${E2E_WORKSPACE}/.dashboard/dashboard.json`).write(
  defaultDashboardConfiguration,
);
