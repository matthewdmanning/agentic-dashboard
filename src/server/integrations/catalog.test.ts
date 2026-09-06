import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  createFileIntegrationCatalog,
  dynamicIntegrationEntry,
} from "./catalog";

async function temporaryPath(): Promise<string> {
  return join(
    await mkdtemp(join(tmpdir(), "integration-catalog-")),
    "catalog.json",
  );
}

describe("file integration catalog", () => {
  test("seeds shared default and recommended entries with no connections", async () => {
    const path = await temporaryPath();
    const catalog = createFileIntegrationCatalog(path);

    const entries = await catalog.read();
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: "default", state: "available" }),
        expect.objectContaining({ origin: "recommended", state: "available" }),
      ]),
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(entries);
  });

  test("persists a dynamic entry without accepting credential fields", async () => {
    const path = await temporaryPath();
    const catalog = createFileIntegrationCatalog(path);
    await catalog.add(
      dynamicIntegrationEntry({
        id: "dynamic-service",
        type: "dynamic-service",
        settings: { region: "test" },
      }),
    );

    await expect(catalog.read()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dynamic-service", origin: "dynamic" }),
      ]),
    );
    await expect(
      catalog.add(
        dynamicIntegrationEntry({
          id: "secret-service",
          type: "dynamic-service",
          settings: { apiKey: "not-allowed" },
        }),
      ),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).not.toContain("not-allowed");
  });
});
