import { defineConfig } from "@playwright/test";

/**
 * Browser checks, kept out of the pull-request lane: they boot a real server
 * and a real browser, which is the expensive half of CI. `.github/workflows`
 * runs them on `main` and on demand.
 *
 * The server is started against a throwaway workspace so a run never touches
 * `.dashboard/` — the developer's real dashboard data and their real
 * local-user token. Port and workspace both come from the environment so two
 * checks can run at once without sharing a port or each other's state.
 */
export const E2E_WORKSPACE =
  process.env.DASHBOARD_WORKSPACE ?? ".e2e-workspace";
export const E2E_PORT = Number(process.env.PORT) || 5174;

export default defineConfig({
  testDir: "e2e",
  // One worker, one server, one workspace. B3 adds and removes a registry item
  // while the server watches it, which would rewrite the registry underneath
  // B1's discovery assertions if the two specs overlapped.
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}` },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${E2E_PORT}/api/dashboard`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DASHBOARD_WORKSPACE: E2E_WORKSPACE, PORT: String(E2E_PORT) },
  },
});
