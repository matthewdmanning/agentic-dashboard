import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  integrationCatalogEntrySchema,
  type IntegrationCatalogEntry,
} from "../../contract";
import { defaultIntegrationCatalog } from "./catalog-data";

export type { IntegrationCatalogEntry } from "../../contract";

export interface IntegrationCatalog {
  read(): Promise<IntegrationCatalogEntry[]>;
  write(entries: readonly IntegrationCatalogEntry[]): Promise<void>;
  add(entry: IntegrationCatalogEntry): Promise<void>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readEntries(path: string): Promise<IntegrationCatalogEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed))
      throw new Error("Integration catalog must be an array");
    const entries = parsed.map((entry) =>
      integrationCatalogEntrySchema.parse(entry),
    );
    if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
      throw new Error("Invalid integration catalog: duplicate id");
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seeded = defaultIntegrationCatalog.map((entry) => ({
      ...entry,
      settings: { ...entry.settings },
    }));
    await writeJson(path, seeded);
    return seeded;
  }
}

export function createFileIntegrationCatalog(path: string): IntegrationCatalog {
  return {
    read: () => readEntries(path),
    write: async (entries) => {
      const parsed = entries.map((entry) =>
        integrationCatalogEntrySchema.parse(entry),
      );
      if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
        throw new Error("Invalid integration catalog: duplicate id");
      }
      await writeJson(path, parsed);
    },
    add: async (entry) => {
      const entries = await readEntries(path);
      if (entries.some(({ id }) => id === entry.id)) {
        throw new Error(`Duplicate integration catalog entry: ${entry.id}`);
      }
      await writeJson(path, [
        ...entries,
        integrationCatalogEntrySchema.parse(entry),
      ]);
    },
  };
}

export function dynamicIntegrationEntry(
  entry: Omit<IntegrationCatalogEntry, "origin" | "state"> &
    Partial<Pick<IntegrationCatalogEntry, "state">>,
): IntegrationCatalogEntry {
  return { ...entry, origin: "dynamic", state: entry.state ?? "available" };
}
