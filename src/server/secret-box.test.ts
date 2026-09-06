import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { createSecretBox, resolveSecretKey } from "./secret-box";

const execFileAsync = promisify(execFile);

async function keyPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "secret-key-")), "secret.key");
}

describe("secret box", () => {
  test("opens under the same owner it was sealed for", async () => {
    const box = createSecretBox(randomBytes(32));
    const sealed = await box.seal("alice", "top secret");
    await expect(box.open("alice", sealed)).resolves.toBe("top secret");
  });

  test("fails to decrypt a secret sealed for another owner", async () => {
    const box = createSecretBox(randomBytes(32));
    const sealed = await box.seal("alice", "top secret");
    // Ownership is bound as AEAD data, not derived into a per-user key — a
    // wrong owner fails the same authentication check tampering would (D41).
    await expect(box.open("bob", sealed)).rejects.toThrow();
  });

  test("fails to decrypt a tampered ciphertext", async () => {
    const box = createSecretBox(randomBytes(32));
    const sealed = await box.seal("alice", "top secret");
    const tampered = { ...sealed, ciphertext: sealed.ciphertext.replace(/.$/, sealed.ciphertext.endsWith("0") ? "1" : "0") };
    await expect(box.open("alice", tampered)).rejects.toThrow();
  });
});

describe("resolveSecretKey", () => {
  test("restricts a generated key file to this account, however the platform spells that", async () => {
    const path = await keyPath();
    await resolveSecretKey(path);

    if (process.platform === "win32") {
      // `icacls` should have dropped the inherited entries and left this
      // account as the only one named.
      const { stdout } = await execFileAsync("icacls", [path]);
      const granted = stdout
        .split("\n")
        .flatMap((line) => [...line.matchAll(/([^\s:]+(?:\\[^\s:]+)?):\(/g)])
        .map(([, account]) => account);

      expect(granted.length).toBeGreaterThan(0);
      const username = userInfo().username.toLowerCase();
      for (const account of granted) {
        expect(account.toLowerCase()).toContain(username);
      }
    } else {
      const { mode } = await stat(path);
      expect(mode & 0o777).toBe(0o600);
    }
  });

  test("two concurrent calls against a missing file agree on one key", async () => {
    const path = await keyPath();

    // Both see ENOENT and race to generate — the exclusive write means only
    // one can actually create the file; if the loser overwrote it instead of
    // reading it back, this would fail intermittently rather than reliably.
    const [first, second] = await Promise.all([
      resolveSecretKey(path),
      resolveSecretKey(path),
    ]);

    expect(first.equals(second)).toBe(true);
  });
});
