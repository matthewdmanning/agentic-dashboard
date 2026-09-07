import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { rotateSecretKeyIfDue } from "./key-rotation";
import { createSecretBox, resolveSecretKeyRing } from "./secret-box";
import { createEncryptedConnectionStore } from "./integrations/connections";
import { createEncryptedQueryStore } from "../service/queries";

async function tempPaths() {
  const dir = await mkdtemp(join(tmpdir(), "key-rotation-"));
  return {
    keyRingPath: join(dir, "secret-keys.json"),
    connectionsPath: join(dir, "connections.json"),
    queriesPath: join(dir, "queries.json"),
  };
}

describe("rotateSecretKeyIfDue (#91)", () => {
  test("is a no-op before the current key's age reaches the interval", async () => {
    const paths = await tempPaths();
    const initial = await resolveSecretKeyRing(paths.keyRingPath);

    const result = await rotateSecretKeyIfDue(paths, 90, new Date());

    expect(result.rotated).toBe(false);
    expect(result.ring.currentKeyId).toBe(initial.currentKeyId);
  });

  test("a completed rotation re-encrypts every connection and query onto the new key, and drops the old one", async () => {
    const paths = await tempPaths();
    const initialRing = await resolveSecretKeyRing(paths.keyRingPath);
    const initialBox = createSecretBox(initialRing);
    const connections = createEncryptedConnectionStore(
      paths.connectionsPath,
      initialBox,
    );
    const queries = createEncryptedQueryStore(paths.queriesPath, initialBox);
    await connections.set("alice", "team-calendar", "alice-secret-token");
    await queries.add("alice", {
      id: "q1",
      cardId: "card-1",
      cardMapper: "identity",
      integration: "team-calendar",
      query: { calendarId: "team" },
    });

    const due = new Date(
      initialRing.currentKeyCreatedAt.getTime() + 91 * 24 * 60 * 60 * 1000,
    );
    const result = await rotateSecretKeyIfDue(paths, 90, due);

    expect(result.rotated).toBe(true);
    expect(result.ring.currentKeyId).not.toBe(initialRing.currentKeyId);
    expect(result.ring.keys.has(initialRing.currentKeyId)).toBe(false);
    expect([...result.ring.keys.keys()]).toEqual([result.ring.currentKeyId]);

    // The credential and query are still readable, now under the new key --
    // read through fresh stores built from the post-rotation ring, exactly
    // as a restarted server would.
    const newBox = createSecretBox(result.ring);
    const rotatedConnections = createEncryptedConnectionStore(
      paths.connectionsPath,
      newBox,
    );
    const rotatedQueries = createEncryptedQueryStore(
      paths.queriesPath,
      newBox,
    );
    await expect(
      rotatedConnections.get("alice", "team-calendar"),
    ).resolves.toBe("alice-secret-token");
    await expect(rotatedQueries.list("alice")).resolves.toEqual([
      expect.objectContaining({ id: "q1", integration: "team-calendar" }),
    ]);

    const rawConnections = JSON.parse(
      await readFile(paths.connectionsPath, "utf8"),
    );
    const rawQueries = JSON.parse(await readFile(paths.queriesPath, "utf8"));
    expect(rawConnections[0].sealed.keyId).toBe(result.ring.currentKeyId);
    expect(rawQueries[0].sealed.keyId).toBe(result.ring.currentKeyId);
    expect(JSON.stringify(rawConnections)).not.toContain(
      "alice-secret-token",
    );
  });

  test("a record that fails to re-encrypt keeps its original seal, and its old key stays in the ring", async () => {
    const paths = await tempPaths();
    const initialRing = await resolveSecretKeyRing(paths.keyRingPath);
    const initialBox = createSecretBox(initialRing);
    const connections = createEncryptedConnectionStore(
      paths.connectionsPath,
      initialBox,
    );
    await connections.set("alice", "team-calendar", "alice-secret-token");
    // Corrupt the stored ciphertext directly, simulating a record that will
    // fail GCM authentication (and so fail re-encryption) without touching
    // its recorded `keyId` -- rotation must leave a record like this alone.
    const before = JSON.parse(
      await readFile(paths.connectionsPath, "utf8"),
    );
    before[0].sealed.ciphertext = before[0].sealed.ciphertext.replace(
      /.$/,
      before[0].sealed.ciphertext.endsWith("0") ? "1" : "0",
    );
    await writeFile(
      paths.connectionsPath,
      `${JSON.stringify(before, null, 2)}\n`,
    );

    const due = new Date(
      initialRing.currentKeyCreatedAt.getTime() + 91 * 24 * 60 * 60 * 1000,
    );
    const result = await rotateSecretKeyIfDue(paths, 90, due);

    expect(result.rotated).toBe(true);
    // The failed record's old key is still needed, so it must survive.
    expect(result.ring.keys.has(initialRing.currentKeyId)).toBe(true);

    const rawConnections = JSON.parse(
      await readFile(paths.connectionsPath, "utf8"),
    );
    expect(rawConnections[0].sealed.keyId).toBe(initialRing.currentKeyId);
    expect(rawConnections[0].sealed.ciphertext).toBe(
      before[0].sealed.ciphertext,
    );
  });
});
