import { exec } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

import { createServer as createViteServer } from "vite";

import { readDashboard } from "../dashboard/store";

const execAsync = promisify(exec);
const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.resolve(import.meta.dirname, "../..");
const REGISTRY_JSON = path.join(ROOT, "registry.json");
const REGISTRY_SRC = path.join(ROOT, "src/registry");
const BUILT_REGISTRY = path.join(ROOT, "public/r/registry.json");

async function buildRegistry(): Promise<void> {
  await execAsync("npm run registry:build", { cwd: ROOT });
}

async function main() {
  if (!existsSync(BUILT_REGISTRY)) {
    console.log(`${BUILT_REGISTRY} missing, building registry before startup`);
    await buildRegistry();
  }

  const vite = await createViteServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: "spa",
  });

  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/dashboard") {
      readDashboard()
        .then((dashboard) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(dashboard));
        })
        .catch((error: unknown) => {
          console.error("reading the dashboard failed", error);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "dashboard-unreadable" }));
        });
      return;
    }
    // Vite serves `public/` itself, but its SPA fallback answers a missing
    // `/r/` item with the index shell at 200. An agent discovering tiles
    // through the shadcn CLI would then parse HTML as a registry item.
    if (
      req.url?.startsWith("/r/") &&
      !existsSync(path.join(ROOT, "public", req.url.split("?")[0]))
    ) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "no-such-registry-item" }));
      return;
    }
    vite.middlewares(req, res);
  });

  // ponytail: single debounce timer serializes rebuilds; fine at this file count, per-path
  // queueing only matters if rebuilds start overlapping in practice.
  let rebuildTimer: NodeJS.Timeout | undefined;
  const scheduleRebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      buildRegistry()
        .then(() => console.log("registry rebuilt"))
        .catch((error) => console.error("registry rebuild failed", error));
    }, 200);
  };

  watch(REGISTRY_JSON, scheduleRebuild);
  watch(REGISTRY_SRC, { recursive: true }, (_event, filename) => {
    if (filename?.endsWith(".tsx")) scheduleRebuild();
  });

  server.listen(PORT, () => {
    console.log(`Dashboard server on http://localhost:${PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error("the dashboard server failed to start", error);
  process.exitCode = 1;
});
