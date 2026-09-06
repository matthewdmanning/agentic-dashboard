import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createSecretBox, type SecretBox } from "../server/secret-box";
import { createEncryptedQueryStore, type StoredQuery } from "./queries";

async function tempQueriesPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "queries-")), "queries.json");
}

const query: StoredQuery = {
  id: "q1",
  cardId: "card-1",
  cardMapper: "events",
  integration: "very-secret-integration-id",
  query: { search: "very-secret-search-term" },
};

describe("encrypted query store", () => {
  test("the stored file holds no plaintext integration reference or query parameters", async () => {
    const path = await tempQueriesPath();
    const store = createEncryptedQueryStore(path, createSecretBox(randomBytes(32)));

    await store.add("alice", query);

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("very-secret-integration-id");
    expect(raw).not.toContain("very-secret-search-term");
    // The envelope stays cleartext — it names none of what D31 protects.
    expect(raw).toContain("events");
    expect(raw).toContain("card-1");
  });

  test("reference counting reads the envelope only and never decrypts", async () => {
    const path = await tempQueriesPath();
    const workingBox = createSecretBox(randomBytes(32));
    // A box whose `open` always throws: if reference counting ever called
    // it, this test would fail instead of merely trusting a comment.
    const noOpenBox: SecretBox = {
      seal: (owner, plaintext) => workingBox.seal(owner, plaintext),
      open: () => {
        throw new Error("reference counting must not decrypt");
      },
    };
    const store = createEncryptedQueryStore(path, noOpenBox);

    await store.add("alice", query);

    await expect(store.isReferencedByAnyQuery("events")).resolves.toBe(true);
    await expect(store.isReferencedByAnyQuery("other")).resolves.toBe(false);
  });

  test("two users' queries live in one store and each reads only their own", async () => {
    const path = await tempQueriesPath();
    const store = createEncryptedQueryStore(path, createSecretBox(randomBytes(32)));

    await store.add("alice", query);
    await store.add("bob", { ...query, id: "q2" });

    await expect(store.list("alice")).resolves.toEqual([query]);
    await expect(store.list("bob")).resolves.toEqual([{ ...query, id: "q2" }]);
  });

  test("removing another user's query by id never decrypts its contents", async () => {
    const path = await tempQueriesPath();
    const workingBox = createSecretBox(randomBytes(32));
    const noOpenBox: SecretBox = {
      seal: (owner, plaintext) => workingBox.seal(owner, plaintext),
      open: () => {
        throw new Error("remove must not decrypt");
      },
    };
    const store = createEncryptedQueryStore(path, noOpenBox);
    await store.add("alice", query);

    await expect(store.remove("alice", "q1")).resolves.toBe(true);
    await expect(store.list("alice")).resolves.toEqual([]);
  });
});
