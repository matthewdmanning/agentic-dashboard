import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import {
  createSecretBox,
  deriveKeyId,
  resolveSecretKeyRing,
  singleKeyRing,
  withNewCurrentKey,
  withoutKey,
} from "./secret-box";

const execFileAsync = promisify(execFile);

async function keyRingPath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "secret-key-ring-")),
    "secret-keys.json",
  );
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
    const tampered = {
      ...sealed,
      ciphertext: sealed.ciphertext.replace(
        /.$/,
        sealed.ciphertext.endsWith("0") ? "1" : "0",
      ),
    };
    await expect(box.open("alice", tampered)).rejects.toThrow();
  });

  test("records which key sealed a value", async () => {
    const key = randomBytes(32);
    const box = createSecretBox(key);
    const sealed = await box.seal("alice", "top secret");
    expect(sealed.keyId).toBe(deriveKeyId(key));
  });
});

describe("secret key ring (#91)", () => {
  test("a ring can still open a value sealed under a retired key it still carries", async () => {
    const oldKey = randomBytes(32);
    const ring = singleKeyRing(oldKey);
    const oldBox = createSecretBox(ring);
    const sealed = await oldBox.seal("alice", "top secret");

    const newKey = randomBytes(32);
    const rotatedRing = withNewCurrentKey(
      ring,
      deriveKeyId(newKey),
      newKey,
      new Date(),
    );
    const rotatedBox = createSecretBox(rotatedRing);

    await expect(rotatedBox.open("alice", sealed)).resolves.toBe("top secret");
    // New seals land on the new key, not the retired one.
    const resealed = await rotatedBox.seal("alice", "top secret");
    expect(resealed.keyId).toBe(deriveKeyId(newKey));
  });

  test("dropping a key from the ring makes a value sealed under it unopenable", async () => {
    const oldKey = randomBytes(32);
    const ring = singleKeyRing(oldKey);
    const sealed = await createSecretBox(ring).seal("alice", "top secret");

    const newKey = randomBytes(32);
    const newKeyId = deriveKeyId(newKey);
    const rotatedRing = withNewCurrentKey(ring, newKeyId, newKey, new Date());
    const finalRing = withoutKey(rotatedRing, deriveKeyId(oldKey));

    await expect(
      createSecretBox(finalRing).open("alice", sealed),
    ).rejects.toThrow();
  });

  test("withoutKey refuses to drop the current key", () => {
    const key = randomBytes(32);
    const ring = singleKeyRing(key);

    expect(withoutKey(ring, ring.currentKeyId)).toEqual(ring);
  });
});

describe("resolveSecretKeyRing", () => {
  test("restricts a generated ring file to this account, however the platform spells that", async () => {
    const path = await keyRingPath();
    await resolveSecretKeyRing(path);

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

  test("two concurrent calls against a missing file agree on one ring", async () => {
    const path = await keyRingPath();

    // Both see ENOENT and race to generate — the exclusive write means only
    // one can actually create the file; if the loser overwrote it instead of
    // reading it back, this would fail intermittently rather than reliably.
    const [first, second] = await Promise.all([
      resolveSecretKeyRing(path),
      resolveSecretKeyRing(path),
    ]);

    expect(first.currentKeyId).toBe(second.currentKeyId);
    expect(first.keys.get(first.currentKeyId)).toEqual(
      second.keys.get(second.currentKeyId),
    );
  });

  test("persists no plaintext key material outside the generated ring's own hex encoding", async () => {
    const path = await keyRingPath();
    const ring = await resolveSecretKeyRing(path);

    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.currentKeyId).toBe(ring.currentKeyId);
    expect(typeof raw.keys[ring.currentKeyId]).toBe("string");
  });
});
