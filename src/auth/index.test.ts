import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  createFileAuthStore,
  encodeUserPathSegment,
  hashCredential,
} from "./index";

describe("auth store", () => {
  test("resolves distinct users with the same role", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-store-"));
    const path = join(directory, "accounts.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          user: "alice",
          role: "reader",
          salt: "first-salt",
          hash: await hashCredential("credential", "first-salt"),
        },
        {
          user: "bob",
          role: "reader",
          salt: "second-salt",
          hash: await hashCredential("other", "second-salt"),
        },
      ]),
    );

    const store = createFileAuthStore(path);

    await expect(store.resolve("credential")).resolves.toEqual({
      user: "alice",
      role: "reader",
    });
    await expect(store.resolve("other")).resolves.toEqual({
      user: "bob",
      role: "reader",
    });
    await expect(store.resolve("missing")).resolves.toBeUndefined();
  });

  test("accepts a valid credential and rejects an invalid one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-store-"));
    const path = join(directory, "accounts.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          user: "alice",
          role: "reader",
          salt: "salt",
          hash: await hashCredential("credential", "salt"),
        },
      ]),
    );
    const store = createFileAuthStore(path);
    await expect(store.resolve("credential")).resolves.toEqual({
      user: "alice",
      role: "reader",
    });
    await expect(store.resolve("wrong")).resolves.toBeUndefined();
  });

  test("persisted records contain no plaintext credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-store-"));
    const path = join(directory, "accounts.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          user: "alice",
          role: "reader",
          salt: "salt",
          hash: await hashCredential("credential", "salt"),
        },
      ]),
    );
    const persisted = await readFile(path, "utf8");
    expect(persisted).not.toContain("credential");
    expect(JSON.parse(persisted)[0]).not.toHaveProperty("credential");
  });

  test("treats a missing auth store as having no accounts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-store-"));
    const store = createFileAuthStore(join(directory, "accounts.json"));

    await expect(store.resolve("credential")).resolves.toBeUndefined();
  });

  test("rejects ambiguous credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-store-"));
    const path = join(directory, "accounts.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          user: "alice",
          role: "reader",
          salt: "first-salt",
          hash: await hashCredential("credential", "first-salt"),
        },
        {
          user: "bob",
          role: "localUser",
          salt: "first-salt",
          hash: await hashCredential("credential", "first-salt"),
        },
      ]),
    );

    await expect(
      createFileAuthStore(path).resolve("credential"),
    ).rejects.toThrow("duplicate credential");
  });

  test("encodes every user as one distinct safe filesystem segment", () => {
    const encoded = ["../alice", "alice/bob", ".", "..", "Alice", "alice"].map(
      encodeUserPathSegment,
    );
    expect(new Set(encoded).size).toBe(encoded.length);
    for (const segment of encoded) {
      expect(segment).toMatch(/^[0-9a-f]+$/);
      expect(segment).not.toContain("/");
      expect(segment).not.toContain("\\");
      expect(segment).not.toBe(".");
      expect(segment).not.toBe("..");
    }
    expect(encoded[4].toLowerCase()).not.toBe(encoded[5].toLowerCase());
  });
});
