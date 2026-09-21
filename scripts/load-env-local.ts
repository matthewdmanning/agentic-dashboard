import path from "node:path";

/**
 * Loads `.env.local` then `.env` into `process.env`, matching the effective
 * precedence of `dev`/`mcp`'s `--env-file-if-exists=.env
 * --env-file-if-exists=.env.local` (later flag wins, so `.env.local`
 * overrides `.env`). `process.loadEnvFile` never overwrites a key already
 * set, so loading `.env.local` first reproduces that same precedence.
 * Either file may be absent; a missing file is silently skipped.
 */
export function loadEnvLocal(repoRoot: string): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(repoRoot, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
