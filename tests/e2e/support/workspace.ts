import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { loadE2EConfig } from "./config";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

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

/**
 * Returns its own teardown, so the before-hash stays in scope rather than
 * crossing a module boundary. The workspace itself is already seeded by
 * `playwright.config.ts` by the time this runs — Playwright starts
 * `webServer` before `globalSetup`, so seeding here would race the
 * already-running server's own build of that same directory.
 */
export default function seedWorkspace(): () => void {
  const config = loadE2EConfig();
  const fixtureDir = path.resolve(REPO_ROOT, config.fixtureDirectory);
  const workspace = process.env.E2E_RUN_WORKSPACE;
  if (!workspace)
    throw new Error(
      "E2E_RUN_WORKSPACE must be initialized by playwright.config.ts",
    );

  const before = hashFixture(fixtureDir);

  return () => {
    try {
      const after = hashFixture(fixtureDir);
      if (after !== before)
        throw new Error(
          `test fixture changed during the run (${before.slice(0, 12)} -> ${after.slice(0, 12)}). ` +
            "Specs must mutate the copied workspace, never the fixture.",
        );
    } finally {
      // maxRetries/retryDelay: on Windows, a just-stopped webServer process
      // can still hold a file handle or watch on this directory for a moment
      // after Playwright reports it stopped — plain rmSync then fails with
      // EPERM. Node retries these exact errors (EBUSY, EPERM, ENOTEMPTY,
      // ...) itself when asked to; POSIX systems never hit them, so this is
      // a no-op there.
      rmSync(workspace, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  };
}
