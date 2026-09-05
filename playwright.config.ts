import { defineConfig } from "@playwright/test";

/**
 * Browser checks, kept out of the pull-request lane: they boot a real server
 * and a real browser, which is the expensive half of CI. `.github/workflows`
 * runs them on `main` and on demand.
 *
 * The server is started against a throwaway workspace so a run never touches
 * `.dashboard/` — the developer's real dashboard data and their real
 * local-user token.
 */
export const E2E_WORKSPACE = ".e2e-workspace";
const PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { DASHBOARD_WORKSPACE: E2E_WORKSPACE, PORT: String(PORT) },
  },
});
