import { spawnSync } from "node:child_process";
import path from "node:path";

import { APP_ROOT, seedWorkspace } from "../src/workspace";
import { generateSchemas } from "./registry-schemas";

const workspace = seedWorkspace();
generateSchemas(workspace);

const shadcn = path.join(APP_ROOT, "node_modules/shadcn/dist/index.js");
const result = spawnSync(process.execPath, [shadcn, "build"], {
  cwd: workspace,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
