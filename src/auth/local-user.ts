import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * How a caller proves it is the local user (D35) — the OS account running the
 * server, which holds every permission because it can edit the roles file, the
 * dashboard data, and the source anyway.
 *
 * Binding to `127.0.0.1` proves the caller is on the same *machine*, not that
 * it is the same *user*: on a multi-user host any other OS account can reach
 * loopback. The proof is a random token written to a file only the owning user
 * can read (mode 0600). Reading that file is the check — the filesystem does
 * the work, not this module.
 *
 * Two kinds of caller, one token:
 *
 * - `mcp` runs over stdio as a child process, so it is already the local user
 *   by construction, and reads the token file directly.
 * - a browser cannot read files, so the server prints the URL carrying the
 *   token on startup. Only whoever can see the server's own stdout gets it —
 *   the same user again. This is how Jupyter authenticates a local notebook.
 *
 * Each platform restricts the file its own way — see `restrictToOwner`.
 */

/**
 * Leaves the token readable by its owner and nobody else.
 *
 * POSIX: `chmod` to 0600.
 *
 * Windows: `chmod` there only maps onto the read-only flag, so it grants
 * nothing — a token written with mode 0600 still lands world-readable. `icacls`
 * sets a real ACL instead: `/inheritance:r` drops the entries inherited from
 * the parent directory, and `/grant:r` then names this account as the only one
 * with access.
 *
 * A failure here is reported and not thrown. The dashboard still runs and the
 * token still authenticates; what is lost is the file's protection, which
 * matters only where another account shares the machine.
 */
export async function restrictToOwner(path: string): Promise<void> {
  try {
    if (process.platform !== "win32") {
      await chmod(path, 0o600);
      return;
    }
    await execFileAsync("icacls", [
      path,
      "/inheritance:r",
      "/grant:r",
      `${userInfo().username}:F`,
    ]);
  } catch (error) {
    process.stderr.write(
      `Could not restrict ${path} to this account: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

export async function provisionLocalUserToken(path: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(path), { recursive: true });
  // `writeFile`'s own mode applies only when it creates the file, so an
  // existing one keeps whatever it had — `restrictToOwner` is what settles it.
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await restrictToOwner(path);
  return token;
}

export async function readLocalUserToken(
  path: string,
): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Constant-time, so a wrong guess leaks nothing about how wrong it was. */
export function isLocalUserToken(
  candidate: string | undefined,
  token: string | undefined,
): boolean {
  if (candidate === undefined || token === undefined) return false;
  const offered = Buffer.from(candidate);
  const expected = Buffer.from(token);
  return (
    offered.length === expected.length && timingSafeEqual(offered, expected)
  );
}
