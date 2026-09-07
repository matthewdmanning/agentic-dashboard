import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod/v4";

import { querySchema } from "../contract";
import { sealedSecretSchema, type SecretBox } from "../server/secret-box";

/**
 * A query as the rest of the service sees it: `querySchema`'s fields
 * (integration, query, the card mapper name it references) plus the
 * addressing a query needs now that a card carries no queries of its own
 * (D32) — an id to address it by, and the card its result feeds.
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
  /** Resolves `false` when `query.id` is not found under `user` — without distinguishing "no such query" from "not yours" (D31). */
  edit(user: string, query: StoredQuery): Promise<boolean>;
  /** Resolves `false` when `id` is not found under `user`. Never decrypts (D41) — an administrator deleting another user's query never sees its contents. */
  remove(user: string, id: string): Promise<boolean>;
  /**
   * Whether any user's query names this card mapper — read from the
   * cleartext envelope only, no decryption (D38, D41). The one way to
   * reference-count a mapper across queries that are private per user
   * without crossing that privacy boundary.
   */
  isReferencedByAnyQuery(mapperName: string): Promise<boolean>;
  /**
   * How many stored queries across every user name `integrationId` — unlike
   * `isReferencedByAnyQuery`, `integration` sits inside the sealed payload
   * (D41), so this decrypts every record to check. It returns only a count,
   * never a query's contents or its owner, so integration removal's
   * warn-then-override flow (D40, #93) can size its warning without crossing
   * D31's privacy boundary.
   */
  countReferencingIntegration(integrationId: string): Promise<number>;
}

/**
 * A query as it lives on disk (D41): a cleartext envelope — id, owner, the
 * card mapper name, and the card it feeds, none of which D31 calls private —
 * plus `sealed`, the encrypted `{ integration, query }` pair, which is what
 * D31 does protect. One store for every user; privacy comes from the seal,
 * not from which file a row sits in.
 */
const storedRecordSchema = z
  .object({
    id: z.string().min(1),
    owner: z.string().min(1),
    cardId: z.string().min(1),
    cardMapper: z.string().min(1),
    sealed: sealedSecretSchema,
  })
  .strict();

type StoredRecord = z.infer<typeof storedRecordSchema>;

/** The part of a query D31 protects: which integration, and what it asks for. */
const privatePayloadSchema = z
  .object({
    integration: z.string().min(1),
    query: z.unknown(),
  })
  .strict();

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

async function readRecords(path: string): Promise<StoredRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Query store must be an array");
    }
    return parsed.map((entry) => storedRecordSchema.parse(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

/** Seals `query`'s private half under `owner`, keeping the rest as the cleartext envelope. */
async function toRecord(owner: string, query: StoredQuery, secretBox: SecretBox): Promise<StoredRecord> {
  return {
    id: query.id,
    owner,
    cardId: query.cardId,
    cardMapper: query.cardMapper,
    sealed: await secretBox.seal(
      owner,
      JSON.stringify({ integration: query.integration, query: query.query }),
    ),
  };
}

/** Opens `record`'s seal under its own recorded owner — never a caller-supplied identity. */
async function toStoredQuery(record: StoredRecord, secretBox: SecretBox): Promise<StoredQuery> {
  const { integration, query } = privatePayloadSchema.parse(
    JSON.parse(await secretBox.open(record.owner, record.sealed)),
  );
  return storedQuerySchema.parse({
    id: record.id,
    cardId: record.cardId,
    cardMapper: record.cardMapper,
    integration,
    query,
  });
}

/**
 * One encrypted, file-backed store for every user's queries (D41, superseding
 * #85's per-user files). `secretBox` binds each seal to its owner, so D31's
 * privacy is an encryption and access-check property now rather than a
 * storage-boundary one — see D41 for the tradeoff. Same temp-then-rename
 * atomic write as `server/integrations/catalog.ts`.
 */
export function createEncryptedQueryStore(
  path: string,
  secretBox: SecretBox,
): UserQueryStore {
  return {
    list: async (user) => {
      const records = await readRecords(path);
      return Promise.all(
        records
          .filter((record) => record.owner === user)
          .map((record) => toStoredQuery(record, secretBox)),
      );
    },
    add: async (user, query) => {
      const records = await readRecords(path);
      records.push(await toRecord(user, query, secretBox));
      await writeJson(path, records);
    },
    edit: async (user, query) => {
      const records = await readRecords(path);
      const index = records.findIndex(
        (record) => record.owner === user && record.id === query.id,
      );
      if (index === -1) return false;
      records[index] = await toRecord(user, query, secretBox);
      await writeJson(path, records);
      return true;
    },
    remove: async (user, id) => {
      const records = await readRecords(path);
      const remaining = records.filter(
        (record) => !(record.owner === user && record.id === id),
      );
      if (remaining.length === records.length) return false;
      await writeJson(path, remaining);
      return true;
    },
    isReferencedByAnyQuery: async (mapperName) => {
      const records = await readRecords(path);
      // Envelope-only: `cardMapper` is cleartext by design (D41), so this
      // never calls `secretBox.open`.
      return records.some((record) => record.cardMapper === mapperName);
    },
    countReferencingIntegration: async (integrationId) => {
      const records = await readRecords(path);
      const queries = await Promise.all(
        records.map((record) => toStoredQuery(record, secretBox)),
      );
      return queries.filter((query) => query.integration === integrationId)
        .length;
    },
  };
}

/**
 * Re-encrypts every stored query under `currentKeyId`, the same best-effort,
 * per-record pass `server/integrations/connections.ts`'s rotation does for
 * connections (#91) — a record that fails to re-encrypt keeps its original
 * seal, and the file is rewritten once, atomically, only if anything
 * actually changed.
 *
 * Returns every key id still referenced by a stored query afterward — the
 * caller's answer to "is this old key safe to destroy yet."
 */
export async function rotateQueryKeys(
  path: string,
  secretBox: SecretBox,
  currentKeyId: string,
): Promise<{ remainingKeyIds: Set<string> }> {
  const records = await readRecords(path);
  const remainingKeyIds = new Set<string>();
  let changed = false;

  const rotated = await Promise.all(
    records.map(async (record) => {
      if (record.sealed.keyId === currentKeyId) {
        remainingKeyIds.add(record.sealed.keyId);
        return record;
      }
      try {
        const plaintext = await secretBox.open(record.owner, record.sealed);
        const sealed = await secretBox.seal(record.owner, plaintext);
        changed = true;
        remainingKeyIds.add(sealed.keyId);
        return { ...record, sealed };
      } catch {
        remainingKeyIds.add(record.sealed.keyId);
        return record;
      }
    }),
  );

  if (changed) await writeJson(path, rotated);
  return { remainingKeyIds };
}
