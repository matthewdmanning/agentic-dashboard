import { join, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createFileAuthStore } from "../auth";
import { createFilePersistence, createService } from "../service";
import { createDashboardMcpServer } from "./server";

const workspace = resolve(process.env.DASHBOARD_WORKSPACE ?? process.cwd());
const dashboardPath =
  process.env.DASHBOARD_DATA_PATH ??
  join(workspace, ".dashboard", "dashboard.json");
const authStorePath =
  process.env.DASHBOARD_AUTH_STORE_PATH ??
  join(workspace, ".dashboard", "accounts.json");
// No local-user token here, deliberately (D35). It exists to tell callers
// apart on a loopback port, where any OS account on the host can connect. This
// process speaks over stdio and has no port: spawning it already required being
// the OS user running the dashboard, so the caller is the local user by
// construction and there is nothing further to prove.
const service = createService({
  persistence: createFilePersistence(dashboardPath),
  authStore: createFileAuthStore(authStorePath),
});

void serveStdio(() => createDashboardMcpServer(service));
