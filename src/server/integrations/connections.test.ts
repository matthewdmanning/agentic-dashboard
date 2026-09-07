import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createSecretBox } from "../secret-box";
import {
  connectionIdentity,
  createEncryptedConnectionStore,
} from "./connections";

async function tempConnectionsPath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "connections-")),
    "connections.json",
  );
}

describe("encrypted connection store", () => {
  test("two users connect to the same catalog entry with different credentials, and both work", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );

    await store.set("alice", "team-calendar", "alice-secret");
    await store.set("bob", "team-calendar", "bob-secret");

    await expect(store.get("alice", "team-calendar")).resolves.toBe(
      "alice-secret",
    );
    await expect(store.get("bob", "team-calendar")).resolves.toBe("bob-secret");
  });

  test("one user's connection is invisible under another user's identity", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );
    await store.set("alice", "team-calendar", "alice-secret");

    await expect(store.get("bob", "team-calendar")).resolves.toBeUndefined();
  });

  test("the stored file contains no plaintext credential", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );

    await store.set("alice", "team-calendar", "very-secret-token-xyz");

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("very-secret-token-xyz");
    // The envelope stays cleartext -- owner and catalog entry are not secrets.
    expect(raw).toContain("alice");
    expect(raw).toContain("team-calendar");
  });

  test("disconnecting removes only the caller's own credential, leaving another user's connection to the same entry intact", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );
    await store.set("alice", "team-calendar", "alice-secret");
    await store.set("bob", "team-calendar", "bob-secret");

    await store.remove("alice", "team-calendar");

    await expect(store.get("alice", "team-calendar")).resolves.toBeUndefined();
    await expect(store.get("bob", "team-calendar")).resolves.toBe("bob-secret");
  });

  test("reconnecting replaces the caller's previous credential for that entry", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );
    await store.set("alice", "team-calendar", "old-secret");
    await store.set("alice", "team-calendar", "new-secret");

    await expect(store.get("alice", "team-calendar")).resolves.toBe(
      "new-secret",
    );
  });

  test("removeAllForEntry destroys every user's connection to that entry, leaving other entries and no ciphertext behind", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );
    await store.set("alice", "team-calendar", "alice-secret-token");
    await store.set("bob", "team-calendar", "bob-secret-token");
    await store.set("alice", "personal-calendar", "unrelated-secret");

    await store.removeAllForEntry("team-calendar");

    await expect(store.get("alice", "team-calendar")).resolves.toBeUndefined();
    await expect(store.get("bob", "team-calendar")).resolves.toBeUndefined();
    await expect(store.get("alice", "personal-calendar")).resolves.toBe(
      "unrelated-secret",
    );

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("alice-secret-token");
    expect(raw).not.toContain("bob-secret-token");
  });

  test("countForEntry counts connections across users, per catalog entry", async () => {
    const path = await tempConnectionsPath();
    const store = createEncryptedConnectionStore(
      path,
      createSecretBox(randomBytes(32)),
    );
    await store.set("alice", "team-calendar", "alice-secret");
    await store.set("bob", "team-calendar", "bob-secret");
    await store.set("alice", "personal-calendar", "unrelated-secret");

    await expect(store.countForEntry("team-calendar")).resolves.toBe(2);
    await expect(store.countForEntry("personal-calendar")).resolves.toBe(1);
    await expect(store.countForEntry("unknown-entry")).resolves.toBe(0);

    await store.remove("alice", "team-calendar");
    await expect(store.countForEntry("team-calendar")).resolves.toBe(1);
  });

  test("a credential sealed for one user fails to open under another user's identity", async () => {
    const secretBox = createSecretBox(randomBytes(32));
    const sealed = await secretBox.seal(
      connectionIdentity("alice", "team-calendar"),
      "alice-secret",
    );

    await expect(
      secretBox.open(connectionIdentity("bob", "team-calendar"), sealed),
    ).rejects.toThrow();
  });

  test("a credential sealed for one catalog entry fails to open under a different entry, for the same user", async () => {
    const secretBox = createSecretBox(randomBytes(32));
    const sealed = await secretBox.seal(
      connectionIdentity("alice", "team-calendar"),
      "alice-secret",
    );

    await expect(
      secretBox.open(connectionIdentity("alice", "personal-calendar"), sealed),
    ).rejects.toThrow();
  });
});
