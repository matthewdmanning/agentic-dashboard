import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { loadE2EConfig } from "./config";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * `dry-run/workspace/` is the committed starting state. Each test run gets a
 * unique copy so a check that edits its fixture cannot affect another run,
 * and the original is hashed before and after to prove nothing reached it.
 */
const hashFixture = (fixtureDir: string): string => {
  const digest = createHash("sha256");
  const entries = readdirSync(fixtureDir, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  for (const file of entries) {
    digest.update(path.relative(fixtureDir, file));
    digest.update(readFileSync(file));
  }
  return digest.digest("hex");
};

/** Returns its own teardown, so the before-hash stays in scope rather than crossing a module boundary. */
export default function seedWorkspace(): () => void {
  const config = loadE2EConfig();
  const fixtureDir = path.resolve(REPO_ROOT, config.fixtureDirectory);
  const workspace = process.env.E2E_RUN_WORKSPACE;
  if (!workspace)
    throw new Error(
      "E2E_RUN_WORKSPACE must be initialized by playwright.config.ts",
    );

  const before = hashFixture(fixtureDir);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  cpSync(fixtureDir, workspace, { recursive: true });
  for (const entry of config.excludeFromWorkspace)
    rmSync(path.join(workspace, entry), { force: true });
  for (const file of config.supportingFiles) {
    const destination = path.join(workspace, file.target);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.resolve(REPO_ROOT, file.source), destination);
  }

  return () => {
    try {
      const after = hashFixture(fixtureDir);
      if (after !== before)
        throw new Error(
          `test fixture changed during the run (${before.slice(0, 12)} -> ${after.slice(0, 12)}). ` +
            "Specs must mutate the copied workspace, never the fixture.",
        );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  };
}
