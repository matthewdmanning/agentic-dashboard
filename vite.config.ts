import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { loadEnvLocal } from "./scripts/load-env-local";
import { APP_ROOT, workspaceDirectory } from "./src/workspace";

// Same `.env.local` convention as `dev`/`mcp` (see scripts/load-env-local.ts),
// so `vitest run` (which shares this config) sees a locally-set credential.
loadEnvLocal(APP_ROOT);

const workspace = workspaceDirectory();

export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: path.join(workspace, "public"),
  // `tests/e2e/` is Playwright's, and its specs throw when a second runner collects
  // them. `.claude/` may hold a worktree checked out inside the repository,
  // whose stale test copies would run against current source. The seeded
  // workspace has no installed tooling of its own, so its copied test files
  // can't run either.
  test: {
    exclude: [
      "tests/e2e/**",
      "node_modules/**",
      ".claude/**",
      `${path.relative(APP_ROOT, workspace)}/**`,
    ],
  },
  server: {
    fs: {
      allow: [
        APP_ROOT,
        ...[
          "registry",
          "components",
          "lib",
          "hooks",
          "node_modules",
          "styles.css",
        ].map((entry) => path.join(workspace, entry)),
      ],
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@workspace", replacement: workspace },
      { find: "@styles", replacement: path.join(workspace, "styles.css") },
      { find: "@components", replacement: path.join(workspace, "components") },
      { find: "@/components", replacement: path.join(workspace, "components") },
      { find: "@/lib", replacement: path.join(workspace, "lib") },
      { find: "@/hooks", replacement: path.join(workspace, "hooks") },
      { find: "@", replacement: path.join(APP_ROOT, "src") },
    ],
  },
});
