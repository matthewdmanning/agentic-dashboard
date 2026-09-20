import { spawnSync } from "node:child_process";
import path from "node:path";

import ts from "typescript";

import { APP_ROOT, seedWorkspace } from "../src/workspace";
import { generateSchemas } from "./registry-schemas";

const workspace = seedWorkspace();
generateSchemas(APP_ROOT);
generateSchemas(workspace);

const tsc = path.join(APP_ROOT, "node_modules/typescript/bin/tsc");
const appResult = spawnSync(process.execPath, [tsc, "--noEmit"], {
  cwd: APP_ROOT,
  stdio: "inherit",
});
if (appResult.error) throw appResult.error;
if (appResult.status !== 0) process.exit(appResult.status ?? 1);

const configPath = path.join(workspace, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
  console.error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, workspace);
const options: ts.CompilerOptions = {
  ...parsed.options,
  baseUrl: workspace,
  typeRoots: [
    path.join(workspace, "node_modules/@types"),
    path.join(APP_ROOT, "node_modules/@types"),
  ],
};
const program = ts.createProgram(parsed.fileNames, options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length > 0) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => workspace,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
}
