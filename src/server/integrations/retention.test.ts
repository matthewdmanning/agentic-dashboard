import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createSecretBox } from "../secret-box";
import { createEncryptedConnectionStore } from "./connections";
import {
  createFileIntegrationCatalog,
  dynamicIntegrationEntry,
} from "./catalog";
import { reconcileIntegrationRetention } from "./retention";

const retentionDays = 30;

async function testCatalogPath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "retention-catalog-")),
    "catalog.json",
  );
}

async function testConnectionsPath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "retention-connections-")),
    "connections.json",
  );
}

describe("integration retention reconciliation", () => {
  test("a disconnected recommended entry remains indefinitely", async () => {
    const catalog = createFileIntegrationCatalog(await testCatalogPath());
    const connections = createEncryptedConnectionStore(
      await testConnectionsPath(),
      createSecretBox(randomBytes(32)),
    );
    // Seeded entries are default/recommended, zero connections, from the start.
    const before = await catalog.read();

    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    );

    await expect(catalog.read()).resolves.toEqual(before);
  });

  test("a dynamic entry with no connections starts an unused clock instead of being removed immediately", async () => {
    const catalog = createFileIntegrationCatalog(await testCatalogPath());
    const connections = createEncryptedConnectionStore(
      await testConnectionsPath(),
      createSecretBox(randomBytes(32)),
    );
    await catalog.add(
      dynamicIntegrationEntry({
        id: "dynamic-service",
        type: "dynamic-service",
        settings: {},
      }),
    );

    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      new Date(),
    );

    const entries = await catalog.read();
    const entry = entries.find(({ id }) => id === "dynamic-service");
    expect(entry?.unusedSince).toBeDefined();
  });

  test("a dynamic entry is removed once its unused clock passes the retention period", async () => {
    const catalog = createFileIntegrationCatalog(await testCatalogPath());
    const connections = createEncryptedConnectionStore(
      await testConnectionsPath(),
      createSecretBox(randomBytes(32)),
    );
    await catalog.add(
      dynamicIntegrationEntry({
        id: "dynamic-service",
        type: "dynamic-service",
        settings: {},
      }),
    );
    const start = new Date("2026-01-01T00:00:00.000Z");
    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      start,
    );

    const beforeDeadline = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 29);
    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      beforeDeadline,
    );
    await expect(catalog.read()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dynamic-service" }),
      ]),
    );

    const afterDeadline = new Date(start.getTime() + 1000 * 60 * 60 * 24 * 31);
    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      afterDeadline,
    );
    const remaining = await catalog.read();
    expect(
      remaining.find(({ id }) => id === "dynamic-service"),
    ).toBeUndefined();
  });

  test("reconnecting before expiry cancels the unused clock", async () => {
    const catalog = createFileIntegrationCatalog(await testCatalogPath());
    const connections = createEncryptedConnectionStore(
      await testConnectionsPath(),
      createSecretBox(randomBytes(32)),
    );
    await catalog.add(
      dynamicIntegrationEntry({
        id: "dynamic-service",
        type: "dynamic-service",
        settings: {},
      }),
    );
    const start = new Date("2026-01-01T00:00:00.000Z");
    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      start,
    );
    let entries = await catalog.read();
    expect(
      entries.find(({ id }) => id === "dynamic-service")?.unusedSince,
    ).toBeDefined();

    await connections.set("alice", "dynamic-service", "alice-secret");
    await reconcileIntegrationRetention(
      { catalog, connections },
      retentionDays,
      new Date(start.getTime() + 1000 * 60 * 60 * 24 * 60),
    );

    entries = await catalog.read();
    const entry = entries.find(({ id }) => id === "dynamic-service");
    expect(entry).toBeDefined();
    expect(entry?.unusedSince).toBeUndefined();
  });
});
