import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURE_DIR = path.join(REPO_ROOT, "test-dashboard-config");

/**
 * `test-dashboard-config/` is the starting state every run shares, so a run
 * must not be able to change it: a check that edits the fixture it started
 * from stops being repeatable, and the next run inherits the last one's
 * leftovers. Specs mutate a copy, and the originals are hashed before and
 * after to prove nothing reached them.
 */
const hashFixture = (): string => {
  const digest = createHash("sha256");
  const entries = readdirSync(FIXTURE_DIR, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  for (const file of entries) {
    digest.update(path.relative(FIXTURE_DIR, file));
    digest.update(readFileSync(file));
  }
  return digest.digest("hex");
};

/** Returns its own teardown, so the before-hash stays in scope rather than crossing a module boundary. */
export default function seedWorkspace(): () => void {
  const before = hashFixture();

  const workspace = path.join(
    REPO_ROOT,
    process.env.DASHBOARD_WORKSPACE ?? ".e2e-workspace",
  );
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  cpSync(FIXTURE_DIR, workspace, { recursive: true });
  // Documentation, not dashboard state — the app would ignore it, but a copy
  // of it sitting in a workspace invites someone to treat it as one.
  rmSync(path.join(workspace, "README.md"), { force: true });

  return () => {
    const after = hashFixture();
    if (after !== before) {
      throw new Error(
        `test-dashboard-config/ changed during the run (${before.slice(0, 12)} -> ${after.slice(0, 12)}). ` +
          "Specs must mutate the copied workspace, never the fixture.",
      );
    }
  };
}
