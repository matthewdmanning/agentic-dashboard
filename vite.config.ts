import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  // `e2e/` is Playwright's, and its specs throw when a second runner collects
  // them. `.claude/` may hold a worktree checked out inside the repository,
  // whose stale test copies would run against current source.
  test: { exclude: ["e2e/**", "node_modules/**", ".claude/**"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
