import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as z from "zod/v4";

import { encodeUserPathSegment } from "../auth";
import { querySchema } from "../contract";

/**
 * A query as it lives on disk: `querySchema`'s fields (integration, query,
 * formatter) plus the addressing a standalone per-user store needs now that a
 * card carries no queries of its own (D32) — an id to address it by, and the
 * card its result feeds.
 */
export const newQuerySchema = querySchema
  .safeExtend({ cardId: z.string().min(1) })
  .strict();

export const storedQuerySchema = newQuerySchema
  .safeExtend({ id: z.string().min(1) })
  .strict();

export type NewQuery = z.infer<typeof newQuerySchema>;
export type StoredQuery = z.infer<typeof storedQuerySchema>;

export interface UserQueryStore {
  list(user: string): Promise<StoredQuery[]>;
  /** Assumes `query.id` is fresh — the caller (service) generates it. */
  add(user: string, query: StoredQuery): Promise<void>;
  /** Resolves `false` when `query.id` is not found under `user`, without distinguishing "no such query" from "not yours" (D31). */
  edit(user: string, query: StoredQuery): Promise<boolean>;
  /** Resolves `false` when `id` is not found under `user`. */
  remove(user: string, id: string): Promise<boolean>;
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

async function readEntries(path: string): Promise<StoredQuery[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("User query store must be an array");
    }
    return parsed.map((entry) => storedQuerySchema.parse(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

/**
 * File-backed, one file per user (D32's storage boundary): nothing else holds
 * another user's queries, so there is nothing to filter on read (D31). Same
 * temp-then-rename atomic write as `server/integrations/catalog.ts`.
 */
export function createFileUserQueryStore(root: string): UserQueryStore {
  const pathFor = (user: string) =>
    join(root, encodeUserPathSegment(user), "queries.json");

  return {
    list: (user) => readEntries(pathFor(user)),
    add: async (user, query) => {
      const path = pathFor(user);
      const entries = await readEntries(path);
      await writeJson(path, [...entries, query]);
    },
    edit: async (user, query) => {
      const path = pathFor(user);
      const entries = await readEntries(path);
      const index = entries.findIndex(({ id }) => id === query.id);
      if (index === -1) return false;
      entries[index] = query;
      await writeJson(path, entries);
      return true;
    },
    remove: async (user, id) => {
      const path = pathFor(user);
      const entries = await readEntries(path);
      const remaining = entries.filter((entry) => entry.id !== id);
      if (remaining.length === entries.length) return false;
      await writeJson(path, remaining);
      return true;
    },
  };
}
