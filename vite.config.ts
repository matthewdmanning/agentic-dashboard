import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  // `e2e/` is Playwright's, and its specs throw when a second runner collects
  // them.
  test: { exclude: ["e2e/**", "node_modules/**"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
