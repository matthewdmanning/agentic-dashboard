import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test, vi } from "vitest";

import {
  createSecretBox,
  deriveKeyId,
  resolveManagedSecretKeyRing,
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

describe("resolveManagedSecretKeyRing (#98)", () => {
  function keyRingFile(key: Buffer, createdAt = new Date()) {
    return {
      currentKeyId: deriveKeyId(key),
      currentKeyCreatedAt: createdAt.toISOString(),
      keys: { [deriveKeyId(key)]: key.toString("hex") },
    };
  }

  test("fetches the ring over HTTPS and the resulting box round-trips", async () => {
    const key = randomBytes(32);
    const fetchImpl = vi.fn(async () => Response.json(keyRingFile(key)));

    const ring = await resolveManagedSecretKeyRing(
      "https://secrets.example/ring",
      undefined,
      fetchImpl,
    );
    const box = createSecretBox(ring);
    const sealed = await box.seal("alice", "top secret");
    await expect(box.open("alice", sealed)).resolves.toBe("top secret");
  });

  test("sends a bearer token when given, omits the header otherwise", async () => {
    const key = randomBytes(32);
    const fetchImpl = vi.fn(async () => Response.json(keyRingFile(key)));

    await resolveManagedSecretKeyRing(
      "https://secrets.example/ring",
      "s3cr3t",
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://secrets.example/ring",
      expect.objectContaining({
        headers: { authorization: "Bearer s3cr3t" },
      }),
    );

    fetchImpl.mockClear();
    await resolveManagedSecretKeyRing(
      "https://secrets.example/ring",
      undefined,
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://secrets.example/ring",
      expect.objectContaining({ headers: undefined }),
    );
  });

  test("a non-ok response throws", async () => {
    await expect(
      resolveManagedSecretKeyRing(
        "https://secrets.example/ring",
        undefined,
        async () => new Response("unavailable", { status: 503 }),
      ),
    ).rejects.toThrow();
  });

  test("a malformed body throws via the existing key-ring schema", async () => {
    await expect(
      resolveManagedSecretKeyRing(
        "https://secrets.example/ring",
        undefined,
        async () => Response.json({ not: "a key ring" }),
      ),
    ).rejects.toThrow();
  });

  test("still opens a value sealed under a non-current key (managed service already rotated once)", async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const sealed = await createSecretBox(oldKey).seal("alice", "top secret");
    const file = {
      currentKeyId: deriveKeyId(newKey),
      currentKeyCreatedAt: new Date().toISOString(),
      keys: {
        [deriveKeyId(oldKey)]: oldKey.toString("hex"),
        [deriveKeyId(newKey)]: newKey.toString("hex"),
      },
    };

    const ring = await resolveManagedSecretKeyRing(
      "https://secrets.example/ring",
      undefined,
      async () => Response.json(file),
    );

    await expect(createSecretBox(ring).open("alice", sealed)).resolves.toBe(
      "top secret",
    );
  });

  test("rejects a non-https URL before ever fetching", async () => {
    const fetchImpl = vi.fn();

    await expect(
      resolveManagedSecretKeyRing(
        "http://secrets.example/ring",
        undefined,
        fetchImpl,
      ),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("the fetch receives an abort signal (startup timeout wiring)", async () => {
    const key = randomBytes(32);
    const fetchImpl = vi.fn(async () => Response.json(keyRingFile(key)));

    await resolveManagedSecretKeyRing(
      "https://secrets.example/ring",
      undefined,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://secrets.example/ring",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
