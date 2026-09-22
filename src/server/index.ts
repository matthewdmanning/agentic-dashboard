import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";

import { createServer as createViteServer } from "vite";

import { dashboardDirectory, readDashboard } from "../dashboard/store";
import { APP_ROOT, seedWorkspace } from "../workspace";

const execAsync = promisify(exec);
const PORT = Number(process.env.PORT) || 5173;
const WORKSPACE = seedWorkspace();
const REGISTRY_SRC = path.join(WORKSPACE, "registry");
const REGISTRY_JSON = path.join(WORKSPACE, "registry.json");
const BUILT_REGISTRY = path.join(WORKSPACE, "public/r/registry.json");

async function buildRegistry(): Promise<void> {
  await execAsync("npm run registry:build", { cwd: APP_ROOT });
}

async function main() {
  await buildRegistry();

  const vite = await createViteServer({
    root: APP_ROOT,
    // Vite's default cacheDir is `<root>/node_modules/.vite`, and every
    // dashboard process shares one root — so the e2e webServer and each
    // dry-run-spawned dashboard would re-optimize deps into the same
    // directory at the same time, and a page load could be served a stale
    // asset hash (504 Outdated Optimize Dep). The port is already unique per
    // process, so it separates them. Keeping this under APP_ROOT rather than
    // under the workspace matters: `vite.watcher.add(WORKSPACE)` below
    // re-adds the directory Vite normally ignores, so a cache inside the
    // workspace would report every optimizer write as a source change.
    cacheDir: path.join(APP_ROOT, "node_modules", `.vite-${PORT}`),
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
    // Names the directory this process serves, so a second process can tell
    // whether the server already on this port is the one it meant to reach.
    if (req.method === "GET" && req.url === "/api/workspace") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ workspace: dashboardDirectory() }));
      return;
    }
    // Vite serves `public/` itself, but its SPA fallback answers a missing
    // `/r/` item with the index shell at 200. An agent discovering tiles
    // through the shadcn CLI would then parse HTML as a registry item.
    if (req.url?.startsWith("/r/")) {
      const publicDir = path.join(WORKSPACE, "public");
      const requested = path.join(publicDir, req.url.split("?")[0]);
      const withinPublicDir =
        requested === publicDir || requested.startsWith(publicDir + path.sep);
      if (!withinPublicDir || !existsSync(requested)) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "no-such-registry-item" }));
        return;
      }
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

  // Registry rebuilds ride Vite's own watcher (chokidar) rather than a
  // second, independent `node:fs.watch()` on the same directory. A separate
  // native watch used to sit alongside Vite's — confirmed via
  // `DEBUG=pw:webserver npm run test:e2e`: Vite's
  // own "page reload" HMR message for a newly-added registry file showed up
  // (eventually, ~90s late), but our watch's own "registry rebuilt" log
  // never fired for that same change — two watchers on one directory on
  // Windows, one starving the other. `vite.watcher.add` guarantees coverage
  // even for a `DASHBOARD_WORKSPACE` outside Vite's own root (deployments
  // set an absolute path elsewhere; see `workspace.ts`).
  vite.watcher.add(WORKSPACE);
  vite.watcher.on("all", (_event, filePath) => {
    if (
      filePath === REGISTRY_JSON ||
      (filePath.startsWith(`${REGISTRY_SRC}${path.sep}`) &&
        filePath.endsWith(".tsx"))
    )
      scheduleRebuild();
  });

  server.listen(PORT, () => {
    console.log(`Dashboard server on http://localhost:${PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error("the dashboard server failed to start", error);
  process.exitCode = 1;
});
